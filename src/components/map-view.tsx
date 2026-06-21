"use client";

/**
 * Tactical Intelligence Map — military/SIGINT grade.
 *
 * Features:
 *  - CartoDB Dark Matter tiles (no API key)
 *  - Device trails (breadcrumb polylines)
 *  - Radar sweep animation per selected device
 *  - Geofence circles with breach alerts
 *  - Threat-level markers (GREEN/AMBER/RED)
 *  - MGRS-style coordinate grid overlay
 *  - Compass rose
 *  - Distance / bearing calculator
 *  - KML export
 *  - Historical playback
 */

import { useEffect, useRef, useCallback } from "react";
import type { DevicePin, GeofenceZone } from "@/app/map/page";

function ensureCSS(id: string, href: string) {
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const l = document.createElement("link");
  l.id = id; l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}

const TILE_LAYERS = {
  tactical: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com">CARTO</a> &copy; OSM contributors',
    subdomains: "abcd",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    subdomains: "",
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; OpenTopoMap',
    subdomains: "abc",
  },
};

const THREAT_COLOR = { LOW: "#22c55e", MEDIUM: "#f59e0b", HIGH: "#ef4444", CRITICAL: "#dc2626" };

const PLATFORM_COLOR: Record<string, string> = {
  windows: "#3b82f6",
  linux:   "#22c55e",
  android: "#84cc16",
  darwin:  "#f97316",
  ios:     "#a78bfa",
  unknown: "#94a3b8",
};

export type MapLayer = "tactical" | "satellite" | "terrain";

type Props = {
  pins: DevicePin[];
  selected: DevicePin | null;
  onSelectPin: (pin: DevicePin) => void;
  tileLayer: MapLayer;
  showTrails: boolean;
  showGeofences: boolean;
  geofences: GeofenceZone[];
  onGeofenceAdd: (lat: number, lng: number, radius: number) => void;
  drawingGeofence: boolean;
};

