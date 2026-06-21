import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import {
  createListener,
  listListeners,
  stopListener,
} from "@/lib/backdoor";
import { getMsfConfig } from "@/lib/msf-config";

const DEMO_LISTENERS = [
  { jobId: "0", payload: "windows/x64/meterpreter/reverse_tcp", lhost: "0.0.0.0", lport: 4444, started: new Date().toISOString() },
  { jobId: "1", payload: "android/meterpreter/reverse_tcp",     lhost: "0.0.0.0", lport: 4445, started: new Date().toISOString() },
];

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (getMsfConfig().demoMode) {
    return NextResponse.json({ listeners: DEMO_LISTENERS, demo: true });
  }

  try {
    const listeners = await listListeners();
    return NextResponse.json({ listeners });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list listeners" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.payload || !body.lhost || !body.lport) {
      return NextResponse.json(
        { error: "Missing required fields: payload, lhost, lport" },
        { status: 400 },
      );
    }

    const listener = await createListener(body.payload, body.lhost, body.lport);
    return NextResponse.json({ listener }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start listener" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing listener id" },
        { status: 400 },
      );
    }

    await stopListener(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop listener" },
      { status: 502 },
    );
  }
}
