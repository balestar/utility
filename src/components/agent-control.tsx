"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useToast } from "./toast";

type AgentSession = {
  id: number;
  type: string;
  tunnel: string;
  via: string;
  info: string;
  workspace: string;
  lastSeen: string;
  platform?: string;
  arch?: string;
};

type C2Command = {
  id: string;
  name: string;
  category: string;
  description: string;
  needsParam?: boolean;
  paramLabel?: string;
  paramPlaceholder?: string;
};

type C2Result = {
  success: boolean;
  output: string;
  error?: string;
};

type HistoryEntry = {
  cmd: string;
  result: C2Result;
  ts: string;
  sessionId: number;
};

const CAT_COLOR: Record<string, string> = {
  System:       "border-slate-700/60 text-slate-400",
  Filesystem:   "border-blue-800/50 text-blue-400",
  Process:      "border-purple-800/50 text-purple-400",
  Network:      "border-cyan-800/50 text-cyan-400",
  Credentials:  "border-red-800/60 text-red-400",
  Surveillance: "border-amber-800/50 text-amber-400",
  Persistence:  "border-orange-800/50 text-orange-400",
  PrivEsc:      "border-pink-800/50 text-pink-400",
  Shell:        "border-green-800/50 text-green-400",
  Exfil:        "border-red-800/60 text-red-400",
};

const DANGER_CATS = new Set(["Credentials", "PrivEsc", "Exfil", "Surveillance"]);