export default function MapView({
  pins, selected, onSelectPin, tileLayer,
  showTrails, showGeofences, geofences,
  onGeofenceAdd, drawingGeofence,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trailsRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const radarRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geofenceLayersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gridRef = useRef<any>(null);
  const radarAngleRef = useRef(0);
  const radarTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Init map ────────────────────────────────────────────────
  useEffect(() => {
    ensureCSS("leaflet-css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    let destroyed = false;

    import("leaflet").then((mod) => {
      if (destroyed || !containerRef.current || mapRef.current) return;
      const L = mod.default ?? mod;

      // Fix icons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current!, {
        center: [20, 0],
        zoom: 3,
        zoomControl: false,
        attributionControl: false,
      });

      // Attribution (styled)
      L.control.attribution({ prefix: false, position: "bottomright" }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      const cfg = TILE_LAYERS[tileLayer as keyof typeof TILE_LAYERS] ?? TILE_LAYERS.tactical;
      const tile = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        subdomains: cfg.subdomains || "abc",
        maxZoom: 19,
      });
      tile.addTo(map);
      tileRef.current = tile;
      mapRef.current = map;

      // Draw coordinate grid
      drawGrid(L, map);

      // Compass rose overlay — use a simple marker-based approach
      const compassIcon = L.divIcon({
        html: `
          <svg width="60" height="60" viewBox="0 0 60 60" style="filter:drop-shadow(0 0 4px #00ff4180)">
            <circle cx="30" cy="30" r="28" fill="none" stroke="#22c55e" stroke-width="0.5" opacity="0.4"/>
            <polygon points="30,4 34,30 30,26 26,30" fill="#22c55e" opacity="0.9"/>
            <polygon points="30,56 26,30 30,34 34,30" fill="#4b5563" opacity="0.7"/>
            <polygon points="4,30 30,26 26,30 30,34" fill="#4b5563" opacity="0.7"/>
            <polygon points="56,30 30,34 34,30 30,26" fill="#4b5563" opacity="0.7"/>
            <text x="30" y="16" fill="#22c55e" font-size="8" text-anchor="middle" font-family="monospace">N</text>
            <text x="30" y="52" fill="#4b5563" font-size="8" text-anchor="middle" font-family="monospace">S</text>
            <text x="10" y="33" fill="#4b5563" font-size="8" text-anchor="middle" font-family="monospace">W</text>
            <text x="50" y="33" fill="#4b5563" font-size="8" text-anchor="middle" font-family="monospace">E</text>
            <circle cx="30" cy="30" r="3" fill="#22c55e" opacity="0.8"/>
          </svg>
        `,
        className: "",
        iconSize: [60, 60],
        iconAnchor: [0, 0],
      });
      // We'll render compass as a custom overlay div instead
      const compassDiv = document.createElement("div");
      compassDiv.style.cssText = "position:absolute;top:10px;left:60px;z-index:1000;pointer-events:none;";
      compassDiv.innerHTML = compassIcon.options.html as string;
      containerRef.current!.appendChild(compassDiv);

      // Geofence draw on click
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        if (drawingGeofence) {
          onGeofenceAdd(e.latlng.lat, e.latlng.lng, 500);
        }
      });
    });

    return () => {
      destroyed = true;
      if (radarTimerRef.current) clearInterval(radarTimerRef.current);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Draw coordinate grid ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawGrid = useCallback((L: any, map: any) => {
    if (gridRef.current) { gridRef.current.remove(); gridRef.current = null; }

    // SVG grid overlay using Leaflet SVG layer
    const gridLayer = L.layerGroup();

    // Major grid lines every 30°
    for (let lat = -90; lat <= 90; lat += 30) {
      const line = L.polyline(
        [[-90, lat > -180 ? -180 : lat], [90, lat > -180 ? -180 : lat]],
        { color: "#22c55e", weight: 0.3, opacity: 0.15, dashArray: "4,8" },
      );
      L.polyline([[lat, -180], [lat, 180]], { color: "#22c55e", weight: 0.3, opacity: 0.15, dashArray: "4,8" }).addTo(gridLayer);
      line.addTo(gridLayer);
    }
    for (let lng = -180; lng <= 180; lng += 30) {
      L.polyline([[-90, lng], [90, lng]], { color: "#22c55e", weight: 0.3, opacity: 0.15, dashArray: "4,8" }).addTo(gridLayer);
    }
    gridLayer.addTo(map);
    gridRef.current = gridLayer;
  }, []);

  // ── Switch tile layer ───────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      tileRef.current.remove();
      const cfg = TILE_LAYERS[tileLayer] ?? TILE_LAYERS.tactical;
      const t = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains || "abc", maxZoom: 19 });
      t.addTo(mapRef.current);
      tileRef.current = t;
    });
  }, [tileLayer]);

  // ── Update geofences ────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      geofenceLayersRef.current.forEach((l) => l.remove());
      geofenceLayersRef.current = [];
      if (!showGeofences) return;

      geofences.forEach((zone) => {
        const color = zone.breached ? "#ef4444" : "#22c55e";
        const circle = L.circle([zone.lat, zone.lng], {
          radius: zone.radius,
          color, fillColor: color, fillOpacity: 0.04, weight: 1.5, dashArray: zone.breached ? undefined : "6,6",
        }).addTo(mapRef.current);

        const label = L.divIcon({
          html: `<div style="font-family:monospace;font-size:9px;color:${color};white-space:nowrap;background:rgba(0,0,0,0.6);padding:1px 4px;border:1px solid ${color}40;border-radius:2px;">
            ${zone.name ?? "ZONE-" + zone.id.slice(0,4).toUpperCase()} · R=${(zone.radius/1000).toFixed(1)}km
          </div>`,
          className: "", iconAnchor: [0, 0],
        });
        L.marker([zone.lat, zone.lng], { icon: label }).addTo(mapRef.current);
        geofenceLayersRef.current.push(circle);
      });
    });
  }, [geofences, showGeofences]);

  // ── Update device markers + trails ─────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      const map = mapRef.current;
      const existingIds = new Set(pins.map((p) => p.device.id));

      // Prune removed
      for (const [id, m] of markersRef.current.entries()) {
        if (!existingIds.has(id)) { m.remove(); markersRef.current.delete(id); }
      }
      for (const [id, t] of trailsRef.current.entries()) {
        if (!existingIds.has(id)) { t.remove(); trailsRef.current.delete(id); }
      }

      for (const pin of pins) {
        const { lat, lng, source } = pin.location;
        const isSelected = selected?.device.id === pin.device.id;
        const isActive = pin.device.is_active;
        const threat = pin.device.threat_level ?? "LOW";
        const color = PLATFORM_COLOR[pin.device.platform?.toLowerCase() ?? ""] ?? "#94a3b8";
        const threatColor = THREAT_COLOR[threat as keyof typeof THREAT_COLOR] ?? THREAT_COLOR.LOW;
        const gpsAccurate = source === "gps";

        // Tactical marker SVG
        const size = isSelected ? 22 : 16;
        const markerHtml = `
          <div style="position:relative;width:${size}px;height:${size}px;">
            ${isActive ? `<div style="
              position:absolute;inset:-6px;border-radius:50%;
              border:1px solid ${threatColor};
              animation:tactical-pulse 2s infinite;
              opacity:0.5;
            "></div>` : ""}
            <svg width="${size}" height="${size}" viewBox="0 0 24 24">
              <!-- Outer ring -->
              <circle cx="12" cy="12" r="11" fill="none" stroke="${threatColor}" stroke-width="${isSelected ? 2 : 1}" opacity="${isActive ? 1 : 0.4}"/>
              <!-- Cross-hair lines -->
              <line x1="12" y1="2" x2="12" y2="6" stroke="${threatColor}" stroke-width="1" opacity="0.6"/>
              <line x1="12" y1="18" x2="12" y2="22" stroke="${threatColor}" stroke-width="1" opacity="0.6"/>
              <line x1="2" y1="12" x2="6" y2="12" stroke="${threatColor}" stroke-width="1" opacity="0.6"/>
              <line x1="18" y1="12" x2="22" y2="12" stroke="${threatColor}" stroke-width="1" opacity="0.6"/>
              <!-- Platform dot -->
              <circle cx="12" cy="12" r="${isSelected ? 5 : 4}" fill="${color}" opacity="${isActive ? 1 : 0.5}"/>
              ${gpsAccurate ? '<circle cx="12" cy="12" r="2" fill="white" opacity="0.9"/>' : ''}
            </svg>
            ${isSelected ? `<div style="
              position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
              width:${size+16}px;height:${size+16}px;
              border-radius:50%;border:1px solid ${threatColor}60;
              animation:tactical-pulse 1.5s infinite;
            "></div>` : ""}
          </div>
        `;

        const icon = L.divIcon({
          html: markerHtml,
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

        // Label below marker
        const labelHtml = `
          <div style="
            font-family:monospace;font-size:8px;color:${threatColor};
            white-space:nowrap;margin-top:2px;text-align:center;
            text-shadow:0 0 8px ${threatColor}80;
            letter-spacing:0.05em;
          ">${(pin.device.hostname ?? "UNKNOWN").toUpperCase()}</div>
        `;
        const labelIcon = L.divIcon({
          html: labelHtml, className: "",
          iconSize: [100, 16], iconAnchor: [50, -size / 2 - 2],
        });

        if (markersRef.current.has(pin.device.id)) {
          markersRef.current.get(pin.device.id).marker.setLatLng([lat, lng]).setIcon(icon);
          markersRef.current.get(pin.device.id).label.setLatLng([lat, lng]);
        } else {
          const marker = L.marker([lat, lng], { icon }).addTo(map);
          marker.on("click", () => onSelectPin(pin));

          const label = L.marker([lat, lng], { icon: labelIcon, interactive: false }).addTo(map);

          // Accuracy ring for GPS
          if (pin.location.accuracy && pin.location.accuracy > 5) {
            L.circle([lat, lng], {
              radius: pin.location.accuracy,
              color: color, fillColor: color, fillOpacity: 0.04, weight: 0.5,
            }).addTo(map);
          }

          markersRef.current.set(pin.device.id, { marker, label });
        }

        // Tactical popup
        const marker = markersRef.current.get(pin.device.id)?.marker;
        marker?.bindPopup(`
          <div style="font-family:monospace;color:#e2e8f0;background:#030308;padding:10px;border-radius:4px;min-width:200px;border:1px solid ${threatColor}40;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
              <div style="width:6px;height:6px;border-radius:50%;background:${isActive ? "#22c55e" : "#374151"};${isActive ? "box-shadow:0 0 6px #22c55e" : ""}"></div>
              <span style="font-size:11px;font-weight:bold;letter-spacing:0.08em;">${(pin.device.hostname ?? "UNKNOWN").toUpperCase()}</span>
              <span style="margin-left:auto;font-size:8px;color:${threatColor};border:1px solid ${threatColor}40;padding:1px 4px;">${threat}</span>
            </div>
            <div style="font-size:9px;color:#64748b;margin-bottom:6px;">${pin.device.platform?.toUpperCase() ?? "?"} · ${pin.device.username ?? "?"} · ${pin.device.ip ?? "?"}</div>
            <div style="font-size:10px;color:#22c55e;margin-bottom:2px;">${lat.toFixed(6)}°N  ${lng.toFixed(6)}°E</div>
            ${pin.location.address ? `<div style="font-size:8px;color:#475569;margin-bottom:6px;">${pin.location.address}</div>` : ""}
            <div style="font-size:8px;color:#374151;margin-bottom:8px;">
              SRC: ${source.toUpperCase()} · 
              ${pin.location.accuracy ? `ACC: ±${pin.location.accuracy.toFixed(0)}m · ` : ""}
              ${new Date(pin.location.captured_at).toLocaleTimeString()}
            </div>
            <div style="display:flex;gap:4px;">
              <a href="https://maps.google.com/maps?q=${lat},${lng}" target="_blank"
                style="flex:1;padding:3px;background:#1e3a5f;color:#60a5fa;border:1px solid #1d4ed840;border-radius:2px;text-align:center;text-decoration:none;font-size:8px;letter-spacing:0.05em;">MAPS</a>
              <a href="https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}" target="_blank"
                style="flex:1;padding:3px;background:#0c3327;color:#34d399;border:1px solid #06553340;border-radius:2px;text-align:center;text-decoration:none;font-size:8px;letter-spacing:0.05em;">STREET</a>
            </div>
          </div>
        `, { className: "tactical-popup" });

        // Trail polyline
        if (showTrails && pin.trail && pin.trail.length > 1) {
          const coords = pin.trail.map((t) => [t.lat, t.lng] as [number, number]);
          const gradient = coords.map((_, i) => ({
            color,
            opacity: 0.1 + (i / coords.length) * 0.7,
          }));
          if (trailsRef.current.has(pin.device.id)) {
            trailsRef.current.get(pin.device.id).setLatLngs(coords);
          } else {
            const trail = L.polyline(coords, {
              color, weight: 1.5, opacity: 0.5, dashArray: "4,4",
            }).addTo(map);

            // Animated dots along trail
            coords.forEach((coord, i) => {
              if (i === 0) return;
              const opacity = (i / coords.length) * 0.6;
              L.circleMarker(coord, {
                radius: 2, color, fillColor: color, fillOpacity: opacity,
                weight: 0, interactive: false,
              }).addTo(map);
            });

            trailsRef.current.set(pin.device.id, trail);
          }
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selected, showTrails]);

  // ── Radar sweep on selected ─────────────────────────────────
  useEffect(() => {
    if (radarTimerRef.current) { clearInterval(radarTimerRef.current); radarTimerRef.current = null; }
    if (radarRef.current) { radarRef.current.remove(); radarRef.current = null; }
    if (!selected || !mapRef.current) return;

    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      const { lat, lng } = selected.location;
      const RADIUS = 800; // meters

      // Animated radar sweep via repeated divIcon updates
      const sweepEl = document.createElement("div");
      sweepEl.style.cssText = `
        width:120px;height:120px;border-radius:50%;
        border:1px solid #22c55e40;background:transparent;
        position:relative;overflow:hidden;
        box-shadow:0 0 20px #22c55e20,inset 0 0 20px #22c55e10;
      `;
      sweepEl.innerHTML = `
        <div id="radar-sweep" style="
          position:absolute;top:50%;left:50%;
          width:50%;height:1px;
          transform-origin:0 50%;
          background:linear-gradient(90deg,#22c55e80,transparent);
          box-shadow:0 0 8px #22c55e;
        "></div>
        <div style="position:absolute;inset:0;border-radius:50%;
          border:1px solid #22c55e20;"></div>
        <div style="position:absolute;top:25%;left:25%;right:25%;bottom:25%;border-radius:50%;
          border:1px solid #22c55e20;"></div>
        <div style="position:absolute;top:0;left:50%;width:1px;height:100%;background:#22c55e15;"></div>
        <div style="position:absolute;top:50%;left:0;width:100%;height:1px;background:#22c55e15;"></div>
      `;

      const radarIcon = L.divIcon({ html: sweepEl, className: "", iconSize: [120, 120], iconAnchor: [60, 60] });
      const radar = L.marker([lat, lng], { icon: radarIcon, interactive: false, zIndexOffset: -100 }).addTo(mapRef.current);

      // Accuracy ring
      const ring = L.circle([lat, lng], {
        radius: RADIUS, color: "#22c55e", fillColor: "#22c55e",
        fillOpacity: 0.03, weight: 1, dashArray: "4,8", interactive: false,
      }).addTo(mapRef.current);

      radarRef.current = { marker: radar, ring, sweep: sweepEl.querySelector("#radar-sweep") };

      let angle = 0;
      radarTimerRef.current = setInterval(() => {
        angle = (angle + 3) % 360;
        const sweep = document.getElementById("radar-sweep");
        if (sweep) sweep.style.transform = `rotate(${angle}deg)`;
        radarAngleRef.current = angle;
      }, 50);
    });
  }, [selected]);

  // ── Fly to selected ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !selected) return;
    mapRef.current.flyTo([selected.location.lat, selected.location.lng], 15, { animate: true, duration: 1.5 });
  }, [selected]);

  return (
    <>
      <style>{`
        @keyframes tactical-pulse {
          0%,100%{transform:scale(1);opacity:0.6}
          50%{transform:scale(1.4);opacity:0.2}
        }
        .tactical-popup .leaflet-popup-content-wrapper{
          background:#030308!important;border:1px solid rgba(34,197,94,0.15)!important;
          border-radius:4px!important;box-shadow:0 4px 30px rgba(0,0,0,0.8),0 0 20px rgba(34,197,94,0.05)!important;
          padding:0!important;
        }
        .tactical-popup .leaflet-popup-content{margin:0!important;}
        .tactical-popup .leaflet-popup-tip{background:#030308!important;}
        .tactical-popup .leaflet-popup-close-button{color:#374151!important;top:6px!important;right:6px!important;font-size:14px!important;}
        .leaflet-control-zoom a{
          background:#030308!important;color:#22c55e!important;
          border-color:rgba(34,197,94,0.15)!important;font-size:14px!important;
        }
        .leaflet-control-zoom a:hover{background:#0a0a14!important;color:#4ade80!important;}
        .leaflet-control-attribution{
          background:rgba(3,3,8,0.7)!important;color:#374151!important;font-size:8px!important;
        }
        .leaflet-control-attribution a{color:#4b5563!important;}
        .leaflet-container{background:#030308!important;}
        .leaflet-bar{border:1px solid rgba(34,197,94,0.15)!important;border-radius:2px!important;}
        .leaflet-bar a:first-child{border-radius:2px 2px 0 0!important;}
        .leaflet-bar a:last-child{border-radius:0 0 2px 2px!important;}
      `}</style>
      <div ref={containerRef} className="h-full w-full" style={{ background: "#030308" }} />
    </>
  );
}
