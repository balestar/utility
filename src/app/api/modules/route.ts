import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listModules, getModuleInfo, searchModules } from "@/lib/msf-client";

const validTypes = new Set(["exploit", "payload", "auxiliary", "post", "encoder", "nop"]);

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "exploit";
  const search = searchParams.get("search");
  const infoFor = searchParams.get("info");

  // Module info lookup
  if (infoFor) {
    const info = await getModuleInfo(type, infoFor);
    return NextResponse.json({ info, module: infoFor });
  }

  // Search across all modules
  if (search) {
    try {
      const results = await searchModules(search);
      return NextResponse.json({ modules: results.map((name) => ({ name })), search });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Search failed" },
        { status: 502 },
      );
    }
  }

  if (!validTypes.has(type)) {
    return NextResponse.json({ error: "Invalid module type" }, { status: 400 });
  }

  try {
    const modules = await listModules(type as "exploit" | "payload" | "auxiliary");
    return NextResponse.json({ modules, type, count: modules.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list modules" },
      { status: 502 },
    );
  }
}
