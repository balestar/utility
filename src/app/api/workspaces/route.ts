import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listWorkspaces } from "@/lib/msf-client";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaces = await listWorkspaces();
    return NextResponse.json({ workspaces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list workspaces" },
      { status: 502 },
    );
  }
}
