"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useToast } from "./toast";

type Session = {
  id: number;
  type: string;
  tunnel: string;
  via: string;
  info: string;
  workspace: string;
  platform?: string;
  arch?: string;
  lastSeen?: string;
};

const TYPE_COLOR: Record<string, string> = {
  meterpreter: "text-green-400 border-green-800/50",
  shell:       "text-cyan-400  border-cyan-800/50",
  unknown:     "text-slate-400 border-slate-700/50",
};

export function SessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Session | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/agents?action=sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
      if (silent && data.sessions?.length > 0) {
        // Notify when a new session appears
        const incoming = (data.sessions as { id: number }[]).filter(
          (s) => !sessions.some((prev) => prev.id === s.id)
        );
        if (incoming.length > 0) {
          toast(`🔴 ${incoming.length} new session(s) opened`, "success");
        }
      }
    } catch {
      if (!silent) toast("Failed to load sessions", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), 8000);
    return () => clearInterval(t);
  }, [load]);

  const now = Date.now();
  const online = (s: Session) =>
    s.lastSeen ? now - new Date(s.lastSeen).getTime() < 120000 : true;

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border border-slate-700 border-t-red-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            Sessions
          </span>
          <span className="rounded border border-white/[0.06] px-1.5 py-px text-[9px] font-semibold text-red-400">
            {sessions.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded border border-white/[0.06] px-3 py-1 text-[10px] text-slate-500 transition hover:border-white/[0.10] hover:text-slate-300 disabled:opacity-40"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={refreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      {sessions.length === 0 && (
        <div className="rounded border border-dashed border-white/[0.06] py-16 text-center">
          <p className="text-[11px] uppercase tracking-wider text-slate-600">No active sessions</p>
          <p className="mt-1 text-[10px] text-slate-700">Start a listener and wait for a connection</p>
          <Link href="/listeners" className="mt-4 inline-block rounded border border-white/[0.08] px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 transition hover:text-slate-300">
            Go to Listeners →
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {sessions.map(sess => {
          const isOnline = online(sess);
          const typeColor = TYPE_COLOR[sess.type] || TYPE_COLOR.unknown;
          const isSelected = selected?.id === sess.id;

          return (
            <button
              key={sess.id}
              type="button"
              onClick={() => setSelected(isSelected ? null : sess)}
              className={`rounded border p-4 text-left transition-all ${
                isSelected
                  ? "border-red-800/60 bg-red-950/20"
                  : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? "bg-green-500 status-pulse" : "bg-slate-600"}`} />
                  <span className="font-mono text-[13px] font-bold text-red-400">#{sess.id}</span>
                </div>
                <span className={`rounded border px-1.5 py-px text-[9px] font-semibold uppercase ${typeColor}`}>
                  {sess.type}
                </span>
              </div>

              <p className="mt-2 truncate text-[12px] font-medium text-slate-200">{sess.info}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{sess.tunnel}</p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[10px] text-slate-600">{sess.platform || "unknown"} · {sess.workspace}</span>
                {isSelected && (
                  <Link
                    href="/agents"
                    onClick={e => e.stopPropagation()}
                    className="rounded border border-red-800/50 bg-red-950/20 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-950/40"
                  >
                    Control →
                  </Link>
                )}
              </div>

              {isSelected && (
                <div className="mt-3 space-y-1.5 border-t border-white/[0.05] pt-3">
                  {[
                    ["Via",         sess.via],
                    ["Tunnel",      sess.tunnel],
                    ["Platform",    sess.platform || "unknown"],
                    ["Arch",        sess.arch || "unknown"],
                    ["Workspace",   sess.workspace],
                    ...(sess.lastSeen ? [["Last Seen", new Date(sess.lastSeen).toLocaleTimeString()]] : []),
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-[9px] uppercase tracking-wider text-slate-600">{k}</span>
                      <span className="truncate font-mono text-[10px] text-slate-300">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
