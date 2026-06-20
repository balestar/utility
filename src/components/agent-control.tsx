"use client";

import { useEffect, useState, useRef, useCallback } from "react";

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

const CATEGORY_ICONS: Record<string, string> = {
  System: "⚙",
  Filesystem: "📁",
  Process: "⚡",
  Network: "🌐",
  Credentials: "🔑",
  Surveillance: "📷",
  Persistence: "🔄",
  PrivEsc: "⬆",
  Shell: "💻",
  Exfil: "📤",
};

export function AgentControl() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [commands, setCommands] = useState<C2Command[]>([]);
  const [grouped, setGrouped] = useState<Record<string, C2Command[]>>({});
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<C2Result | null>(null);
  const [customCmd, setCustomCmd] = useState("");
  const [paramValue, setParamValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [activeSubTab, setActiveSubTab] = useState<"sessions" | "commands" | "console">("sessions");
  const [history, setHistory] = useState<{cmd: string; result: C2Result; timestamp: string}[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const refreshInterval = useRef<ReturnType<typeof setInterval>>(undefined);
  const nowRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => { nowRef.current = Date.now(); }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?action=sessions");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
  }, []);

  // Fetch commands
  useEffect(() => {
    async function load() {
      try {
        const [cmdRes, sessRes] = await Promise.all([
          fetch("/api/agents?action=commands"),
          fetch("/api/agents?action=sessions"),
        ]);
        const cmdData = await cmdRes.json();
        const sessData = await sessRes.json();
        if (cmdData.commands) setCommands(cmdData.commands);
        if (cmdData.grouped) setGrouped(cmdData.grouped);
        if (sessData.sessions) setSessions(sessData.sessions);
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    refreshInterval.current = setInterval(fetchSessions, 5000);
    return () => clearInterval(refreshInterval.current);
  }, [autoRefresh, fetchSessions]);

  // Scroll output on new result
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [result, history]);

  const handleExecute = async (cmd: C2Command) => {
    if (!selectedSession) return;
    setExecuting(true);
    setResult(null);

    try {
      const param = cmd.needsParam ? paramValue : undefined;
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          sessionId: selectedSession.id,
          commandId: cmd.id,
          param,
        }),
      });
      const data = await res.json();
      setResult(data);
      setHistory((prev) => [
        { cmd: `${cmd.name}${param ? " " + param : ""}`, result: data, timestamp: new Date().toISOString() },
        ...prev,
      ]);
    } catch {
      const err = { success: false, output: "", error: "Failed to execute command" };
      setResult(err);
    } finally {
      setExecuting(false);
      setParamValue("");
    }
  };

  const handleCustomCommand = async () => {
    if (!selectedSession || !customCmd.trim()) return;
    setExecuting(true);
    setResult(null);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          sessionId: selectedSession.id,
          command: customCmd,
        }),
      });
      const data = await res.json();
      setResult(data);
      setHistory((prev) => [
        { cmd: customCmd, result: data, timestamp: new Date().toISOString() },
        ...prev,
      ]);
    } catch {
      const err = { success: false, output: "", error: "Failed to execute command" };
      setResult(err);
    } finally {
      setExecuting(false);
      setCustomCmd("");
    }
  };

  // Filter commands
  const filteredCommands = activeCategory === "All"
    ? commands
    : (grouped[activeCategory] || []);

  const searchedCommands = searchQuery
    ? filteredCommands.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filteredCommands;

  // Command count per category
  const categories = Object.keys(grouped);

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Agent Control (C2)</h1>
        <p className="mt-1 text-sm text-zinc-500">Command &amp; control interface — send post-exploitation commands to active sessions</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* ── LEFT: Sessions List ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Agents ({sessions.length})
              </h2>
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-red-500"
                />
                Auto
              </label>
            </div>

            <div className="space-y-2">
              {sessions.length === 0 && (
                <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-600">
                  No active sessions
                </p>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => { setSelectedSession(session); setActiveSubTab("commands"); setResult(null); }}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedSession?.id === session.id
                      ? "border-red-700 bg-red-900/10"
                      : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${
                        nowRef.current - new Date(session.lastSeen).getTime() < 60000
                          ? "bg-emerald-500"
                          : "bg-zinc-600"
                      }`} />
                      <span className="font-mono text-sm text-red-400">#{session.id}</span>
                    </div>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                      {session.type}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-sm text-zinc-300">{session.info}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {session.platform || "unknown"} · {session.workspace}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Command Panel ── */}
          <div className="space-y-4">
            {/* Sub-tabs */}
            <div className="flex gap-2 border-b border-zinc-800 pb-3">
              {(["sessions", "commands", "console"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveSubTab(tab)}
                  className={`rounded-lg px-4 py-1.5 text-sm capitalize transition ${
                    activeSubTab === tab
                      ? "bg-red-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab === "sessions" ? "Details" : tab}
                </button>
              ))}
            </div>

            {!selectedSession && (
              <div className="flex items-center justify-center py-20">
                <p className="text-sm text-zinc-600">Select an agent from the list to begin</p>
              </div>
            )}

            {selectedSession && activeSubTab === "sessions" && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
                <h2 className="text-lg font-semibold text-white">Session #{selectedSession.id}</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Type</span>
                    <span className="text-zinc-200">{selectedSession.type}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Platform</span>
                    <span className="text-zinc-200">{selectedSession.platform || "unknown"}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Architecture</span>
                    <span className="text-zinc-200">{selectedSession.arch || "unknown"}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Connection</span>
                    <span className="font-mono text-xs text-zinc-200">{selectedSession.tunnel}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Exploit</span>
                    <span className="font-mono text-xs text-zinc-200">{selectedSession.via}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Workspace</span>
                    <span className="text-zinc-200">{selectedSession.workspace}</span>
                  </div>
                  <div className="flex justify-between rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <span className="text-zinc-500">Last Seen</span>
                    <span className="text-zinc-200">{new Date(selectedSession.lastSeen).toLocaleString()}</span>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "sysinfo")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    Get System Info
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "getuid")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    Get User
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "ps")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    List Processes
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "ifconfig")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    Network Info
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "hashdump")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50"
                  >
                    Hash Dump
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExecute(getCommandById(commands, "screenshot")!)}
                    disabled={executing}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    Screenshot
                  </button>
                </div>
              </div>
            )}

            {selectedSession && activeSubTab === "commands" && (
              <div className="space-y-4">
                {/* Search & Category filter */}
                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search commands..."
                    className="flex-1 rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none min-w-[200px]"
                  />
                  <select
                    value={activeCategory}
                    onChange={(e) => setActiveCategory(e.target.value)}
                    className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none"
                  >
                    <option value="All">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>{cat} ({grouped[cat]?.length || 0})</option>
                    ))}
                  </select>
                </div>

                {/* Command grid */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {searchedCommands.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      disabled={executing}
                      onClick={() => {
                        if (cmd.needsParam) {
                          const p = prompt(`${cmd.paramLabel || "Enter value"}:`, cmd.paramPlaceholder || "");
                          if (p !== null) {
                            setParamValue(p);
                            handleExecute(cmd);
                          }
                        } else {
                          handleExecute(cmd);
                        }
                      }}
                      className="group rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900/80 disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{CATEGORY_ICONS[cmd.category] || "▸"}</span>
                        <code className="text-sm font-mono text-red-400 group-hover:text-red-300">{cmd.name}</code>
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2">{cmd.description}</p>
                      {cmd.needsParam && (
                        <span className="mt-1.5 inline-block rounded bg-red-900/20 px-1.5 py-0.5 text-[10px] text-red-400">
                          needs input
                        </span>
                      )}
                    </button>
                  ))}
                  {searchedCommands.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-zinc-600">
                      {searchQuery ? "No commands match your search" : "No commands in this category"}
                    </p>
                  )}
                </div>
              </div>
            )}

            {selectedSession && activeSubTab === "console" && (
              <div className="space-y-4">
                {/* Custom command input */}
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={customCmd}
                    onChange={(e) => setCustomCmd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCustomCommand(); }}
                    placeholder="Type any meterpreter command..."
                    className="flex-1 rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-red-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCustomCommand}
                    disabled={executing || !customCmd.trim()}
                    className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {executing ? "..." : "Send"}
                  </button>
                </div>

                {/* Output */}
                {result && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`text-xs font-semibold uppercase tracking-wider ${
                        result.success ? "text-emerald-500" : "text-red-500"
                      }`}>
                        {result.success ? "Success" : "Error"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setResult(null)}
                        className="text-xs text-zinc-600 hover:text-zinc-400"
                      >
                        Clear
                      </button>
                    </div>
                    {result.error && (
                      <p className="mb-2 text-sm text-red-400">{result.error}</p>
                    )}
                    <pre
                      ref={outputRef}
                      className="max-h-96 overflow-auto rounded-xl bg-black p-4 font-mono text-xs leading-relaxed text-emerald-400/90 whitespace-pre-wrap"
                    >
                      {result.output}
                    </pre>
                  </div>
                )}

                {/* History */}
                {history.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Command History</h3>
                      <button
                        type="button"
                        onClick={() => setHistory([])}
                        className="text-xs text-zinc-600 hover:text-zinc-400"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="space-y-2">
                      {history.map((entry, i) => (
                        <div key={i} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                          <div className="flex items-center justify-between">
                            <code className="text-sm text-red-400">{entry.cmd}</code>
                            <span className="text-[10px] text-zinc-700">
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          {entry.result.error && (
                            <p className="mt-1 text-xs text-red-400">{entry.result.error}</p>
                          )}
                          {entry.result.output && (
                            <pre className="mt-1 max-h-20 overflow-hidden text-ellipsis text-xs text-zinc-500">
                              {entry.result.output.slice(0, 200)}
                              {entry.result.output.length > 200 ? "..." : ""}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getCommandById(commands: C2Command[], id: string): C2Command | undefined {
  return commands.find((c) => c.id === id);
}
