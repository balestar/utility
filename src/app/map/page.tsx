"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { MapLayer } from "@/components/map-view";

export type DevicePin = {
  device: {
    id: string; hostname: string | null; ip: string | null;
    platform: string | null; username: string | null;
    is_active: boolean; threat_level?: string;
    session_id?: number | null;
  };
  location: {
    lat: number; lng: number; accuracy: number | null;
    source: string; address: string | null;
    city: string | null; country: string | null;
    captured_at: string;
  };
  trail: Array<{ lat: number; lng: number; captured_at: string }>;
};

export type GeofenceZone = {
  id: string; lat: number; lng: number; radius: number;
  name?: string; breached: boolean;
};

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-[#030308]">
      <div className="text-center">
        <div className="text-green-400 font-mono text-xs tracking-widest animate-pulse mb-2">
          INITIALIZING TACTICAL GRID…
        </div>
        <div className="w-48 h-0.5 bg-green-900 mx-auto overflow-hidden">
          <div className="h-full w-1/2 bg-green-400 animate-[slide_1s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  ),
});

type HistoryPoint = {
  lat: number; lng: number; source: string;
  accuracy: number | null; captured_at: string;
  address: string | null;
};

const THREAT_COLORS: Record<string, string> = {
  LOW: "text-green-400 border-green-800",
  MEDIUM: "text-yellow-400 border-yellow-800",
  HIGH: "text-orange-400 border-orange-800",
  CRITICAL: "text-red-400 border-red-800",
};

