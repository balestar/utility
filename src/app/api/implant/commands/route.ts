import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getCommandsByCategory, getAllCommands } from "@/lib/implant/commands";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const grouped = searchParams.get("grouped") === "true";

  if (grouped) {
    const groups = getCommandsByCategory();
    return NextResponse.json({ commands: groups });
  }

  return NextResponse.json({ commands: getAllCommands() });
}
