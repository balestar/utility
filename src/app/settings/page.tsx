"use client";

import { useState, useEffect } from "react";
import { usePinLock } from "@/components/pin-lock";
import { useToast } from "@/components/toast";

type HealthData = {
  status: string;
  connected: boolean;
  demo: boolean;
  version?: string;
};

export default function SettingsPage() {
  const { lock, setPin, hasPin } = usePinLock();
  const { toast } = useToast();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [testing, setTesting] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStep, setPinStep] = useState<"idle" | "entry" | "confirm">("idle");

  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
      toast(data.connected ? `Connected — MSF ${data.version}` : "Backend offline", data.connected ? "success" : "error");
    } catch {
      toast("Connection test failed", "error");
    } finally {
      setTesting(false);
    }
  };

  const startPinChange = () => {
    setNewPin("");
    setConfirmPin("");
    setPinStep("entry");
  };

  const savePinChange = async () => {
    if (newPin.length !== 6) { toast("PIN must be 6 digits", "warning"); return; }
    if (newPin !== confirmPin) { toast("PINs do not match", "error"); setConfirmPin(""); return; }
    await setPin(newPin);
    toast("PIN updated", "success");
    setPinStep("idle");
    setNewPin("");
    setConfirmPin("");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="border-b border-white/[0.05] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Configuration</p>
        <h1 className="mt-1 text-xl font-bold text-white">Settings</h1>
      </div>

      {/* ── HOW TO ACCESS ─────────────────────────────── */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Access the App in Your Browser</p>
        <div className="rounded border border-cyan-900/30 bg-cyan-950/10 p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-cyan-400 mb-2">OPTION A — Dev Mode (Instant, no Docker)</p>
            <div className="space-y-1.5 font-mono text-[11px]">
              {[
                ["cd ~/metasploit-app", true],
                ["npm run dev", true],
                ["# Open: http://localhost:3000", false],
              ].map(([cmd, copyable]) => (
                <div key={String(cmd)} onClick={() => { if (copyable) { navigator.clipboard.writeText(String(cmd)); toast("Copied", "success", 1200); }}}
                  className={`block w-full rounded border border-white/[0.04] px-3 py-1 text-left ${copyable ? "cursor-pointer text-green-400 hover:bg-white/[0.03]" : "text-slate-600"}`}
                >{String(cmd)}</div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-cyan-400 mb-2">OPTION B — Full Docker Stack (Recommended)</p>
            <div className="space-y-1.5 font-mono text-[11px]">
              {[
                ["cd ~/metasploit-app", true],
                ["docker compose up -d", true],
                ["# Wait ~2 min for MSF to start", false],
                ["# Open: http://localhost", false],
                ["# Login: admin / changeme", false],
              ].map(([cmd, copyable]) => (
                <div key={String(cmd)} onClick={() => { if (copyable) { navigator.clipboard.writeText(String(cmd)); toast("Copied", "success", 1200); }}}
                  className={`block w-full rounded border border-white/[0.04] px-3 py-1 text-left ${copyable ? "cursor-pointer text-green-400 hover:bg-white/[0.03]" : "text-slate-600"}`}
                >{String(cmd)}</div>
              ))}
            </div>
          </div>
          <p className="text-[9px] text-slate-700">Click any green command to copy it to clipboard</p>
        </div>
      </section>

      {/* Connection status */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Backend Connection</p>
        <div className="rounded border border-white/[0.06] bg-[#09090f] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${
                health?.connected ? "bg-green-500 status-pulse" :
                health?.demo      ? "bg-amber-500 status-pulse" :
                health            ? "bg-red-500" : "bg-slate-600"
              }`} />
              <div>
                <p className="text-[12px] font-semibold text-slate-200">
                  {health?.connected ? "Connected" : health?.demo ? "Demo Mode" : health ? "Offline" : "Unknown"}
                </p>
                {health?.version && (
                  <p className="text-[10px] text-slate-500">Metasploit {health.version}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={testConnection}
              disabled={testing}
              className="flex items-center gap-2 rounded border border-white/[0.08] px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 transition hover:border-white/[0.14] hover:text-slate-200 disabled:opacity-40"
            >
              {testing && <span className="h-3 w-3 animate-spin rounded-full border border-slate-500 border-t-slate-200" />}
              Test Connection
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {[
              ["Protocol", "MessagePack TCP"],
              ["Default Host", "127.0.0.1 (Docker: metasploit)"],
              ["Default Port", "55553"],
              ["Auth", "Token-based (5 min cache)"],
              ["Demo Mode", health?.demo ? "Active" : "Disabled"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                <span className="text-[10px] text-slate-500">{k}</span>
                <span className="font-mono text-[10px] text-slate-300">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Security</p>
        <div className="rounded border border-white/[0.06] bg-[#09090f] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-slate-200">PIN Lock</p>
              <p className="text-[10px] text-slate-500">{hasPin ? "6-digit PIN configured" : "No PIN set"} · Auto-locks after 5 min</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={lock}
                className="rounded border border-white/[0.08] px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 transition hover:text-slate-200"
              >
                Lock Now
              </button>
              <button
                type="button"
                onClick={startPinChange}
                className="rounded border border-red-800/50 bg-red-950/20 px-3 py-1.5 text-[10px] uppercase tracking-wider text-red-400 transition hover:bg-red-950/40"
              >
                {hasPin ? "Change PIN" : "Set PIN"}
              </button>
            </div>
          </div>

          {pinStep !== "idle" && (
            <div className="rounded border border-white/[0.06] bg-black/40 p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {pinStep === "entry" ? "Enter new 6-digit PIN" : "Confirm new PIN"}
              </p>
              <div className="flex gap-2">
                {pinStep === "entry" ? (
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    className="flex-1 rounded border border-white/[0.06] bg-black/60 px-3 py-2 font-mono text-[13px] text-slate-200 tracking-[0.4em] focus:border-red-800/50 focus:outline-none"
                  />
                ) : (
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={e => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    className="flex-1 rounded border border-white/[0.06] bg-black/60 px-3 py-2 font-mono text-[13px] text-slate-200 tracking-[0.4em] focus:border-red-800/50 focus:outline-none"
                  />
                )}
                {pinStep === "entry" ? (
                  <button
                    type="button"
                    disabled={newPin.length !== 6}
                    onClick={() => setPinStep("confirm")}
                    className="rounded border border-white/[0.08] px-4 py-2 text-[10px] uppercase tracking-wider text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
                  >
                    Next
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={confirmPin.length !== 6}
                      onClick={savePinChange}
                      className="rounded border border-green-800/50 bg-green-950/20 px-4 py-2 text-[10px] uppercase tracking-wider text-green-400 transition hover:bg-green-950/40 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinStep("idle")}
                      className="rounded border border-white/[0.06] px-3 py-2 text-[10px] text-slate-600 transition hover:text-slate-400"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Deploy commands */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Docker Stack</p>
        <div className="rounded border border-white/[0.06] bg-[#05050c] p-5 font-mono text-[11px]">
          {[
            ["docker compose up -d",           "# start all services"],
            ["docker compose ps",              "# check status"],
            ["docker compose logs -f",         "# live logs"],
            ["docker compose down",            "# stop all"],
            ["docker compose build dashboard", "# rebuild app"],
          ].map(([cmd, comment]) => (
            <div key={cmd} className="flex gap-4 py-0.5">
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(cmd); toast("Copied", "success", 1500); }}
                className="group flex-1 text-left"
              >
                <span className="text-green-500 group-hover:text-green-400">{cmd}</span>
              </button>
              <span className="text-slate-700">{comment}</span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-700">Click any command to copy to clipboard</p>
      </section>

      {/* Recovery */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Factory Reset Recovery</p>
        <div className="rounded border border-white/[0.06] bg-[#05050c] p-5">
          <p className="mb-3 text-[10px] text-slate-500">Run this on a fresh machine to restore the entire stack:</p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText("curl -fsSL https://raw.githubusercontent.com/balestar/utility/main/scripts/factory-recovery.sh | sh");
              toast("Copied recovery command", "success");
            }}
            className="w-full rounded border border-white/[0.06] bg-white/[0.02] p-3 text-left font-mono text-[10px] text-green-500 transition hover:bg-white/[0.04]"
          >
            curl -fsSL https://raw.githubusercontent.com/balestar/utility/main/scripts/factory-recovery.sh | sh
          </button>
          <p className="mt-2 text-[9px] text-slate-700">Click to copy · Installs Homebrew, Docker, clones repo, starts stack, configures auto-start</p>
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section className="space-y-3">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Keyboard Shortcuts</p>
        <div className="rounded border border-white/[0.06] bg-[#09090f] p-5">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["⌘K / Ctrl+K", "Open command palette"],
              ["G D", "Go to Dashboard"],
              ["G A", "Go to Agent Control"],
              ["G S", "Go to Sessions"],
              ["G L", "Go to Listeners"],
              ["G P", "Go to Payloads"],
              ["G M", "Go to Modules"],
              ["G C", "Go to CryptoLocker"],
              ["Esc", "Close palette / cancel"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center justify-between rounded border border-white/[0.04] px-3 py-1.5">
                <span className="text-[10px] text-slate-500">{desc}</span>
                <kbd className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
