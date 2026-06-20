"use client";

import { useEffect, useState, useCallback } from "react";

type Listener = {
  id: string;
  payload: string;
  lhost: string;
  lport: number;
  status: "running" | "stopped";
  sessionCount: number;
  createdAt: string;
};

export function ListenerPanel() {
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formPayload, setFormPayload] = useState(
    "windows/x64/meterpreter/reverse_tcp",
  );
  const [formLhost, setFormLhost] = useState("");
  const [formLport, setFormLport] = useState(4444);
  const [starting, setStarting] = useState(false);

  const fetchListeners = useCallback(async () => {
    try {
      const res = await fetch("/api/listeners");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setListeners(data.listeners ?? []);
        setError(null);
      }
    } catch {
      setError("Failed to load listeners");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListeners();
  }, [fetchListeners]);

  const handleStart = async () => {
    if (!formLhost) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/listeners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: formPayload,
          lhost: formLhost,
          lport: formLport,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setFormLport((prev) => prev + 1);
        await fetchListeners();
      }
    } catch {
      setError("Failed to start listener");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await fetch(`/api/listeners?id=${id}`, { method: "DELETE" });
      await fetchListeners();
    } catch {
      setError("Failed to stop listener");
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">Listener Manager</h2>
        <p className="text-sm text-zinc-400">
          Start multi/handler listeners for incoming reverse shells
        </p>
      </div>

      {/* Start new listener */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
            Payload
          </label>
          <input
            type="text"
            value={formPayload}
            onChange={(e) => setFormPayload(e.target.value)}
            placeholder="windows/x64/meterpreter/reverse_tcp"
            className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
            LHOST
          </label>
          <input
            type="text"
            value={formLhost}
            onChange={(e) => setFormLhost(e.target.value)}
            placeholder="0.0.0.0"
            className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
            LPORT
          </label>
          <input
            type="number"
            value={formLport}
            onChange={(e) => setFormLport(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleStart}
        disabled={starting || !formLhost}
        className="mb-6 w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {starting ? "Starting..." : "Start Listener"}
      </button>

      {error && (
        <div className="mb-4 rounded-xl border border-red-900/50 bg-red-900/20 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <p className="text-sm text-zinc-500">Loading listeners...</p>
      )}

      {!loading && listeners.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
          No active listeners
        </p>
      )}

      {!loading && listeners.length > 0 && (
        <div className="space-y-2">
          {listeners.map((listener) => (
            <div
              key={listener.id}
              className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      listener.status === "running"
                        ? "bg-emerald-500"
                        : "bg-zinc-600"
                    }`}
                  />
                  <code className="truncate text-sm text-zinc-200">
                    {listener.payload}
                  </code>
                </div>
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {listener.lhost}:{listener.lport} · {listener.sessionCount}{" "}
                  session{listener.sessionCount !== 1 ? "s" : ""}
                </p>
              </div>
              {listener.status === "running" && (
                <button
                  type="button"
                  onClick={() => handleStop(listener.id)}
                  className="ml-3 shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-red-900 hover:text-red-300"
                >
                  Stop
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
