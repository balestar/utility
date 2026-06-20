"use client";

import { useEffect, useState } from "react";

type Health = {
  connected: boolean;
  demo: boolean;
  version?: string;
  error?: string;
};

export function StatusBadge() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth({ connected: false, demo: false, error: "Unreachable" }));
  }, []);

  if (!health) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-600">
        Connecting...
      </span>
    );
  }

  const label = health.demo
    ? "Demo"
    : health.connected
      ? "Online"
      : "Offline";

  const color = health.demo
    ? "border-amber-500/30 bg-amber-500/5 text-amber-400/70"
    : health.connected
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400/70"
      : "border-red-500/30 bg-red-500/5 text-red-400/70";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
