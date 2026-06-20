"use client";

import { useEffect, useState } from "react";

type Session = {
  id: number;
  type: string;
  tunnel: string;
  via: string;
  info: string;
  workspace: string;
};

export function SessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setSessions(data.sessions ?? []);
      })
      .catch(() => setError("Failed to load sessions"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">Active Sessions</h2>
        <p className="text-sm text-zinc-400">Meterpreter and shell sessions from the RPC server</p>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading sessions…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && sessions.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
          No active sessions
        </p>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-3 pr-4">ID</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4">Target</th>
                <th className="pb-3 pr-4">Via</th>
                <th className="pb-3">Workspace</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-t border-zinc-900">
                  <td className="py-3 pr-4 font-mono text-red-300">{session.id}</td>
                  <td className="py-3 pr-4 text-zinc-300">{session.type}</td>
                  <td className="py-3 pr-4 text-zinc-400">{session.info}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-zinc-500">{session.via}</td>
                  <td className="py-3 text-zinc-400">{session.workspace}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
