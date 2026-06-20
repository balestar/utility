"use client";

import { usePinLock } from "@/components/pin-lock";

export default function SettingsPage() {
  const { lock } = usePinLock();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Application configuration and security</p>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
          <h2 className="text-lg font-semibold text-white">Security</h2>
          <p className="mb-4 text-sm text-zinc-400">Lock the app or manage your PIN</p>
          <button
            type="button"
            onClick={lock}
            className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            Lock App Now
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
          <h2 className="text-lg font-semibold text-white">Connection</h2>
          <div className="mt-4 space-y-3 text-sm text-zinc-400">
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <span>MSF RPC Host</span>
              <code className="text-zinc-300">{process.env.NEXT_PUBLIC_MSF_HOST || "127.0.0.1"}</code>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <span>MSF RPC Port</span>
              <code className="text-zinc-300">{process.env.NEXT_PUBLIC_MSF_PORT || "55553"}</code>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
              <span>Mode</span>
              <code className="text-zinc-300">
                {(typeof window !== "undefined" && localStorage.getItem("msf_demo") === "true") ? "Demo" : "Live"}
              </code>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
          <h2 className="text-lg font-semibold text-white">Quick Commands</h2>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-black p-4 text-xs text-emerald-500/70">
{`docker compose up -d
docker compose ps
docker compose logs -f`}
          </pre>
        </section>
      </div>
    </div>
  );
}
