import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import {
  generatePayload,
  listGeneratedPayloads,
  deletePayload,
  PayloadOptions,
} from "@/lib/backdoor";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payloads = listGeneratedPayloads();
    return NextResponse.json({ payloads, count: payloads.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list payloads" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PayloadOptions;

    if (!body.payload || !body.lhost || !body.lport) {
      return NextResponse.json(
        { error: "Missing required fields: payload, lhost, lport" },
        { status: 400 },
      );
    }

    const result = await generatePayload(body);
    return NextResponse.json({ payload: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const ok = deletePayload(file);
  return NextResponse.json({ ok, deleted: file });
}
