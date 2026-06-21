"use client";

/**
 * Interactive Leaflet map for device tracking.
 * Must be dynamically imported (no SSR) because Leaflet uses window.
 */

import { useEffect, useRef } from "react";
import type { DevicePin } from "@/app/map/page";
import type { StoredLocation } from "@/lib/geolocation";

// Inject Leaflet CSS globally (once)
function ensureLeafletCSS() {
  if (typeof document === "undefined") return;
  if (document.querySelector("#leaflet-css")) return;
  const link = document.createElement("link");
  link.id = "leaflet-css";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

const TILE_LAYERS = {
  map: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
  },
};

type Props = {
  pins: DevicePin[];
  selected: DevicePin | null;
  onSelectPin: (pin: DevicePin) => void;
  tileLayer: "map" | "satellite";
};

export default function MapView({ pins, selected, onSelectPin, tileLayer }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathsRef = useRef<Map<string, any>>(new Map());

  // ── Initialize map ──────────────────────────────────────────
  useEffect(() => {
    ensureLeafletCSS();

    let L: typeof import("leaflet");
    let destroyed = false;

    import("leaflet").then((mod) => {
      if (destroyed || !containerRef.current || mapRef.current) return;
      L = mod.default ?? mod;

      // Fix default marker icon path
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current!, {
        center: [20, 0],
        zoom: 3,
        zoomControl: true,
        attributionControl: true,
      });

      // Add custom dark base layer
      const tile = L.tileLayer(TILE_LAYERS[tileLayer].url, {
        attribution: TILE_LAYERS[tileLayer].attribution,
        maxZoom: 19,
      });
      tile.addTo(map);
      tileRef.current = tile;
      mapRef.current = map;

      // Dark map style
      if (containerRef.current) {
        containerRef.current.style.filter = tileLayer === "map" ? "invert(1) hue-rotate(180deg) brightness(0.95)" : "none";
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Switch tile layer ───────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      tileRef.current.remove();
      const newTile = L.tileLayer(TILE_LAYERS[tileLayer].url, {
        attribution: TILE_LAYERS[tileLayer].attribution,
        maxZoom: 19,
      });
      newTile.addTo(mapRef.current);
      tileRef.current = newTile;
      if (containerRef.current) {
        containerRef.current.style.filter = tileLayer === "map" ? "invert(1) hue-rotate(180deg) brightness(0.95)" : "none";
      }
    });
  }, [tileLayer]);

  // ── Update markers when pins change ────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;

      const existingIds = new Set(pins.map((p) => p.device.id));

      // Remove stale markers
      for (const [id, marker] of markersRef.current.entries()) {
        if (!existingIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      }

      // Remove stale paths
      for (const [id, path] of pathsRef.current.entries()) {
        if (!existingIds.has(id)) {
          path.remove();
          pathsRef.current.delete(id);
        }
      }

      for (const pin of pins) {
        const { lat, lng, source, accuracy } = pin.location;
        const isActive = pin.device.is_active;
        const isSelected = selected?.device.id === pin.device.id;

        // Marker color based on platform
        const colorMap: Record<string, string> = {
          windows: "#3b82f6",
          linux:   "#22c55e",
          android: "#84cc16",
          darwin:  "#a3a3a3",
          ios:     "#94a3b8",
        };
        const color = colorMap[pin.device.platform?.toLowerCase() ?? ""] ?? "#ef4444";
        const gpsColor = source === "gps" ? color : "#f59e0b";

        // Custom SVG marker
        const svgMarker = L.divIcon({
          html: `<div style="
            width: ${isSelected ? 18 : 14}px;
            height: ${isSelected ? 18 : 14}px;
            border-radius: 50%;
            background: ${gpsColor};
            border: ${isSelected ? "3px" : "2px"} solid ${isActive ? "white" : "#666"};
            box-shadow: 0 0 ${isActive ? "12px 4px" : "4px 1px"} ${gpsColor}80;
            transition: all 0.3s;
          "></div>`,
          className: "",
          iconSize: [isSelected ? 18 : 14, isSelected ? 18 : 14],
          iconAnchor: [isSelected ? 9 : 7, isSelected ? 9 : 7],
        });

        if (markersRef.current.has(pin.device.id)) {
          const existing = markersRef.current.get(pin.device.id);
          existing.setLatLng([lat, lng]);
          existing.setIcon(svgMarker);
        } else {
          const marker = L.marker([lat, lng], { icon: svgMarker })
            .addTo(map);

          marker.on("click", () => onSelectPin(pin));

          // Accuracy circle (GPS only)
          if (accuracy && accuracy > 10) {
            L.circle([lat, lng], {
              radius: accuracy,
              color: gpsColor,
              fillColor: gpsColor,
              fillOpacity: 0.08,
              weight: 1,
            }).addTo(map);
          }

          markersRef.current.set(pin.device.id, marker);
        }

        // Popup
        const marker = markersRef.current.get(pin.device.id);
        marker?.bindPopup(`
          <div style="font-family: monospace; font-size: 11px; color: #e2e8f0; background: #0a0a14; padding: 8px; border-radius: 6px; min-width: 180px;">
            <div style="font-weight: bold; font-size: 12px; margin-bottom: 4px;">${pin.device.hostname ?? "Unknown"}</div>
            <div style="color: #94a3b8;">${pin.device.platform ?? "?"} · ${pin.device.username ?? "?"}</div>
            <div style="margin-top: 6px; color: #4ade80;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            ${pin.location.address ? `<div style="color: #64748b; margin-top: 2px; font-size: 9px;">${pin.location.address}</div>` : ""}
            <div style="margin-top: 4px; color: #f59e0b; font-size: 9px;">Source: ${source.toUpperCase()}</div>
            <div style="margin-top: 6px; display: flex; gap: 4px;">
              <a href="https://maps.google.com/maps?q=${lat},${lng}" target="_blank"
                style="flex: 1; padding: 3px; background: #1d4ed8; color: white; border-radius: 3px; text-align: center; text-decoration: none; font-size: 9px;">Maps</a>
              <a href="https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}" target="_blank"
                style="flex: 1; padding: 3px; background: #0e7490; color: white; border-radius: 3px; text-align: center; text-decoration: none; font-size: 9px;">StreetView</a>
            </div>
          </div>
        `, { className: "dark-popup" });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, selected]);

  // ── Pan to selected ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !selected) return;
    mapRef.current.flyTo(
      [selected.location.lat, selected.location.lng],
      15,
      { animate: true, duration: 1.2 },
    );
  }, [selected]);

  return (
    <>
      <style>{`
        .dark-popup .leaflet-popup-content-wrapper {
          background: #0a0a14 !important;
          border: 1px solid rgba(255,255,255,0.06) !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.6) !important;
          padding: 0 !important;
        }
        .dark-popup .leaflet-popup-content {
          margin: 0 !important;
        }
        .dark-popup .leaflet-popup-tip {
          background: #0a0a14 !important;
        }
        .dark-popup .leaflet-popup-close-button {
          color: #64748b !important;
          top: 4px !important;
          right: 4px !important;
        }
        .leaflet-control-zoom a {
          background: #0a0a14 !important;
          color: #94a3b8 !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .leaflet-control-attribution {
          background: rgba(0,0,0,0.5) !important;
          color: #475569 !important;
          font-size: 9px !important;
        }
        .leaflet-control-attribution a { color: #64748b !important; }
      `}</style>
      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}
