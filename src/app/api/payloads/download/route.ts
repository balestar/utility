import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
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

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(safeName).toLowerCase();

  // Detect MIME type
  const mimeMap: Record<string, string> = {
    ".exe": "application/vnd.microsoft.portable-executable",
    ".apk": "application/vnd.android.package-archive",
    ".bin": "application/octet-stream",
    ".elf": "application/x-executable",
    ".ps1": "text/plain",
    ".py":  "text/plain",
    ".sh":  "text/x-shellscript",
    ".php": "text/plain",
    ".rb":  "text/plain",
    ".war": "application/java-archive",
    ".jar": "application/java-archive",
  };

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeMap[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