export default function TacticalMapPage() {
  const [pins, setPins] = useState<DevicePin[]>([]);
  const [selected, setSelected] = useState<DevicePin | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [tileLayer, setTileLayer] = useState<MapLayer>("tactical");
  const [showTrails, setShowTrails] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);
  const [drawingGeofence, setDrawingGeofence] = useState(false);
  const [geofences, setGeofences] = useState<GeofenceZone[]>([]);
  const [status, setStatus] = useState("STANDBY");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [trackingAll, setTrackingAll] = useState(false);
  const [playback, setPlayback] = useState(false);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [capturedNow, setCapturedNow] = useState<string | null>(null);
  const [distMode, setDistMode] = useState(false);
  const [distPins, setDistPins] = useState<DevicePin[]>([]);
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<"all" | "active" | "gps">("all");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // ── Load pins ────────────────────────────────────────────────
  const loadPins = useCallback(async () => {
    const res = await fetch("/api/location");
    if (!res.ok) return;
    const data = await res.json() as {
      locations: Array<{
        device_id: string; lat: number; lng: number; accuracy: number | null;
        source: string; address: string | null; city: string | null;
        country: string | null; captured_at: string;
      }>;
      devices: Array<{
        id: string; hostname: string | null; ip: string | null;
        platform: string | null; username: string | null;
        is_active: boolean; threat_level?: string; session_id?: number | null;
      }>;
    };
    const deviceMap = new Map(data.devices.map((d) => [d.id, d]));

    // Load trails from Supabase
    const newPins: DevicePin[] = [];
    for (const loc of data.locations) {
      const device = deviceMap.get(loc.device_id);
      if (!device) continue;

      const { data: trail } = await supabase
        .from("locations")
        .select("lat,lng,captured_at")
        .eq("device_id", loc.device_id)
        .order("captured_at", { ascending: true })
        .limit(50);

      newPins.push({ device, location: loc, trail: trail ?? [] });
    }

    // Check geofence breaches
    if (geofences.length > 0) {
      const updatedGeo = geofences.map((zone) => {
        const breached = newPins.some((p) => {
          const R = 6371000;
          const dLat = ((p.location.lat - zone.lat) * Math.PI) / 180;
          const dLng = ((p.location.lng - zone.lng) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((zone.lat * Math.PI) / 180) * Math.cos((p.location.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= zone.radius;
        });
        if (breached && !zone.breached) {
          setAlert(`⚠ GEOFENCE BREACH: ${zone.name ?? zone.id.slice(0, 8).toUpperCase()}`);
          setTimeout(() => setAlert(null), 5000);
        }
        return { ...zone, breached };
      });
      setGeofences(updatedGeo);
    }

    setPins(newPins);
    setLastUpdate(new Date());
    setStatus("NOMINAL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadPins(); }, [loadPins]);

  // Realtime location updates
  useEffect(() => {
    const ch = supabase
      .channel("locations-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "locations" }, () => {
        setStatus("UPLINK");
        setTimeout(() => setStatus("NOMINAL"), 2000);
        loadPins();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadPins]);

  // Auto-refresh every 30 min
  useEffect(() => {
    const t = setInterval(loadPins, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [loadPins]);

  // ── Select device & load history ────────────────────────────
  const selectPin = useCallback(async (pin: DevicePin) => {
    setSelected(pin);
    if (distMode) {
      setDistPins((prev) => {
        const next = [...prev, pin].slice(-2);
        return next;
      });
    }

    const { data } = await supabase
      .from("locations")
      .select("lat,lng,source,accuracy,captured_at,address")
      .eq("device_id", pin.device.id)
      .order("captured_at", { ascending: false })
      .limit(100);
    setHistory((data as HistoryPoint[]) ?? []);
    setPlaybackIdx(0);
    if (playbackTimer.current) clearInterval(playbackTimer.current);
    setPlayback(false);
  }, [distMode]);

  // ── Track all ───────────────────────────────────────────────
  const trackAll = useCallback(async () => {
    setTrackingAll(true);
    setStatus("SCANNING");
    const r = await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "track_all" }),
    });
    const d = await r.json() as { captured: number };
    setCapturedNow(`${d.captured} target(s) acquired`);
    setTimeout(() => setCapturedNow(null), 4000);
    setTrackingAll(false);
    await loadPins();
    setStatus("NOMINAL");
  }, [loadPins]);

  // ── Capture single ──────────────────────────────────────────
  const captureSelected = useCallback(async () => {
    if (!selected) return;
    setStatus("SCANNING");
    await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: selected.device.session_id, device_id: selected.device.id }),
    });
    await loadPins();
    const devPin = pins.find((p) => p.device.id === selected.device.id);
    if (devPin) { selectPin(devPin); }
    setStatus("NOMINAL");
  }, [selected, loadPins, pins, selectPin]);

  // ── Playback ─────────────────────────────────────────────────
  const startPlayback = useCallback(() => {
    if (!history.length) return;
    setPlayback(true);
    setPlaybackIdx(history.length - 1); // start from oldest
    playbackTimer.current = setInterval(() => {
      setPlaybackIdx((i) => {
        if (i <= 0) {
          clearInterval(playbackTimer.current!);
          setPlayback(false);
          return 0;
        }
        return i - 1;
      });
    }, 1000);
  }, [history]);

  const stopPlayback = useCallback(() => {
    if (playbackTimer.current) clearInterval(playbackTimer.current);
    setPlayback(false);
    setPlaybackIdx(0);
  }, []);

  // ── Distance calc ────────────────────────────────────────────
  const distanceKm = useCallback(() => {
    if (distPins.length < 2) return null;
    const [a, b] = distPins;
    const R = 6371;
    const dLat = ((b.location.lat - a.location.lat) * Math.PI) / 180;
    const dLng = ((b.location.lng - a.location.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos((a.location.lat * Math.PI) / 180) * Math.cos((b.location.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }, [distPins]);

  // ── KML Export ───────────────────────────────────────────────
  const exportKML = useCallback(() => {
    const placemarks = pins.map((p) => `
  <Placemark>
    <name>${p.device.hostname ?? "UNKNOWN"}</name>
    <description>${p.device.ip ?? ""} - ${p.device.platform ?? ""}</description>
    <Point><coordinates>${p.location.lng},${p.location.lat},0</coordinates></Point>
    ${p.trail.length > 1 ? `<LineString><coordinates>${p.trail.map((t) => `${t.lng},${t.lat},0`).join("\n")}</coordinates></LineString>` : ""}
  </Placemark>`).join("\n");

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>UTILITY — Device Tracks — ${new Date().toISOString()}</name>
    ${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tracks-${Date.now()}.kml`;
    a.click(); URL.revokeObjectURL(url);
  }, [pins]);

  // ── Filtered pins ────────────────────────────────────────────
  const visiblePins = pins.filter((p) => {
    if (deviceFilter === "active") return p.device.is_active;
    if (deviceFilter === "gps") return p.location.source === "gps";
    return true;
  });

  // Current playback point
  const playbackPoint = history[playbackIdx] ?? null;
  const dist = distanceKm();

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">
      {/* ── LEFT PANEL ────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-green-900/30 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-green-900/30">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${status === "NOMINAL" ? "bg-green-400" : status === "SCANNING" ? "bg-yellow-400 animate-pulse" : "bg-blue-400 animate-pulse"}`} />
            <span className="text-[10px] tracking-widest text-green-500">{status}</span>
            <span className="ml-auto text-[9px] text-green-900">{lastUpdate.toLocaleTimeString()}</span>
          </div>
          <div className="text-[9px] text-green-900 tracking-widest">SIGINT TACTICAL MAP</div>
          <div className="text-[8px] text-green-900/50 mt-0.5">CLASS: TOP SECRET // ORCON</div>
        </div>

        {/* Filters */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 mb-1.5 tracking-widest">TARGET FILTER</div>
          <div className="flex gap-1">
            {(["all", "active", "gps"] as const).map((f) => (
              <button key={f} onClick={() => setDeviceFilter(f)}
                className={`flex-1 text-[9px] py-1 rounded border transition-all tracking-wider ${
                  deviceFilter === f
                    ? "bg-green-950 border-green-700 text-green-300"
                    : "border-green-900/20 text-green-900 hover:border-green-800 hover:text-green-700"
                }`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="text-[9px] text-green-900 mb-2 tracking-widest">
            CONTACTS ({visiblePins.length}/{pins.length})
          </div>
          {visiblePins.map((pin) => {
            const threat = pin.device.threat_level ?? "LOW";
            const tCls = THREAT_COLORS[threat] ?? THREAT_COLORS.LOW;
            const isSelected = selected?.device.id === pin.device.id;
            return (
              <button
                key={pin.device.id}
                onClick={() => selectPin(pin)}
                className={`w-full text-left p-2 rounded border transition-all ${
                  isSelected
                    ? "bg-green-950/50 border-green-700/60"
                    : "border-green-900/20 hover:bg-green-950/20 hover:border-green-800/40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pin.device.is_active ? "bg-green-400" : "bg-gray-700"}`} />
                  <span className={`text-[10px] truncate ${isSelected ? "text-green-300" : "text-green-600"}`}>
                    {(pin.device.hostname ?? "UNKNOWN").toUpperCase()}
                  </span>
                  <span className={`ml-auto text-[8px] border px-1 rounded-sm ${tCls}`}>{threat[0]}</span>
                </div>
                <div className="text-[8px] text-green-900 ml-3">{pin.device.ip ?? "—"}</div>
                <div className="text-[8px] text-green-900 ml-3">{pin.location.source.toUpperCase()} · {new Date(pin.location.captured_at).toLocaleTimeString()}</div>
              </button>
            );
          })}
          {visiblePins.length === 0 && (
            <div className="text-center text-[9px] text-green-900 py-4">NO TARGETS ACQUIRED</div>
          )}
        </div>

        {/* Controls */}
        <div className="p-2 border-t border-green-900/30 space-y-1.5">
          <button onClick={trackAll} disabled={trackingAll}
            className="w-full py-1.5 text-[10px] tracking-widest border border-green-700/50 bg-green-950/40 hover:bg-green-900/40 text-green-400 rounded transition-all disabled:opacity-50">
            {trackingAll ? "SCANNING…" : "⊕ TRACK ALL"}
          </button>
          {capturedNow && (
            <div className="text-center text-[9px] text-green-400 animate-pulse">{capturedNow}</div>
          )}
          <button onClick={exportKML}
            className="w-full py-1.5 text-[10px] tracking-widest border border-green-900/30 hover:border-green-800/50 text-green-800 hover:text-green-700 rounded transition-all">
            ↓ EXPORT KML
          </button>
        </div>
      </aside>

      {/* ── MAP AREA ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-green-900/30 bg-[#030308] flex-shrink-0 z-10">
          {/* Tile switcher */}
          {(["tactical", "satellite", "terrain"] as MapLayer[]).map((t) => (
            <button key={t} onClick={() => setTileLayer(t)}
              className={`text-[9px] px-2 py-0.5 border rounded tracking-widest transition-all ${
                tileLayer === t ? "border-green-600 text-green-400 bg-green-950/60" : "border-green-900/20 text-green-900 hover:border-green-800"
              }`}>{t.toUpperCase()}</button>
          ))}
          <div className="h-4 w-px bg-green-900/30 mx-1" />
          <button onClick={() => setShowTrails((v) => !v)}
            className={`text-[9px] px-2 py-0.5 border rounded tracking-widest transition-all ${showTrails ? "border-green-600 text-green-400" : "border-green-900/20 text-green-900"}`}>
            TRAILS
          </button>
          <button onClick={() => setShowGeofences((v) => !v)}
            className={`text-[9px] px-2 py-0.5 border rounded tracking-widest transition-all ${showGeofences ? "border-green-600 text-green-400" : "border-green-900/20 text-green-900"}`}>
            ZONES
          </button>
          <button
            onClick={() => { setDrawingGeofence((v) => !v); }}
            className={`text-[9px] px-2 py-0.5 border rounded tracking-widest transition-all ${drawingGeofence ? "border-yellow-600 text-yellow-400 animate-pulse" : "border-green-900/20 text-green-900"}`}>
            {drawingGeofence ? "CLICK MAP TO PLACE" : "+ GEOFENCE"}
          </button>
          <div className="h-4 w-px bg-green-900/30 mx-1" />
          <button
            onClick={() => { setDistMode((v) => !v); setDistPins([]); }}
            className={`text-[9px] px-2 py-0.5 border rounded tracking-widest transition-all ${distMode ? "border-blue-600 text-blue-400" : "border-green-900/20 text-green-900"}`}>
            {distMode ? `DIST${dist !== null ? ": " + dist.toFixed(1) + "km" : ": SELECT 2"}` : "MEASURE"}
          </button>

          {/* Coordinates readout */}
          <div className="ml-auto text-[9px] text-green-800 tracking-widest">
            {coords ? `${coords.lat.toFixed(5)}°N  ${coords.lng.toFixed(5)}°E` : "HOVER FOR COORDS"}
          </div>
        </div>

        {/* Alert banner */}
        {alert && (
          <div className="absolute top-9 left-0 right-0 z-20 bg-red-950/90 border-b border-red-700/50 px-4 py-1.5 text-[11px] text-red-400 tracking-widest animate-pulse">
            {alert}
          </div>
        )}

        {/* Map */}
        <div className="flex-1 relative">
          <MapView
            pins={visiblePins}
            selected={playback && playbackPoint
              ? { ...(selected!), location: { ...selected!.location, lat: playbackPoint.lat, lng: playbackPoint.lng, captured_at: playbackPoint.captured_at } }
              : selected}
            onSelectPin={(pin) => { selectPin(pin); setCoords({ lat: pin.location.lat, lng: pin.location.lng }); }}
            tileLayer={tileLayer}
            showTrails={showTrails}
            showGeofences={showGeofences}
            geofences={geofences}
            onGeofenceAdd={(lat, lng, radius) => {
              const id = crypto.randomUUID();
              setGeofences((prev) => [...prev, { id, lat, lng, radius, name: `ZONE-${prev.length + 1}`, breached: false }]);
              setDrawingGeofence(false);
            }}
            drawingGeofence={drawingGeofence}
          />
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-l border-green-900/30 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Device intel */}
            <div className="p-3 border-b border-green-900/30">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${selected.device.is_active ? "bg-green-400 shadow-[0_0_6px_#22c55e]" : "bg-gray-700"}`} />
                <span className="text-[11px] text-green-300 font-bold tracking-wider">
                  {(selected.device.hostname ?? "UNKNOWN").toUpperCase()}
                </span>
              </div>
              <table className="w-full text-[9px] leading-5">
                {(
                  [
                    ["IP", selected.device.ip ?? "—"],
                    ["OS", selected.device.platform?.toUpperCase() ?? "—"],
                    ["USER", selected.device.username ?? "—"],
                    ["THREAT", selected.device.threat_level ?? "LOW"],
                    ["SOURCE", selected.location.source.toUpperCase()],
                    ["LAT", selected.location.lat.toFixed(6) + "°"],
                    ["LNG", selected.location.lng.toFixed(6) + "°"],
                    selected.location.accuracy ? ["ACC", `±${selected.location.accuracy.toFixed(0)}m`] : null,
                    ["CITY", selected.location.city ?? "—"],
                    ["COUNTRY", selected.location.country ?? "—"],
                  ] as Array<[string, string] | null>
                ).filter((x): x is [string, string] => x !== null).map(([k, v]) => (
                  <tr key={k}>
                    <td className="text-green-900 pr-2 w-16">{k}</td>
                    <td className="text-green-600">{v}</td>
                  </tr>
                ))}
              </table>
              {selected.location.address && (
                <div className="text-[8px] text-green-900/60 mt-1 leading-tight">{selected.location.address}</div>
              )}
            </div>

            {/* Actions */}
            <div className="p-2 border-b border-green-900/30 grid grid-cols-2 gap-1">
              <button onClick={captureSelected}
                className="py-1.5 text-[9px] tracking-widest border border-green-700/40 bg-green-950/30 hover:bg-green-900/40 text-green-500 rounded transition-all">
                CAPTURE NOW
              </button>
              <a href={`https://maps.google.com/maps?q=${selected.location.lat},${selected.location.lng}`} target="_blank"
                className="py-1.5 text-[9px] tracking-widest border border-blue-900/40 text-blue-600 hover:text-blue-400 hover:border-blue-700/60 rounded transition-all text-center">
                GOOGLE MAP
              </a>
              <a href={`https://maps.google.com/maps?q=&layer=c&cbll=${selected.location.lat},${selected.location.lng}`} target="_blank"
                className="py-1.5 text-[9px] tracking-widest border border-blue-900/40 text-blue-600 hover:text-blue-400 hover:border-blue-700/60 rounded transition-all text-center col-span-2">
                ↗ STREET VIEW
              </a>
            </div>

            {/* Playback */}
            <div className="p-2 border-b border-green-900/30">
              <div className="text-[9px] text-green-900 mb-1.5 tracking-widest">TRACK PLAYBACK</div>
              <div className="flex gap-1 mb-2">
                {!playback ? (
                  <button onClick={startPlayback} disabled={history.length < 2}
                    className="flex-1 py-1 text-[9px] border border-green-800/50 text-green-600 hover:text-green-400 rounded transition-all disabled:opacity-30">
                    ▶ PLAY
                  </button>
                ) : (
                  <button onClick={stopPlayback}
                    className="flex-1 py-1 text-[9px] border border-yellow-700/50 text-yellow-500 rounded animate-pulse">
                    ■ STOP
                  </button>
                )}
              </div>
              {playback && playbackPoint && (
                <div className="text-[8px] text-yellow-600">
                  {new Date(playbackPoint.captured_at).toLocaleString()}
                </div>
              )}
              {history.length > 0 && (
                <div className="text-[9px] text-green-900">{history.length} FIXES RECORDED</div>
              )}
            </div>

            {/* Location history */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="text-[9px] text-green-900 mb-2 tracking-widest">LOCATION HISTORY</div>
              <div className="space-y-1">
                {history.map((h, i) => (
                  <div key={i} className={`border border-green-900/20 rounded p-1.5 ${i === 0 ? "border-green-700/40 bg-green-950/20" : ""}`}>
                    <div className="text-[9px] text-green-500">{h.lat.toFixed(5)}°N  {h.lng.toFixed(5)}°E</div>
                    <div className="text-[8px] text-green-900">
                      {h.source.toUpperCase()} · {h.accuracy ? `±${h.accuracy.toFixed(0)}m · ` : ""}{new Date(h.captured_at).toLocaleString()}
                    </div>
                    {h.address && <div className="text-[8px] text-green-900/60 leading-tight mt-0.5">{h.address}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Geofence list */}
            {geofences.length > 0 && (
              <div className="p-2 border-t border-green-900/30">
                <div className="text-[9px] text-green-900 mb-1.5 tracking-widest">ACTIVE ZONES</div>
                {geofences.map((z) => (
                  <div key={z.id} className={`flex items-center gap-1 text-[9px] mb-1 ${z.breached ? "text-red-400 animate-pulse" : "text-green-800"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${z.breached ? "bg-red-400" : "bg-green-900"}`} />
                    <span>{z.name ?? z.id.slice(0, 8).toUpperCase()}</span>
                    <span className="ml-auto">{(z.radius / 1000).toFixed(1)}km</span>
                    <button onClick={() => setGeofences((prev) => prev.filter((g) => g.id !== z.id))}
                      className="ml-1 text-green-900 hover:text-red-500">✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
            <div className="text-[9px] text-green-900 tracking-widest mb-2">NO TARGET SELECTED</div>
            <div className="text-[8px] text-green-900/50 leading-relaxed">
              Select a contact from the left panel or click a marker on the map to access SIGINT data.
            </div>
            <div className="mt-4 text-[8px] text-green-900/30 tracking-widest">
              {pins.length} TOTAL CONTACTS
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
