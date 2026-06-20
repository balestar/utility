import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listSessions } from "@/lib/msf-client";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list sessions" },
      { status: 502 },
    );
  }
}
