import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getConnectionStatus } from "@/lib/msf-client";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getConnectionStatus();
  return NextResponse.json(status);
}
