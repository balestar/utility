import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/msf-client";

/**
 * Health check endpoint — intentionally NOT behind auth
 * so Docker compose healthchecks (which only use wget) work.
 */
export async function GET() {
  const status = await getConnectionStatus();
  return NextResponse.json({
    status: status.connected ? "ok" : "degraded",
    ...status,
  });
}
