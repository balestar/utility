import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listWorkspaces } from "@/lib/msf-client";
import { getMsfConfig } from "@/lib/msf-config";
import { demoWorkspaces } from "@/lib/msf-demo";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaces = await listWorkspaces();
    return NextResponse.json({ workspaces, current: workspaces[0]?.name ?? "default" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list workspaces" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, name } = await request.json();
  const config = getMsfConfig();

  if (config.demoMode) {
    if (action === "create") {
      demoWorkspaces.push({ name, created_at: Date.now() / 1000 });
      return NextResponse.json({ ok: true });
    }
    if (action === "switch") return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const { rpcCall, getRpcToken } = await import("@/lib/msf-rpc");
    const token = await getRpcToken();

    if (action === "create") {
      await rpcCall("db.add_workspace", [name], token);
      return NextResponse.json({ ok: true });
    }

    if (action === "switch") {
      await rpcCall("db.set_workspace", [name], token);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name === "default") return NextResponse.json({ error: "Cannot delete default workspace" }, { status: 400 });

  const config = getMsfConfig();

  if (config.demoMode) {
    const idx = demoWorkspaces.findIndex(w => w.name === name);
    if (idx >= 0) demoWorkspaces.splice(idx, 1);
    return NextResponse.json({ ok: true });
  }

  try {
    const { rpcCall, getRpcToken } = await import("@/lib/msf-rpc");
    const token = await getRpcToken();
    await rpcCall("db.del_workspace", [name], token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
