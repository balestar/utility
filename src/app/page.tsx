"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  sessions: number;
  listeners: number;
  workspaces: number;
  modules: number;
  backend: "online" | "offline" | "demo";
  version?: string;
};

const QUICK_LINKS = [
  { href: "/agents", label: "Agent Control", sub: "Post-exploitation C2", danger: true },
  { href: "/payloads", label: "Generate Payload", sub: "msfvenom wrapper" },
  { href: "/listeners", label: "Start Listener", sub: "multi/handler" },
  { href: "/locker", label: "CryptoLocker", sub: "Encryption campaigns", danger: true },
  { href: "/modules", label: "Module Browser", sub: "Exploits & auxiliary" },
  { href: "/sessions", label: "Sessions", sub: "Active connections" },
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ sessions: 0, listeners: 0, workspaces: 0, modules: 0, backend: "offline" });
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => new Date());

  useEffect(() => {
    async function load() {
      try {
        const [h, s, l, w] = await Promise.allSettled([
          fetch("/api/health").then(r => r.json()),
          fetch("/api/sessions").then(r => r.json()),
          fetch("/api/listeners").then(r => r.json()),
          fetch("/api/workspaces").then(r => r.json()),
        ]);

        const health = h.status === "fulfilled" ? h.value : null;
        const sess   = s.status === "fulfilled" ? s.value : null;
        const listen = l.status === "fulfilled" ? l.value : null;
        const work   = w.status === "fulfilled" ? w.value : null;

        setStats({
          sessions:   sess?.sessions?.length ?? 0,
          listeners:  listen?.listeners?.length ?? 0,
          workspaces: work?.workspaces?.length ?? 0,
          modules:    0,
          backend:    health?.demo ? "demo" : health?.connected ? "online" : "offline",
          version:    health?.version,
        });
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" }).toUpperCase();

  const backendDot =
    stats.backend === "online" ? "bg-green-500" :
    stats.backend === "demo"   ? "bg-amber-500" :
                                 "bg-red-500";
  const backendLabel =
    stats.backend === "online" ? "CONNECTED" :
    stats.backend === "demo"   ? "DEMO MODE" :
                                 "OFFLINE";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-5">
        <div>
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            Command Center
          </h1>
          <p className="mt-1 font-mono text-2xl font-bold text-white">{time}</p>
          <p className="text-[9px] tracking-widest text-slate-600">{date}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className={`h-2 w-2 rounded-full ${backendDot} status-pulse`} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${
              stats.backend === "online" ? "text-green-500" :
              stats.backend === "demo"   ? "text-amber-500" :
                                           "text-red-500"
            }`}>{backendLabel}</span>
          </div>
          {stats.version && (
            <p className="mt-1 font-mono text-[9px] text-slate-600">msf {stats.version}</p>
          )}
        </div>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "ACTIVE SESSIONS", value: stats.sessions, color: stats.sessions > 0 ? "text-green-400" : "text-slate-600" },
          { label: "LISTENERS", value: stats.listeners, color: stats.listeners > 0 ? "text-cyan-400" : "text-slate-600" },
          { label: "WORKSPACES", value: stats.workspaces, color: "text-slate-400" },
          { label: "PAYLOADS", value: "—", color: "text-slate-600" },
        ].map(stat => (
          <div key={stat.label} className="rounded border border-white/[0.05] bg-white/[0.02] px-5 py-4">
            <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-600">{stat.label}</p>
            <p className={`mt-2 font-mono text-3xl font-bold tabular-nums ${stat.color}`}>
              {loading ? (
                <span className="inline-block h-7 w-10 animate-pulse rounded bg-white/[0.05]" />
              ) : stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`group flex flex-col rounded border p-5 transition-all ${
                link.danger
                  ? "border-red-900/30 bg-red-950/10 hover:border-red-800/50 hover:bg-red-950/20"
                  : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]"
              }`}
            >
              <p className={`text-sm font-semibold tracking-tight transition ${
                link.danger ? "text-red-400 group-hover:text-red-300" : "text-slate-300 group-hover:text-white"
              }`}>{link.label}</p>
              <p className="mt-1 text-[10px] text-slate-600">{link.sub}</p>
              <span className="mt-3 text-[10px] uppercase tracking-widest text-slate-700 group-hover:text-slate-500">
                Open ›
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Docker stack commands */}
      <div className="rounded border border-white/[0.05] bg-[#05050c] p-5">
        <h2 className="mb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Deploy Stack</h2>
        <div className="space-y-2 font-mono text-[11px]">
          {[
            { cmd: "docker compose up -d", comment: "# start all services" },
            { cmd: "docker compose ps", comment: "# check status" },
            { cmd: "docker compose logs -f", comment: "# follow logs" },
            { cmd: "docker compose down", comment: "# stop all services" },
          ].map(({ cmd, comment }) => (
            <div key={cmd} className="flex gap-4">
              <span className="select-all text-green-500">{cmd}</span>
              <span className="text-slate-700">{comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
