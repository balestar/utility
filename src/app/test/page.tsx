"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
type TestStatus = "pass" | "partial" | "fail" | "skip" | "unknown";
type TestEntry  = { status: TestStatus; note: string };

interface AndroidDevice {
  id: string; model: string; android: string; oneui: string;
  knox: string; api: number; year: number;
  tests: Record<string, TestEntry>;
  successRate: { raw: number; customCert: number; fullEvasion: number };
}

interface WindowsDevice {
  id: string; model: string; version: string; year: number;
  tests: Record<string, TestEntry>;
  successRate: { raw: number; customCert: number; fullEvasion: number };
}

interface VpnRow    { scenario: string; impact: string; detail: string }
interface OfflineRow { scenario: string; status: string; detail: string }
interface CriticalRow { code: string; severity: string; rate: string; detail: string }

interface Matrix {
  android: AndroidDevice[];
  windows: WindowsDevice[];
  vpn: VpnRow[];
  offline: OfflineRow[];
  criticalFailures: CriticalRow[];
}

interface Report {
  type: string; timestamp: string;
  msfConnected: boolean; dockerRunning: boolean; emulatorCount: number;
  summary: { totalDevices: number; avgSuccessRateAndroid: number; avgSuccessRateWindows: number; criticalFailureCount: number };
}

