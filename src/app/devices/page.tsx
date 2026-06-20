"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, type Device, type Command } from "@/lib/supabase";
import Link from "next/link";
import { useToast } from "@/components/toast";

const PLATFORM_COLOR: Record<string, string> = {
  windows: "text-blue-400",
  linux:   "text-green-400",
  android: "text-lime-400",
  darwin:  "text-slate-300",
  ios:     "text-slate-400",
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCmds, setLoadingCmds] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("devices")
        .select("*")
        .order("last_seen", { ascending: false });
      setDevices(data ?? []);
    } catch {
      toast("Failed to load devices", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Real-time: new device connects
  useEffect(() => {
    const ch = supabase.channel("devices-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "devices" }, payload => {
        const d = payload.new as Device;
        setDevices(prev => [d, ...prev]);
        toast(`New device: ${d.hostname ?? d.ip ?? "unknown"} (${d.platform ?? "?"})`, "success");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices" }, payload => {
        const d = payload.new as Device;
        setDevices(prev => prev.map(x => x.id === d.id ? d : x));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [toast]);

  const loadCommands = useCallback(async (device: Device) => {
    setSelected(device);
    setLoadingCmds(true);
    try {
      const { data } = await supabase
        .from("commands")
        .select("*")
        .eq("device_id", device.id)
        .order("executed_at", { ascending: false })
        .limit(200);
      setCommands(data ?? []);
    } catch {
      toast("Failed to load command history", "error");
    } finally {
      setLoadingCmds(false);
    }
  }, [toast]);

  const activeCount = devices.filter(d => d.is_active).length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-start justify-between border-b border-white/[0.05] pb-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Supabase Realtime</p>
          <h1 className="mt-1 text-xl font-bold text-white">All Devices</h1>
          <p className="mt-1 text-[11px] text-slate-600">
            Every device ever seen — past &amp; present · real-time updates · click to view full command history
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-green-500 status-pulse" />
          <span className="text-[9px] uppercase tracking-wider text-green-500">{activeCount} Online</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Device list */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
            {devices.length} Total · {activeCount} Active
          </p>

          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <span className="h-4 w-4 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
            </div>
          ) : devices.length === 0 ? (
            <div className="rounded border border-dashed border-white/[0.05] py-10 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-700">No devices yet</p>
              <p className="mt-1 text-[9px] text-slate-800">Devices appear here the moment a payload connects</p>
            </div>
          ) : (
            devices.map(device => {
              const platColor = PLATFORM_COLOR[device.platform?.toLowerCase() ?? ""] ?? "text-slate-400";
              const isSelected = selected?.id === device.id;
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => loadCommands(device)}
                  className={`w-full rounded border p-3.5 text-left transition-all ${
                    isSelected
                      ? "border-red-900/40 bg-red-950/10"
                      : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.10]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${device.is_active ? "bg-green-500 status-pulse" : "bg-slate-700"}`} />
                      <span className="font-mono text-[12px] font-bold text-slate-200">{device.hostname ?? "Unknown"}</span>
                    </div>
                    {device.is_rooted && (
                      <span className="rounded border border-red-900/50 px-1.5 py-px text-[8px] font-bold uppercase text-red-500">ROOT</span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    <p className={`text-[10px] font-semibold ${platColor}`}>{device.platform ?? "unknown"} · {device.arch ?? "?"}</p>
                    <p className="font-mono text-[9px] text-slate-600">{device.ip ?? "no IP"} · {device.username ?? "?"}</p>
                    <p className="text-[9px] text-slate-700">
                      Last seen {new Date(device.last_seen).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {device.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {device.tags.map(tag => (
                        <span key={tag} className="rounded bg-white/[0.04] px-1.5 py-px text-[8px] text-slate-600">{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Command history panel */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="flex h-64 items-center justify-center rounded border border-dashed border-white/[0.05]">
              <p className="text-[10px] uppercase tracking-wider text-slate-700">Select a device to view command history</p>
            </div>
          ) : (
            <div className="rounded border border-white/[0.06] bg-[#06060f] overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
                <div>
                  <p className="text-[12px] font-bold text-slate-200">{selected.hostname ?? "Device"}</p>
                  <p className="text-[10px] text-slate-600">{selected.platform} · Session #{selected.session_id}</p>
                </div>
                <Link href="/agents"
                  className="rounded border border-red-800/50 bg-red-950/20 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-red-400 hover:bg-red-950/40">
                  Control →
                </Link>
              </div>

              {/* Device detail */}
              <div className="grid grid-cols-2 gap-px bg-white/[0.03] border-b border-white/[0.05]">
                {[
                  ["IP", selected.ip], ["Username", selected.username],
                  ["OS", selected.os_version], ["Rooted", selected.is_rooted ? "YES" : "NO"],
                  ["Via", selected.via], ["Workspace", selected.workspace],
                ].map(([k, v]) => (
                  <div key={k} className="bg-[#06060f] px-4 py-2">
                    <p className="text-[8px] uppercase tracking-wider text-slate-700">{k}</p>
                    <p className={`mt-0.5 font-mono text-[10px] ${k === "Rooted" && v === "YES" ? "text-red-400 font-bold" : "text-slate-300"}`}>{v ?? "—"}</p>
                  </div>
                ))}
              </div>

              {/* Command history */}
              <div className="max-h-80 overflow-y-auto">
                {loadingCmds ? (
                  <div className="flex h-16 items-center justify-center">
                    <span className="h-4 w-4 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
                  </div>
                ) : commands.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[10px] text-slate-700">No commands recorded yet</p>
                ) : (
                  commands.map(cmd => (
                    <div key={cmd.id} className="border-b border-white/[0.03] px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-[11px] ${cmd.success ? "text-green-400" : "text-red-400"}`}>
                          {cmd.success ? "✓" : "✗"} {cmd.command}
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-700">
                          {new Date(cmd.executed_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      {cmd.output && (
                        <pre className="mt-1 max-h-20 overflow-hidden text-[9px] text-slate-600 leading-relaxed">
                          {cmd.output.slice(0, 300)}{cmd.output.length > 300 ? "..." : ""}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
