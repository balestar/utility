import { NextResponse } from "next/server";
import { flushOfflineQueue } from "@/lib/supabase";

/**
 * POST /api/sync
 * Flushes the Supabase offline queue — retries any events
 * that were queued while the MSF backend was offline.
 * Called automatically by the dashboard every 60 s.
 */
export async function POST() {
  try {
    const synced = await flushOfflineQueue();
    return NextResponse.json({ ok: true, synced });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const synced = await flushOfflineQueue();
    return NextResponse.json({ ok: true, synced });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
