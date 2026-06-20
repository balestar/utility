"use client";

import { useEffect, useState } from "react";

type Workspace = {
  name: string;
  created_at?: number;
};

export function WorkspacePanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">Workspaces</h2>
        <p className="text-sm text-zinc-400">Isolated engagement environments</p>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading workspaces…</p>}

      {!loading && (
        <ul className="space-y-2">
          {workspaces.map((workspace) => (
            <li
              key={workspace.name}
              className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3"
            >
              <span className="font-mono text-sm text-zinc-200">{workspace.name}</span>
              {workspace.created_at && (
                <span className="text-xs text-zinc-600">
                  {new Date(workspace.created_at * 1000).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