export function AgentControl() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [commands, setCommands] = useState<C2Command[]>([]);
  const [grouped, setGrouped] = useState<Record<string, C2Command[]>>({});
  const [selected, setSelected] = useState<AgentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [activeCmd, setActiveCmd] = useState<C2Command | null>(null);
  const [paramValue, setParamValue] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [output, setOutput] = useState<string>("");
  const [outputOk, setOutputOk] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"commands" | "console" | "history" | "info">("commands");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const termRef = useRef<HTMLDivElement>(null);
  const paramRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?action=sessions");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [cmdRes, sessRes] = await Promise.all([
          fetch("/api/agents?action=commands"),
          fetch("/api/agents?action=sessions"),
        ]);
        const [cmdData, sessData] = await Promise.all([cmdRes.json(), sessRes.json()]);
        if (cmdData.commands) setCommands(cmdData.commands);
        if (cmdData.grouped) setGrouped(cmdData.grouped);
        if (sessData.sessions) setSessions(sessData.sessions);
      } catch { /* silent */ }
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchSessions, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchSessions]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [output, history]);

  // When a command that needs params is selected, focus the input
  useEffect(() => {
    if (activeCmd?.needsParam && paramRef.current) {
      paramRef.current.focus();
    }
  }, [activeCmd]);

  const runCommand = async (cmd: C2Command, param?: string) => {
    if (!selected) return;
    setExecuting(true);
    setOutput("");

    const label = param ? `${cmd.name} ${param}` : cmd.name;

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          sessionId: selected.id,
          commandId: cmd.id,
          param,
        }),
      });
      const data: C2Result = await res.json();
      setOutput(data.error ? data.error : data.output);
      setOutputOk(data.success);
      setHistory(h => [{ cmd: label, result: data, ts: new Date().toISOString(), sessionId: selected.id }, ...h].slice(0, 50));
      toast(data.success ? `${cmd.name} — OK` : `${cmd.name} failed`, data.success ? "success" : "error", 2500);
    } catch {
      setOutput("Network error — could not reach server");
      setOutputOk(false);
      toast("Network error", "error");
    } finally {
      setExecuting(false);
      setParamValue("");
      setActiveCmd(null);
      setView("console");
    }
  };

  const runCustom = async () => {
    if (!selected || !customCmd.trim()) return;
    setExecuting(true);
    const cmd = customCmd.trim();
    setCustomCmd("");
    setOutput("");

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "custom", sessionId: selected.id, command: cmd }),
      });
      const data: C2Result = await res.json();
      setOutput(data.error ? data.error : data.output);
      setOutputOk(data.success);
      setHistory(h => [{ cmd, result: data, ts: new Date().toISOString(), sessionId: selected.id! }, ...h].slice(0, 50));
      toast(data.success ? "Command executed" : "Command failed", data.success ? "success" : "error", 2000);
    } catch {
      setOutput("Network error");
      setOutputOk(false);
      toast("Network error", "error");
    } finally {
      setExecuting(false);
    }
  };

  const onCmdClick = (cmd: C2Command) => {
    if (!selected) return;
    if (cmd.needsParam) {
      setActiveCmd(cmd);
      setParamValue("");
      setView("commands");
    } else {
      runCommand(cmd);
    }
  };

  const cats = Object.keys(grouped);
  const filteredCmds = (category === "All" ? commands : grouped[category] || []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border border-slate-700 border-t-red-500" />
          INITIALIZING...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-48px)] gap-0 overflow-hidden rounded-xl border border-white/[0.06] bg-[#08080e]">

      {/* ── PANEL 1: Session List ── */}
      <div className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.05]">
        <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            Agents <span className="ml-1 tabular-nums text-red-500">{sessions.length}</span>
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-600">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="h-2.5 w-2.5 accent-red-500" />
            Auto
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && (
            <div className="mt-4 rounded border border-dashed border-white/[0.06] p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-600">No agents</p>
              <p className="mt-1 text-[9px] text-slate-700">Start a listener to catch sessions</p>
            </div>
          )}
          {sessions.map(sess => {
            const isSelected = selected?.id === sess.id;
            const online = Date.now() - new Date(sess.lastSeen).getTime() < 120000;
            return (
              <button
                key={sess.id}
                type="button"
                onClick={() => { setSelected(sess); setOutput(""); setActiveCmd(null); }}
                className={`mb-1 w-full rounded border p-3 text-left transition-all ${
                  isSelected
                    ? "border-red-800/60 bg-red-950/20"
                    : "border-transparent hover:border-white/[0.06] hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-green-500 status-pulse" : "bg-slate-600"}`} />
                    <span className="font-mono text-[11px] font-semibold text-red-400">#{sess.id}</span>
                  </div>
                  <span className="rounded border border-white/[0.06] px-1 py-px text-[8px] uppercase tracking-wider text-slate-500">
                    {sess.type}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[11px] text-slate-300">{sess.info}</p>
                <p className="mt-0.5 truncate text-[9px] text-slate-600">{sess.platform || "unknown"}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── PANEL 2: Commands ── */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-white/[0.05]">
        <div className="border-b border-white/[0.05] px-3 py-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search commands..."
            className="w-full rounded border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 focus:border-red-800/50 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategory("All")}
              className={`rounded px-2 py-0.5 text-[9px] uppercase tracking-wider transition ${
                category === "All" ? "bg-red-600 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              ALL
            </button>
            {cats.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`rounded px-2 py-0.5 text-[9px] uppercase tracking-wider transition ${
                  category === cat ? "bg-red-600 text-white" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!selected ? (
            <p className="mt-8 text-center text-[10px] uppercase tracking-wider text-slate-700">
              Select an agent first
            </p>
          ) : (
            filteredCmds.map(cmd => {
              const isActive = activeCmd?.id === cmd.id;
              const isDanger = DANGER_CATS.has(cmd.category);
              const catColor = CAT_COLOR[cmd.category] || "border-slate-700/60 text-slate-400";

              return (
                <div key={cmd.id} className="mb-1.5">
                  <button
                    type="button"
                    disabled={executing}
                    onClick={() => onCmdClick(cmd)}
                    className={`w-full rounded border p-3 text-left transition-all disabled:opacity-40 ${
                      isActive
                        ? "border-red-700/60 bg-red-950/20"
                        : isDanger
                          ? "border-red-900/30 bg-red-950/10 hover:border-red-800/50 hover:bg-red-950/20"
                          : "border-white/[0.04] hover:border-white/[0.10] hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <code className={`font-mono text-[11px] font-semibold leading-none ${isDanger ? "text-red-400" : "text-slate-200"}`}>
                        {cmd.name}
                      </code>
                      <span className={`shrink-0 rounded border px-1 py-px text-[8px] uppercase ${catColor}`}>
                        {cmd.category}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-slate-500">{cmd.description}</p>
                    {cmd.needsParam && (
                      <span className="mt-1 inline-block text-[9px] uppercase tracking-wider text-amber-600">
                        requires input ›
                      </span>
                    )}
                  </button>

                  {/* Inline param input — expands when command is active */}
                  {isActive && cmd.needsParam && (
                    <div className="mt-1 rounded border border-red-800/40 bg-red-950/10 p-3">
                      <label className="mb-1 block text-[9px] uppercase tracking-wider text-red-400">
                        {cmd.paramLabel || "Parameter"}
                      </label>
                      <div className="flex gap-2">
                        <input
                          ref={paramRef}
                          type="text"
                          value={paramValue}
                          onChange={e => setParamValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") runCommand(cmd, paramValue); if (e.key === "Escape") setActiveCmd(null); }}
                          placeholder={cmd.paramPlaceholder || "Enter value..."}
                          className="flex-1 rounded border border-red-800/40 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-red-700/50"
                        />
                        <button
                          type="button"
                          disabled={executing}
                          onClick={() => runCommand(cmd, paramValue)}
                          className="rounded border border-red-700/60 bg-red-700/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-700/30 disabled:opacity-40"
                        >
                          RUN
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveCmd(null)}
                          className="rounded border border-white/[0.06] px-2 text-[10px] text-slate-600 transition hover:text-slate-400"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {selected && filteredCmds.length === 0 && (
            <p className="mt-8 text-center text-[10px] uppercase tracking-wider text-slate-700">No commands found</p>
          )}
        </div>
      </div>

      {/* ── PANEL 3: Terminal / Output ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-white/[0.05] px-4 py-2">
          {(["console", "history", "info"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              className={`rounded px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                view === tab
                  ? "bg-white/[0.07] text-slate-200"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              {tab}
              {tab === "history" && history.length > 0 && (
                <span className="ml-1.5 rounded bg-slate-800 px-1 py-px text-[8px] text-slate-400">
                  {history.length}
                </span>
              )}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-3">
            {selected && (
              <span className="rounded border border-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-slate-500">
                session:{selected.id} · {selected.platform || "?"} · {selected.type}
              </span>
            )}
            {executing && (
              <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-amber-400">
                <span className="h-1.5 w-1.5 animate-spin rounded-full border border-amber-400 border-t-transparent" />
                Executing
              </span>
            )}
          </div>
        </div>

        {/* Console View */}
        {view === "console" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Output terminal */}
            <div
              ref={termRef}
              className="flex-1 overflow-auto bg-[#04040a] p-5 font-mono text-[12px] leading-relaxed"
            >
              {!selected && (
                <p className="text-slate-600">
                  <span className="text-red-500">›</span> Select an agent from the session list to begin{" "}
                  <span className="cursor-blink" />
                </p>
              )}
              {selected && !output && !executing && (
                <p className="text-slate-600">
                  <span className="text-green-500">›</span> Session {selected.id} ready. Select a command or type below{" "}
                  <span className="cursor-blink" />
                </p>
              )}
              {executing && (
                <p className="text-amber-400">
                  <span className="text-amber-500">›</span> Executing command... please wait
                </p>
              )}
              {output && !executing && (
                <div>
                  <p className={`mb-3 text-[10px] uppercase tracking-wider ${outputOk ? "text-green-600" : "text-red-600"}`}>
                    {outputOk ? "— success —" : "— error —"}
                  </p>
                  <pre className={`whitespace-pre-wrap break-words ${outputOk ? "text-green-400" : "text-red-400"}`}>
                    {output}
                  </pre>
                </div>
              )}
            </div>

            {/* Custom command input */}
            <div className="shrink-0 border-t border-white/[0.05] p-3">
              <div className="flex items-center gap-2 rounded border border-white/[0.06] bg-black/40 px-3 py-2">
                <span className="font-mono text-[11px] text-green-600">mtr &gt;</span>
                <input
                  type="text"
                  value={customCmd}
                  onChange={e => setCustomCmd(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") runCustom(); }}
                  disabled={!selected || executing}
                  placeholder={selected ? "Type any meterpreter command..." : "Select a session first..."}
                  className="flex-1 bg-transparent font-mono text-[12px] text-slate-200 placeholder-slate-700 focus:outline-none disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={runCustom}
                  disabled={!selected || executing || !customCmd.trim()}
                  className="rounded border border-red-800/50 bg-red-700/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-400 transition hover:bg-red-700/30 disabled:opacity-30"
                >
                  {executing ? "..." : "EXEC"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History View */}
        {view === "history" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-slate-600">Command History</span>
              <button
                type="button"
                onClick={() => setHistory([])}
                className="text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-red-400"
              >
                Clear All
              </button>
            </div>
            {history.length === 0 && (
              <p className="mt-8 text-center text-[10px] uppercase tracking-wider text-slate-700">No history yet</p>
            )}
            {history.map((entry, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setOutput(entry.result.error || entry.result.output); setOutputOk(entry.result.success); setView("console"); }}
                className="mb-2 w-full rounded border border-white/[0.05] bg-white/[0.02] p-3 text-left transition hover:border-white/[0.10]"
              >
                <div className="flex items-center justify-between">
                  <code className="font-mono text-[11px] text-red-400">{entry.cmd}</code>
                  <span className="text-[9px] text-slate-600">{new Date(entry.ts).toLocaleTimeString()}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[9px] uppercase ${entry.result.success ? "text-green-600" : "text-red-600"}`}>
                    {entry.result.success ? "OK" : "FAIL"}
                  </span>
                  <span className="text-[9px] text-slate-600 truncate">
                    {(entry.result.output || entry.result.error || "").slice(0, 60)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Info View */}
        {view === "info" && (
          <div className="flex-1 overflow-y-auto p-6">
            {!selected ? (
              <p className="text-center text-[10px] uppercase tracking-wider text-slate-700">Select a session</p>
            ) : (
              <div className="space-y-3">
                <h2 className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
                  Session Intel
                </h2>
                {[
                  ["ID", `#${selected.id}`],
                  ["Type", selected.type.toUpperCase()],
                  ["Platform", selected.platform || "Unknown"],
                  ["Architecture", selected.arch || "Unknown"],
                  ["Host Info", selected.info],
                  ["Tunnel", selected.tunnel],
                  ["Via Exploit", selected.via],
                  ["Workspace", selected.workspace],
                  ["Last Seen", new Date(selected.lastSeen).toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 rounded border border-white/[0.04] bg-white/[0.02] px-4 py-2.5">
                    <span className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
                    <span className="font-mono text-[11px] text-slate-200">{value}</span>
                  </div>
                ))}

                {/* Quick actions */}
                <div className="mt-6">
                  <h3 className="mb-3 text-[9px] font-semibold uppercase tracking-widest text-slate-500">Quick Actions</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "SYSINFO", id: "sysinfo" },
                      { label: "WHOAMI", id: "getuid" },
                      { label: "PROCESSES", id: "ps" },
                      { label: "NETWORK", id: "ifconfig" },
                      { label: "SCREENSHOT", id: "screenshot" },
                      { label: "HASHDUMP", id: "hashdump", danger: true },
                      { label: "GETSYSTEM", id: "getsystem", danger: true },
                      { label: "KEYSCAN", id: "keyscan_start" },
                      { label: "CLIPBOARD", id: "clipboard_get" },
                    ].map(action => {
                      const cmd = commands.find(c => c.id === action.id);
                      return (
                        <button
                          key={action.id}
                          type="button"
                          disabled={!cmd || executing}
                          onClick={() => cmd && runCommand(cmd)}
                          className={`rounded border py-2 text-[10px] font-semibold uppercase tracking-wider transition disabled:opacity-30 ${
                            action.danger
                              ? "border-red-800/50 bg-red-950/20 text-red-400 hover:bg-red-950/40"
                              : "border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-200"
                          }`}
                        >
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
