import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listModules } from "@/lib/msf-client";

const validTypes = new Set(["exploit", "payload", "auxiliary"]);

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "exploit";

  if (!validTypes.has(type)) {
    return NextResponse.json({ error: "Invalid module type" }, { status: 400 });
  }

  try {
    const modules = await listModules(type as "exploit" | "payload" | "auxiliary");
    return NextResponse.json({ modules, type });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list modules" },
      { status: 502 },
    );
  }
}
