import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listSessions } from "@/lib/msf-client";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { getMsfConfig } from "@/lib/msf-config";
import { demoSessions } from "@/lib/msf-demo";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (getMsfConfig().demoMode) {
    return NextResponse.json({ sessions: demoSessions, count: demoSessions.length, demo: true });
  }

  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list sessions" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const token = await getRpcToken();
    await rpcCall("session.stop", [Number(id)], token);
    return NextResponse.json({ ok: true, killed: id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to kill session" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, sessionId, command } = await request.json();

  try {
    const token = await getRpcToken();

    // Ring a command through a session
    if (action === "exec") {
      if (!sessionId || !command) {
        return NextResponse.json({ error: "sessionId and command required" }, { status: 400 });
      }
      try {
        await rpcCall("session.meterpreter_write", [Number(sessionId), command + "\n"], token);
        await new Promise((r) => setTimeout(r, 1500));
        const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [Number(sessionId)], token);
        return NextResponse.json({ output: res.data ?? "", sessionId, command });
      } catch {
        await rpcCall("session.shell_write", [Number(sessionId), command + "\n"], token);
        await new Promise((r) => setTimeout(r, 1500));
        const res = await rpcCall<{ data?: string }>("session.shell_read", [Number(sessionId)], token);
        return NextResponse.json({ output: res.data ?? "", sessionId, command });
      }
    }

    // Upgrade shell → meterpreter
    if (action === "upgrade") {
      if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
      await rpcCall("session.meterpreter_write", [Number(sessionId), "run post/multi/manage/shell_to_meterpreter\n"], token);
      return NextResponse.json({ ok: true, sessionId });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Session action failed" },
      { status: 502 },
    );
  }
}
