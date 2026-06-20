"use client";

import { useEffect, useState } from "react";

type DashboardStats = {
  sessions: number;
  listeners: number;
  workspaces: number;
  modules: number;
  backendStatus: "online" | "offline" | "demo";
};

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    sessions: 0,
    listeners: 0,
    workspaces: 0,
    modules: 0,
    backendStatus: "offline",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, sessionRes, listenerRes, workspaceRes, moduleRes] = await Promise.allSettled([
          fetch("/api/health"),
          fetch("/api/sessions"),
          fetch("/api/listeners"),
          fetch("/api/workspaces"),
          fetch("/api/modules?type=exploit"),
        ]);

        const health = healthRes.status === "fulfilled" ? await healthRes.value.json() : null;
        const sessions = sessionRes.status === "fulfilled" ? await sessionRes.value.json() : null;
        const listeners = listenerRes.status === "fulfilled" ? await listenerRes.value.json() : null;
        const workspaces = workspaceRes.status === "fulfilled" ? await workspaceRes.value.json() : null;
        const modules = moduleRes.status === "fulfilled" ? await moduleRes.value.json() : null;

        setStats({
          sessions: sessions?.sessions?.length ?? 0,
          listeners: listeners?.listeners?.length ?? 0,
          workspaces: workspaces?.workspaces?.length ?? 0,
          modules: modules?.modules?.length ?? 0,
          backendStatus: health?.demo ? "demo" : health?.connected ? "online" : "offline",
        });
      } catch {
        // keep defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statusColor = {
    online: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    demo: "border-amber-500/30 bg-amber-500/5 text-amber-400",
    offline: "border-red-500/30 bg-red-500/5 text-red-400",
  };

  const cards = [
    { label: "Active Sessions", value: stats.sessions, icon: "👁" },
    { label: "Active Listeners", value: stats.listeners, icon: "📡" },
    { label: "Workspaces", value: stats.workspaces, icon: "📁" },
    { label: "Modules Available", value: stats.modules, icon: "🧩" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">Remote administration overview</p>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusColor[stats.backendStatus]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {stats.backendStatus === "demo"
              ? "Demo Mode"
              : stats.backendStatus === "online"
                ? "Connected"
                : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 transition hover:border-zinc-700"
          >
            <p className="mb-2 text-2xl">{card.icon}</p>
            <p className="text-3xl font-bold text-white">
              {loading ? (
                <span className="inline-block h-8 w-12 animate-pulse rounded bg-zinc-800" />
              ) : (
                card.value
              )}
            </p>
            <p className="mt-1 text-sm text-zinc-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-white">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a
            href="/payloads"
            className="group rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 transition hover:border-zinc-700"
          >
            <p className="text-lg font-semibold text-white group-hover:text-red-400">Generate Payload</p>
            <p className="mt-1 text-sm text-zinc-500">Create a remote access payload with msfvenom</p>
          </a>
          <a
            href="/listeners"
            className="group rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 transition hover:border-zinc-700"
          >
            <p className="text-lg font-semibold text-white group-hover:text-red-400">Start Listener</p>
            <p className="mt-1 text-sm text-zinc-500">Launch a multi/handler for incoming shells</p>
          </a>
        </div>
      </div>

      {/* Quick commands */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Docker Stack</h2>
        <pre className="overflow-x-auto rounded-xl bg-black p-4 text-xs text-emerald-500/70">
{`docker compose up -d    # Start everything
docker compose ps       # Check status
docker compose logs -f  # Follow logs`}
        </pre>
      </div>
    </div>
  );
}
