/**
 * GET /api/embed/download?file=FILENAME
 * Streams a generated payload file to the browser as a download.
 * DELETE /api/embed/download?file=FILENAME  — deletes the file.
 *
 * Security: filename is validated to stay within OUT_DIR (no path traversal).
 */

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";

const OUT_DIR = process.env.PAYLOADS_DIR
  ? path.join(process.env.PAYLOADS_DIR, "embedded")
  : path.join(os.homedir(), "msf-payloads", "embedded");

// Infer MIME type from extension
function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const MAP: Record<string, string> = {
    ".exe":   "application/octet-stream",
    ".pdf":   "application/pdf",
    ".docm":  "application/vnd.ms-word.document.macroEnabled.12",
    ".xlsm":  "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".apk":   "application/vnd.android.package-archive",
    ".mp4":   "video/mp4",
    ".lnk":   "application/octet-stream",
    ".hta":   "application/hta",
    ".zip":   "application/zip",
    ".ps1":   "text/plain",
    ".sh":    "text/plain",
    ".py":    "text/plain",
    ".vba":   "text/plain",
    ".bas":   "text/plain",
    ".txt":   "text/plain",
    ".bin":   "application/octet-stream",
  };
  return MAP[ext] ?? "application/octet-stream";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";

  if (!file) {
    return NextResponse.json({ error: "file parameter required" }, { status: 400 });
  }

  // Path-traversal protection: resolve and verify it's within OUT_DIR
  const resolved = path.resolve(OUT_DIR, path.basename(file));
  if (!resolved.startsWith(OUT_DIR)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buf = fs.readFileSync(resolved);
  const mime = mimeFor(file);
  const safeFilename = encodeURIComponent(path.basename(file));

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-cache",
    },
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";

  if (!file) {
    return NextResponse.json({ error: "file parameter required" }, { status: 400 });
  }

  const resolved = path.resolve(OUT_DIR, path.basename(file));
  if (!resolved.startsWith(OUT_DIR)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  fs.unlinkSync(resolved);
  return NextResponse.json({ ok: true, deleted: path.basename(file) });
}