interface Emulator { name: string; status: string; ports: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_BG: Record<TestStatus | string, string> = {
  pass:    "bg-green-500/20 text-green-400 border-green-800/40",
  partial: "bg-yellow-500/10 text-yellow-400 border-yellow-800/40",
  fail:    "bg-red-500/10 text-red-500 border-red-800/40",
  skip:    "bg-slate-800/20 text-slate-600 border-slate-700/30",
  unknown: "bg-slate-800/20 text-slate-700 border-slate-800/20",
};
const STATUS_DOT: Record<string, string> = {
  pass:    "bg-green-500",
  partial: "bg-yellow-400",
  fail:    "bg-red-500",
  skip:    "bg-slate-600",
  unknown: "bg-slate-700",
};
const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400 border-red-800/50",
  high:     "text-orange-400 border-orange-800/50",
  medium:   "text-yellow-400 border-yellow-800/50",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ${STATUS_BG[status] ?? STATUS_BG.unknown}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`} />
      {status}
    </span>
  );
}

function RateBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-white/[0.05]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="font-mono text-[9px] text-slate-400">{value}%</span>
    </div>
  );
}

// Test categories to display in the matrix
const ANDROID_TEST_COLS = ["install","permissions","knox","play_protect","session","persistence","camera","mic","sms","gps","notifications","keylogger","ransomware","vpn_bypass"];
const WIN_TEST_COLS     = ["install","av_detection","uac","amsi","persistence","screenshot","keylogger","cred_harvest","ransomware","privesc"];

type TabId = "overview" | "android" | "windows" | "vpn" | "offline" | "critical" | "howto";

export default function TestPage() {
  const { toast } = useToast();
  const [matrix, setMatrix]       = useState<Matrix | null>(null);
  const [report, setReport]       = useState<Report | null>(null);
  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [running, setRunning]     = useState(false);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [matrixRes, reportRes, emulRes] = await Promise.all([
        fetch("/api/test?action=matrix").then((r) => r.json()),
        fetch("/api/test?action=report").then((r) => r.json()),
        fetch("/api/test?action=emulators").then((r) => r.json()),
      ]);
      setMatrix(matrixRes as Matrix);
      if (reportRes.report) setReport(reportRes.report as Report);
      setEmulators((emulRes as { containers: Emulator[] }).containers ?? []);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const runQuickTest = async () => {
    setRunning(true);
    toast("Running quick analysis…", "info");
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_quick" }),
      });
      const d = await res.json() as { ok: boolean; report?: Report };
      if (d.ok && d.report) {
        setReport(d.report);
        toast("Analysis complete", "success");
      }
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRunning(false);
    }
  };

  const runFullTest = async () => {
    if (!confirm("Start full test suite? This requires Docker + Android emulators running. Takes 15-30 mins.")) return;
    setRunning(true);
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_full" }),
      });
      const d = await res.json() as { ok: boolean; pid?: number; message?: string };
      if (d.ok) toast(`Full suite started (PID ${d.pid}) — refresh in 15 mins`, "success");
      else toast("Failed to start", "error");
    } finally {
      setRunning(false);
    }
  };

  const TABS: { id: TabId; label: string; count?: string }[] = [
    { id: "overview",  label: "OVERVIEW" },
    { id: "android",   label: "ANDROID",  count: String(matrix?.android.length ?? 0) },
    { id: "windows",   label: "WINDOWS",  count: String(matrix?.windows.length ?? 0) },
    { id: "vpn",       label: "VPN" },
    { id: "offline",   label: "OFFLINE" },
    { id: "critical",  label: "CRITICAL", count: String(matrix?.criticalFailures.filter(f=>f.severity==="critical").length ?? 0) },
    { id: "howto",     label: "HOW TO RUN" },
  ];

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <span className="h-5 w-5 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/[0.05] pb-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Device Test Lab</p>
          <h1 className="mt-1 text-xl font-bold text-white">Payload Test Matrix</h1>
          <p className="mt-1 text-[11px] text-slate-600">
            {matrix?.android.length ?? 0} Android devices · {matrix?.windows.length ?? 0} Windows versions · Full feature coverage
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={runQuickTest} disabled={running}
            className="rounded border border-blue-800/50 bg-blue-950/20 px-4 py-2 text-[10px] uppercase tracking-wider text-blue-400 transition hover:bg-blue-950/40 disabled:opacity-40">
            {running ? "Running…" : "▶ Quick Analysis"}
          </button>
          <button onClick={runFullTest} disabled={running}
            className="rounded border border-green-800/50 bg-green-950/20 px-4 py-2 text-[10px] uppercase tracking-wider text-green-400 transition hover:bg-green-950/40 disabled:opacity-40">
            ▶ Full Docker Test
          </button>
          <button onClick={loadAll}
            className="rounded border border-white/[0.06] px-3 py-2 text-[10px] text-slate-500 transition hover:text-slate-300">
            ↻
          </button>
        </div>
      </div>

      {/* Stats row */}
      {report && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Total Devices",     val: report.summary?.totalDevices ?? (matrix ? matrix.android.length + matrix.windows.length : "—"),        color: "text-slate-300" },
            { label: "Android Avg Rate",  val: `${report.summary?.avgSuccessRateAndroid ?? "—"}%`, color: "text-green-400" },
            { label: "Windows Avg Rate",  val: `${report.summary?.avgSuccessRateWindows ?? "—"}%`, color: "text-blue-400"  },
            { label: "Critical Issues",   val: report.summary?.criticalFailureCount ?? matrix?.criticalFailures.filter(f=>f.severity==="critical").length ?? "—", color: "text-red-400" },
            { label: "Emulators Running", val: emulators.length,        color: emulators.length > 0 ? "text-green-400" : "text-slate-700" },
          ].map(({ label, val, color }) => (
            <div key={label} className="rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3">
              <p className="text-[8px] uppercase tracking-wider text-slate-600">{label}</p>
              <p className={`mt-1 font-mono text-2xl font-bold ${color}`}>{String(val)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.05]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-[9px] font-semibold uppercase tracking-wider transition ${
              activeTab === t.id
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-slate-600 hover:text-slate-400"
            }`}>
            {t.label}
            {t.count && <span className="ml-1 rounded-full border border-white/[0.05] px-1.5 py-px text-[7px]">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────────── */}
      {activeTab === "overview" && matrix && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-5">
            {/* Android success rates */}
            <div className="rounded border border-white/[0.05] p-4">
              <p className="mb-3 text-[9px] font-semibold uppercase tracking-widest text-slate-600">Android Success Rates (Full Evasion Chain)</p>
              <div className="space-y-2.5">
                {matrix.android.map((d) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <div className="w-36 flex-shrink-0">
                      <p className="text-[10px] text-slate-300">{d.model}</p>
                      <p className="text-[8px] text-slate-600">{d.android} · {d.knox}</p>
                    </div>
                    <RateBar value={d.successRate.fullEvasion}
                      color={d.successRate.fullEvasion >= 80 ? "bg-green-500" : d.successRate.fullEvasion >= 50 ? "bg-yellow-400" : "bg-red-500"} />
                    <div className="ml-auto flex gap-2 text-[8px] text-slate-700">
                      <span>raw: {d.successRate.raw}%</span>
                      <span>cert: {d.successRate.customCert}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Windows success rates */}
            <div className="rounded border border-white/[0.05] p-4">
              <p className="mb-3 text-[9px] font-semibold uppercase tracking-widest text-slate-600">Windows Success Rates (Full Evasion Chain)</p>
              <div className="space-y-2.5">
                {matrix.windows.map((d) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <div className="w-36 flex-shrink-0">
                      <p className="text-[10px] text-slate-300">{d.model}</p>
                      <p className="text-[8px] text-slate-600">{d.version}</p>
                    </div>
                    <RateBar value={d.successRate.fullEvasion}
                      color={d.successRate.fullEvasion >= 80 ? "bg-green-500" : d.successRate.fullEvasion >= 50 ? "bg-yellow-400" : "bg-red-500"} />
                    <div className="ml-auto flex gap-2 text-[8px] text-slate-700">
                      <span>raw: {d.successRate.raw}%</span>
                      <span>cert: {d.successRate.customCert}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top 3 critical failures callout */}
          <div className="rounded border border-red-900/30 bg-red-950/10 p-4">
            <p className="mb-3 text-[9px] font-semibold uppercase tracking-widest text-red-400">Top Critical Failure Points</p>
            <div className="grid grid-cols-3 gap-3">
              {matrix.criticalFailures.filter(f => f.severity === "critical").slice(0, 3).map((f) => (
                <div key={f.code} className="rounded border border-red-900/20 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] font-bold text-red-400">{f.code}</p>
                    <span className="font-mono text-[8px] text-red-600">{f.rate}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 leading-relaxed">{f.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ANDROID MATRIX ───────────────────────────────────────────────── */}
      {activeTab === "android" && matrix && (
        <div className="space-y-4 overflow-x-auto">
          <table className="w-full text-left text-[9px]">
            <thead>
              <tr className="border-b border-white/[0.05]">
                <th className="px-3 py-2 text-[8px] uppercase tracking-wider text-slate-600">Device</th>
                {ANDROID_TEST_COLS.map((c) => (
                  <th key={c} className="px-1 py-2 text-center text-[7px] uppercase tracking-wider text-slate-700">
                    {c.replace("_", " ")}
                  </th>
                ))}
                <th className="px-3 py-2 text-[8px] uppercase tracking-wider text-slate-600">Rate</th>
              </tr>
            </thead>
            <tbody>
              {matrix.android.map((device) => (
                <>
                  <tr key={device.id}
                    onClick={() => setExpandedDevice(expandedDevice === device.id ? null : device.id)}
                    className="cursor-pointer border-b border-white/[0.03] transition hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-300">{device.model}</p>
                      <p className="text-[7px] text-slate-600">{device.android} · {device.knox} · {device.year}</p>
                    </td>
                    {ANDROID_TEST_COLS.map((col) => {
                      const t = device.tests[col];
                      return (
                        <td key={col} className="px-1 py-2.5 text-center">
                          {t ? (
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[t.status] ?? STATUS_DOT.unknown}`}
                              title={`${col}: ${t.status} — ${t.note}`} />
                          ) : (
                            <span className="inline-block h-2 w-2 rounded-full bg-slate-800" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5">
                      <RateBar value={device.successRate.fullEvasion}
                        color={device.successRate.fullEvasion >= 80 ? "bg-green-500" : device.successRate.fullEvasion >= 50 ? "bg-yellow-400" : "bg-red-500"} />
                    </td>
                  </tr>
                  {expandedDevice === device.id && (
                    <tr key={device.id + "_detail"}>
                      <td colSpan={ANDROID_TEST_COLS.length + 2} className="bg-white/[0.01] px-4 py-4">
                        <div className="grid grid-cols-3 gap-3">
                          {Object.entries(device.tests).map(([k, v]) => (
                            <div key={k} className="flex items-start gap-2">
                              <StatusBadge status={v.status} />
                              <div>
                                <p className="text-[9px] font-semibold text-slate-400">{k}</p>
                                {v.note && <p className="text-[8px] text-slate-600 leading-relaxed">{v.note}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex gap-6 text-[8px]">
                          <span className="text-slate-600">Raw APK: <span className="font-mono text-slate-400">{device.successRate.raw}%</span></span>
                          <span className="text-slate-600">Custom cert: <span className="font-mono text-slate-400">{device.successRate.customCert}%</span></span>
                          <span className="text-slate-600">Full evasion: <span className="font-mono text-green-400">{device.successRate.fullEvasion}%</span></span>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-4 text-[8px] text-slate-700">
            {["pass","partial","fail"].map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />{s}
              </span>
            ))}
            <span className="text-slate-800">· Click row to expand details</span>
          </div>
        </div>
      )}

      {/* ── WINDOWS MATRIX ───────────────────────────────────────────────── */}
      {activeTab === "windows" && matrix && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[9px]">
            <thead>
              <tr className="border-b border-white/[0.05]">
                <th className="px-3 py-2 text-[8px] uppercase tracking-wider text-slate-600">Version</th>
                {WIN_TEST_COLS.map((c) => (
                  <th key={c} className="px-1 py-2 text-center text-[7px] uppercase tracking-wider text-slate-700">
                    {c.replace("_", " ")}
                  </th>
                ))}
                <th className="px-3 py-2 text-[8px] uppercase tracking-wider text-slate-600">Rate</th>
              </tr>
            </thead>
            <tbody>
              {matrix.windows.map((device) => (
                <>
                  <tr key={device.id}
                    onClick={() => setExpandedDevice(expandedDevice === device.id ? null : device.id)}
                    className="cursor-pointer border-b border-white/[0.03] transition hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-300">{device.model}</p>
                      <p className="text-[7px] text-slate-600">{device.version} · {device.year}</p>
                    </td>
                    {WIN_TEST_COLS.map((col) => {
                      const t = device.tests[col];
                      return (
                        <td key={col} className="px-1 py-2.5 text-center">
                          {t ? (
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[t.status] ?? STATUS_DOT.unknown}`}
                              title={`${col}: ${t.status} — ${t.note}`} />
                          ) : (
                            <span className="inline-block h-2 w-2 rounded-full bg-slate-800" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5">
                      <RateBar value={device.successRate.fullEvasion}
                        color={device.successRate.fullEvasion >= 80 ? "bg-green-500" : device.successRate.fullEvasion >= 50 ? "bg-yellow-400" : "bg-red-500"} />
                    </td>
                  </tr>
                  {expandedDevice === device.id && (
                    <tr key={device.id + "_detail"}>
                      <td colSpan={WIN_TEST_COLS.length + 2} className="bg-white/[0.01] px-4 py-4">
                        <div className="grid grid-cols-3 gap-3">
                          {Object.entries(device.tests).map(([k, v]) => (
                            <div key={k} className="flex items-start gap-2">
                              <StatusBadge status={v.status} />
                              <div>
                                <p className="text-[9px] font-semibold text-slate-400">{k}</p>
                                {v.note && <p className="text-[8px] text-slate-600 leading-relaxed">{v.note}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── VPN TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "vpn" && matrix && (
        <div className="space-y-3">
          <p className="text-[10px] text-slate-500">How different VPN configurations on the victim or attacker side affect C2 connectivity.</p>
          {matrix.vpn.map((row, i) => {
            const impactColor = row.impact === "none" ? "text-green-400 border-green-900/40" :
              row.impact === "partial" ? "text-yellow-400 border-yellow-900/40" :
              row.impact === "blocks" ? "text-red-400 border-red-900/40" :
              "text-blue-400 border-blue-900/40";
            return (
              <div key={i} className="rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-[11px] font-semibold text-slate-200">{row.scenario}</p>
                    <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">{row.detail}</p>
                  </div>
                  <span className={`flex-shrink-0 rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${impactColor}`}>
                    {row.impact}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="rounded border border-blue-900/30 bg-blue-950/10 p-4 mt-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400 mb-2">Universal Fix for VPN Blocking</p>
            <p className="text-[10px] text-slate-400">Use <span className="font-mono text-blue-300">windows/x64/meterpreter/reverse_https</span> on port <span className="font-mono text-blue-300">443</span>. HTTPS traffic on port 443 is never blocked by VPNs, corporate firewalls, or carrier filtering. Traffic is indistinguishable from normal HTTPS browsing.</p>
          </div>
        </div>
      )}

      {/* ── OFFLINE TAB ──────────────────────────────────────────────────── */}
      {activeTab === "offline" && matrix && (
        <div className="space-y-3">
          <p className="text-[10px] text-slate-500">What happens to sessions, data, and the dashboard when Docker or the network goes down.</p>
          {matrix.offline.map((row, i) => {
            const dot = row.status === "pass" ? STATUS_DOT.pass : row.status === "partial" ? STATUS_DOT.partial : STATUS_DOT.fail;
            return (
              <div key={i} className="flex items-start gap-3 rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} />
                <div>
                  <p className="text-[11px] font-semibold text-slate-200">{row.scenario}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500 leading-relaxed">{row.detail}</p>
                </div>
              </div>
            );
          })}
          <div className="rounded border border-amber-900/30 bg-amber-950/10 p-4 mt-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400 mb-2">Recovery Procedure</p>
            <div className="space-y-1 font-mono text-[10px] text-amber-300/70">
              <p>1. docker compose up -d                  # restart stack (~90s)</p>
              <p>2. curl http://localhost:3000/api/sync   # flush offline queue</p>
              <p>3. MSF Console → use exploit/multi/handler; set PAYLOAD android/meterpreter/reverse_tcp; run -j</p>
              <p>4. Payload reconnects within ~10s automatically</p>
            </div>
          </div>
        </div>
      )}

      {/* ── CRITICAL TAB ─────────────────────────────────────────────────── */}
      {activeTab === "critical" && matrix && (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500">High-probability failure points ranked by severity and occurrence rate.</p>
          {matrix.criticalFailures.map((f) => (
            <div key={f.code} className={`rounded border px-4 py-3 ${SEVERITY_COLOR[f.severity] ?? "border-slate-700 text-slate-400"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] font-bold">{f.code}</span>
                    <span className={`rounded border px-1.5 py-px text-[7px] font-bold uppercase ${SEVERITY_COLOR[f.severity]}`}>{f.severity}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{f.detail}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="font-mono text-[11px] font-bold text-red-400">{f.rate}</p>
                  <p className="text-[8px] text-slate-600">occurrence</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── HOW TO RUN TAB ───────────────────────────────────────────────── */}
      {activeTab === "howto" && (
        <div className="space-y-5 max-w-3xl">
          <div className="rounded border border-white/[0.05] p-5 space-y-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Option A — Quick Analysis (no Docker needed)</p>
            <p className="text-[10px] text-slate-400">Click <span className="text-blue-400">▶ Quick Analysis</span> above. Runs instantly using the built-in knowledge base. Shows the full device matrix with all known results.</p>
          </div>

          <div className="rounded border border-green-900/30 p-5 space-y-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-green-600">Option B — Full Docker Test Suite (live emulators)</p>
            <div className="space-y-2 font-mono text-[10px] text-green-500/80">
              <p className="text-[9px] uppercase tracking-wider text-green-800 mb-2">1. Prerequisites (Linux recommended for KVM acceleration)</p>
              <p>sudo modprobe kvm_intel           # enable KVM</p>
              <p>sudo apt install adb android-tools # install ADB</p>
              <p className="mt-2 text-[9px] uppercase tracking-wider text-green-800">2. Start test containers</p>
              <p>cd ~/metasploit-app</p>
              <p>docker compose -f docker-compose.yml \</p>
              <p>  -f docker-compose.test.yml up -d</p>
              <p className="mt-2 text-[9px] uppercase tracking-wider text-green-800">3. Wait for emulators to boot (~3-5 min each)</p>
              <p>docker ps | grep test-android     # check status</p>
              <p>open http://localhost:6080         # view API 28 screen via noVNC</p>
              <p>open http://localhost:6081         # view API 29 screen</p>
              <p className="mt-2 text-[9px] uppercase tracking-wider text-green-800">4. Run the test suite</p>
              <p>./scripts/run-tests.sh</p>
              <p className="mt-2 text-[9px] uppercase tracking-wider text-green-800">   Or click ▶ Full Docker Test above</p>
              <p className="mt-2 text-[9px] uppercase tracking-wider text-green-800">5. View results</p>
              <p>cat test-results/report_*.json    # JSON report</p>
              <p>open http://localhost:3000/test    # this page updates live</p>
            </div>
          </div>

          <div className="rounded border border-white/[0.05] p-5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-3">Emulator VNC Ports</p>
            <div className="grid grid-cols-2 gap-2 font-mono text-[9px]">
              {[
                ["API 28 (Android 9  / S10)", "http://localhost:6080"],
                ["API 29 (Android 10 / S20)", "http://localhost:6081"],
                ["API 30 (Android 11 / S21)", "http://localhost:6082"],
                ["API 31 (Android 12 / S22)", "http://localhost:6083"],
                ["API 33 (Android 13 / S23)", "http://localhost:6084"],
                ["API 34 (Android 14 / S24)", "http://localhost:6085"],
              ].map(([label, url]) => (
                <div key={label} className="flex items-center justify-between rounded border border-white/[0.04] px-3 py-2">
                  <span className="text-slate-500">{label}</span>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400">{url}</a>
                </div>
              ))}
            </div>
          </div>

          {emulators.length > 0 && (
            <div className="rounded border border-green-900/30 bg-green-950/10 p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-green-500 mb-2">Running Emulators ({emulators.length})</p>
              {emulators.map((e) => (
                <div key={e.name} className="flex items-center gap-3 text-[9px] text-green-600 py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="font-mono">{e.name}</span>
                  <span className="text-green-900">{e.status}</span>
                  <span className="text-green-900/50">{e.ports}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
