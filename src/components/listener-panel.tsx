"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "./toast";

type Listener = {
  id: string;
  payload: string;
  lhost: string;
  lport: number;
  status: "running" | "stopped";
  sessionCount: number;
  createdAt: string;
};

const PAYLOAD_PRESETS = [
  "windows/x64/meterpreter/reverse_tcp",
  "windows/x64/meterpreter/reverse_https",
  "windows/x86/meterpreter/reverse_tcp",
  "linux/x64/meterpreter/reverse_tcp",
  "linux/x86/meterpreter/reverse_tcp",
  "android/meterpreter/reverse_tcp",
  "python/meterpreter/reverse_tcp",
  "php/meterpreter/reverse_tcp",
  "java/meterpreter/reverse_tcp",
];

const PLATFORM_COLOR: Record<string, string> = {
  windows: "text-blue-400",
  linux:   "text-green-400",
  android: "text-lime-400",
  python:  "text-yellow-400",
  php:     "text-violet-400",
  java:    "text-orange-400",
};

function payloadColor(p: string) {
  const plat = p.split("/")[0];
  return PLATFORM_COLOR[plat] || "text-slate-300";
}

export function ListenerPanel() {
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [payload, setPayload] = useState(PAYLOAD_PRESETS[0]);
  const [lhost, setLhost] = useState("");
  const [lport, setLport] = useState(4444);
  const [custom, setCustom] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/listeners");
      const data = await res.json();
      setListeners(data.listeners ?? []);
    } catch {
      toast("Failed to load listeners", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const start = async () => {
    if (!lhost.trim()) { toast("LHOST is required", "warning"); return; }
    if (lport < 1 || lport > 65535) { toast("Port must be 1–65535", "warning"); return; }
    setStarting(true);
    try {
      const res = await fetch("/api/listeners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, lhost: lhost.trim(), lport }),
      });
      const data = await res.json();
      if (data.error) {
        toast(data.error, "error");
      } else {
        toast(`Listener started on :${lport}`, "success");
        setLport(p => p + 1);
        await load();
      }
    } catch {
      toast("Failed to start listener", "error");
    } finally {
      setStarting(false);
    }
  };

  const stop = async (id: string) => {
    setStopping(id);
    try {
      await fetch(`/api/listeners?id=${id}`, { method: "DELETE" });
      toast("Listener stopped", "info");
      await load();
    } catch {
      toast("Failed to stop listener", "error");
    } finally {
      setStopping(null);
    }
  };

  const cloneListener = (l: Listener) => {
    setPayload(l.payload);
    setLhost(l.lhost === "0.0.0.0" ? "" : l.lhost);
    setLport(l.lport + 1);
    toast("Settings cloned — update LHOST and start", "info");
  };

  return (
    <div className="space-y-5">
      {/* Start form */}
      <div className="rounded border border-white/[0.06] bg-[#09090f] p-5">
        <p className="mb-4 text-[9px] font-semibold uppercase tracking-widest text-slate-500">New Listener</p>

        {/* Payload */}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[9px] uppercase tracking-wider text-slate-500">Payload</label>
            <button
              type="button"
              onClick={() => setCustom(c => !c)}
              className="text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-slate-400"
            >
              {custom ? "Use preset" : "Custom"}
            </button>
          </div>
          {custom ? (
            <input
              value={payload}
              onChange={e => setPayload(e.target.value)}
              className="w-full rounded border border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[11px] text-slate-200 focus:border-red-800/50 focus:outline-none"
              placeholder="windows/x64/meterpreter/reverse_tcp"
            />
          ) : (
            <select
              value={payload}
              onChange={e => setPayload(e.target.value)}
              className="w-full rounded border border-white/[0.06] bg-black/60 px-3 py-2 font-mono text-[11px] text-slate-200 focus:border-red-800/50 focus:outline-none"
            >
              {PAYLOAD_PRESETS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        {/* LHOST / LPORT */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[9px] uppercase tracking-wider text-slate-500">LHOST</label>
            <input
              value={lhost}
              onChange={e => setLhost(e.target.value)}
              placeholder="0.0.0.0 or your IP"
              className="w-full rounded border border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[12px] text-slate-200 focus:border-red-800/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[9px] uppercase tracking-wider text-slate-500">LPORT</label>
            <input
              type="number"
              value={lport}
              onChange={e => setLport(Number(e.target.value))}
              min={1} max={65535}
              className="w-full rounded border border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[12px] text-slate-200 focus:border-red-800/50 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="w-full rounded border border-red-800/60 bg-red-700/20 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-700/30 disabled:opacity-40"
        >
          {starting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border border-red-400/40 border-t-red-400" />
              Starting...
            </span>
          ) : "Start Listener"}
        </button>
      </div>

      {/* Active listeners */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Active</p>
          <span className="rounded border border-white/[0.06] px-1.5 py-px text-[9px] font-semibold text-green-500">
            {listeners.filter(l => l.status === "running").length}
          </span>
        </div>

        {loading && (
          <div className="flex h-20 items-center justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
          </div>
        )}

        {!loading && listeners.length === 0 && (
          <div className="rounded border border-dashed border-white/[0.05] py-10 text-center">
            <p className="text-[10px] uppercase tracking-wider text-slate-700">No active listeners</p>
          </div>
        )}

        <div className="space-y-2">
          {listeners.map(l => (
            <div
              key={l.id}
              className="flex items-center gap-4 rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${l.status === "running" ? "bg-green-500 status-pulse" : "bg-slate-600"}`} />

              <div className="min-w-0 flex-1">
                <p className={`truncate font-mono text-[11px] font-semibold ${payloadColor(l.payload)}`}>{l.payload}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {l.lhost}:{l.lport}
                  <span className="mx-2 text-slate-700">·</span>
                  {l.sessionCount} session{l.sessionCount !== 1 ? "s" : ""}
                  <span className="mx-2 text-slate-700">·</span>
                  {new Date(l.createdAt).toLocaleTimeString()}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => cloneListener(l)}
                  className="rounded border border-white/[0.06] px-2 py-1 text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-slate-400"
                >
                  Clone
                </button>
                <button
                  type="button"
                  onClick={() => stop(l.id)}
                  disabled={stopping === l.id}
                  className="rounded border border-red-900/40 bg-red-950/20 px-2 py-1 text-[9px] uppercase tracking-wider text-red-500 transition hover:bg-red-950/40 disabled:opacity-40"
                >
                  {stopping === l.id ? "..." : "Stop"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
