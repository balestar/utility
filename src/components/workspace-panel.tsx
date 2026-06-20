"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "./toast";

type Workspace = {
  name: string;
  created_at?: number;
  hosts?: number;
  services?: number;
  vulns?: number;
};

export function WorkspacePanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [current, setCurrent] = useState("default");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
      if (data.current) setCurrent(data.current);
    } catch {
      toast("Failed to load workspaces", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const name = newName.trim().replace(/\s+/g, "_");
    if (!name) { toast("Workspace name required", "warning"); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { toast("Name: letters, numbers, _ - only", "warning"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else { toast(`Workspace "${name}" created`, "success"); setNewName(""); setShowCreate(false); await load(); }
    } catch {
      toast("Failed to create workspace", "error");
    } finally {
      setCreating(false);
    }
  };

  const switchTo = async (name: string) => {
    if (name === current) return;
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", name }),
      });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else { toast(`Switched to "${name}"`, "success"); setCurrent(name); }
    } catch {
      toast("Failed to switch workspace", "error");
    }
  };

  const remove = async (name: string) => {
    if (name === "default") { toast("Cannot delete the default workspace", "warning"); return; }
    if (name === current) { toast("Switch to another workspace first", "warning"); return; }
    try {
      const res = await fetch(`/api/workspaces?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else { toast(`Workspace "${name}" deleted`, "info"); await load(); }
    } catch {
      toast("Failed to delete workspace", "error");
    }
  };

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Workspaces</span>
          <span className="rounded border border-white/[0.06] px-1.5 py-px text-[9px] font-semibold text-slate-400">
            {workspaces.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(s => !s)}
          className="flex items-center gap-1.5 rounded border border-white/[0.06] px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 transition hover:border-white/[0.12] hover:text-slate-300"
        >
          <span className="text-[14px] leading-none">+</span>
          New Workspace
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded border border-white/[0.06] bg-[#09090f] p-4">
          <p className="mb-3 text-[9px] font-semibold uppercase tracking-widest text-slate-500">Create Workspace</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") setShowCreate(false); }}
              placeholder="e.g. client-audit-2024"
              autoFocus
              className="flex-1 rounded border border-white/[0.06] bg-black/50 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder-slate-700 focus:border-red-800/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={create}
              disabled={creating || !newName.trim()}
              className="rounded border border-green-800/50 bg-green-950/20 px-4 py-2 text-[10px] uppercase tracking-wider text-green-400 transition hover:bg-green-950/40 disabled:opacity-40"
            >
              {creating ? "..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border border-white/[0.06] px-3 py-2 text-[10px] text-slate-600 transition hover:text-slate-400"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[9px] text-slate-700">Only letters, numbers, underscores, dashes allowed</p>
        </div>
      )}

      {/* Workspace list */}
      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <span className="h-4 w-4 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="rounded border border-dashed border-white/[0.05] py-12 text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-700">No workspaces found</p>
          <p className="mt-1 text-[9px] text-slate-800">Connect to Metasploit to load workspaces</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workspaces.map(ws => {
            const isActive = ws.name === current;
            return (
              <div
                key={ws.name}
                className={`flex items-center gap-4 rounded border px-4 py-3.5 transition-all ${
                  isActive
                    ? "border-green-900/30 bg-green-950/10"
                    : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.08]"
                }`}
              >
                {/* Active indicator */}
                <span className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "bg-green-500 status-pulse" : "bg-slate-700"}`} />

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[12px] font-semibold ${isActive ? "text-green-400" : "text-slate-300"}`}>
                      {ws.name}
                    </span>
                    {isActive && (
                      <span className="rounded border border-green-800/50 px-1.5 py-px text-[8px] font-semibold uppercase text-green-500">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    {ws.created_at
                      ? `Created ${new Date(ws.created_at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                      : "No timestamp"}
                    {ws.hosts !== undefined && ` · ${ws.hosts} hosts · ${ws.services ?? 0} services · ${ws.vulns ?? 0} vulns`}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 gap-2">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => switchTo(ws.name)}
                      className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-500 transition hover:border-green-800/50 hover:text-green-400"
                    >
                      Switch
                    </button>
                  )}
                  {ws.name !== "default" && !isActive && (
                    <button
                      type="button"
                      onClick={() => remove(ws.name)}
                      className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-700 transition hover:border-red-900/50 hover:text-red-500"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div className="rounded border border-white/[0.04] bg-white/[0.01] p-4">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">About Workspaces</p>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-700">
          Workspaces isolate hosts, services, vulnerabilities, and notes by engagement. Switch workspaces to separate client data. The "default" workspace cannot be deleted.
        </p>
      </div>
    </div>
  );
}
