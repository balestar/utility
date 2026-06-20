import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listWorkspaces, getCurrentWorkspace } from "@/lib/msf-client";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [workspaces, current] = await Promise.all([
      listWorkspaces(),
      getCurrentWorkspace(),
    ]);
    return NextResponse.json({ workspaces, current });
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

  try {
    const token = await getRpcToken();

    if (action === "create") {
      // db.add_workspace or db.workspaces create
      await rpcCall("db.add_workspace", [name], token);
      return NextResponse.json({ ok: true });
    }

    if (action === "switch") {
      await rpcCall("db.set_workspace", [{ wspace: name }], token);
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

  try {
    const token = await getRpcToken();
    await rpcCall("db.del_workspace", [name], token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
