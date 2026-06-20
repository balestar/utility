import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getMsfConfig } from "@/lib/msf-config";
import * as fs from "fs";
import * as path from "path";

const PAYLOADS_DIR = path.join(process.cwd(), "payloads");

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filename = searchParams.get("file");

  if (!filename) {
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });
  }

  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(PAYLOADS_DIR, safeName);

  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(buffer.length),
      },
    });
  }

  // In demo mode or if file not found, return a fake payload buffer
  const config = getMsfConfig();
  if (config.demoMode) {
    const header = Buffer.alloc(512);
    header[0] = 0x4d;
    header[1] = 0x5a;
    const note = Buffer.from(
      `[Demo Payload — ${safeName} — Not executable]`,
    );
    note.copy(header, 64);
    return new NextResponse(header, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 });
}
