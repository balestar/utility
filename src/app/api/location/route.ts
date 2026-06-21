/**
 * Location capture API
 *
 * GET  /api/location              → all latest locations (one per device)
 * GET  /api/location?device=ID    → location history for one device
 * POST /api/location              → capture location for one session
 * POST /api/location { action: "track_all" } → capture all active sessions
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import {
  captureLocation,
  captureAllSessionLocations,
  getDeviceLocations,
  getLatestLocations,
} from "@/lib/geolocation";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("device");
  const limit = parseInt(searchParams.get("limit") ?? "100");

  try {
    if (deviceId) {
      const locations = await getDeviceLocations(deviceId, Math.min(limit, 500));
      return NextResponse.json({ locations, device_id: deviceId });
    }

    const locations = await getLatestLocations();
    return NextResponse.json({ locations, count: locations.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  // Batch: capture all active sessions
  if (body.action === "track_all") {
    try {
      const results = await captureAllSessionLocations();
      const captured = results.filter((r) => r.fix !== null).length;
      return NextResponse.json({
        ok: true,
        total: results.length,
        captured,
        results: results.map((r) => ({
          sessionId: r.sessionId,
          deviceId: r.deviceId,
          captured: r.fix !== null,
          lat: r.fix?.lat,
          lng: r.fix?.lng,
          source: r.fix?.source,
          address: r.fix?.address,
        })),
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Single session capture
  const { sessionId, deviceId, tunnelIp, sessionType } = body;
  if (!sessionId || !deviceId) {
    return NextResponse.json({ error: "sessionId and deviceId required" }, { status: 400 });
  }

  try {
    const fix = await captureLocation(
      Number(sessionId),
      String(deviceId),
      tunnelIp ? String(tunnelIp) : undefined,
      sessionType ? String(sessionType) : undefined,
    );

    if (!fix) {
      return NextResponse.json({
        ok: false,
        message: "Could not determine location — geolocate and IP geolocation both failed",
      });
    }

    return NextResponse.json({ ok: true, location: fix });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
