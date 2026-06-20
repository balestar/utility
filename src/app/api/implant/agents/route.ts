import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listAgentSessions } from "@/lib/implant/commands";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agents = await listAgentSessions();
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list agents" },
      { status: 502 },
    );
  }
}
