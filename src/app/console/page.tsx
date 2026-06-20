"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Line = { text: string; type: "input" | "output" | "error" | "system" };

const BANNER = [
  "       __  _______ __  ____  __  _______ __  __",
  "      / / / / _  // / /  _/ / / /  _  // / / /",
  "     / /_/ / __  / / / /   / / / __  // /_/ /",
  "     \\____/_/ /_/_/ /_/   /_/ /_/ /_/ \\____/",
  "",
  "  UTILITY COMMAND CENTER  ·  METASPLOIT CONSOLE",
  "  Type 'help' for commands. Type 'clear' to clear.",
  "",
];

export default function ConsolePage() {
  const [lines, setLines] = useState<Line[]>([
    ...BANNER.map(t => ({ text: t, type: "system" as const })),
    { text: "Connecting to Metasploit RPC...", type: "system" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [connected, setConnected] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = useCallback((text: string, type: Line["type"] = "output") => {
    setLines(prev => [...prev, { text, type }]);
  }, []);

  // Initial connection test
  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then(d => {
        setConnected(d.connected || d.demo);
        push(
          d.demo
            ? `[DEMO MODE] MSF ${d.version ?? "6.4"} — commands are simulated`
            : d.connected
              ? `[CONNECTED] MSF ${d.version} — live RPC`
              : "[OFFLINE] Backend unreachable — start Docker stack first",
          d.connected || d.demo ? "system" : "error"
        );
        push("msf6 > ", "system");
      })
      .catch(() => {
        setConnected(false);
        push("[OFFLINE] Cannot reach backend", "error");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const run = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    if (trimmed === "clear") {
      setLines(BANNER.map(t => ({ text: t, type: "system" })));
      return;
    }

    push(`msf6 > ${trimmed}`, "input");
    setHistory(h => [trimmed, ...h.filter(x => x !== trimmed)].slice(0, 100));
    setHistIdx(-1);
    setBusy(true);

    try {
      const res = await fetch("/api/console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed }),
      });
      const data = await res.json();
      if (data.error) {
        push(`[-] ${data.error}`, "error");
      } else if (data.output) {
        data.output.split("\n").forEach((line: string) => push(line, "output"));
      }
    } catch {
      push("[-] Network error — cannot reach server", "error");
    } finally {
      setBusy(false);
      push("msf6 > ", "system");
    }
  }, [push]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const val = input;
      setInput("");
      run(val);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1);
        setInput(history[next] ?? "");
        return next;
      });
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.max(i - 1, -1);
        setInput(next === -1 ? "" : (history[next] ?? ""));
        return next;
      });
    }
    if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setLines(BANNER.map(t => ({ text: t, type: "system" })));
    }
  };

  const clearConsole = async () => {
    await fetch("/api/console", { method: "DELETE" });
    setLines(BANNER.map(t => ({ text: t, type: "system" })));
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${connected === null ? "bg-slate-600" : connected ? "bg-green-500 status-pulse" : "bg-red-500"}`} />
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            {connected === null ? "Connecting..." : connected ? "MSF Console — Live" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => run("help")}
            className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-slate-400"
          >
            Help
          </button>
          <button
            type="button"
            onClick={() => run("sessions")}
            className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-slate-400"
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => run("jobs")}
            className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-slate-400"
          >
            Jobs
          </button>
          <button
            type="button"
            onClick={clearConsole}
            className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-600 transition hover:text-red-400"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal output */}
      <div
        className="flex-1 overflow-y-auto bg-[#04040b] p-5 font-mono text-[12px] leading-relaxed cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((line, i) => (
          <div key={i} className={
            line.type === "input"  ? "text-green-400" :
            line.type === "error"  ? "text-red-400" :
            line.type === "system" ? "text-slate-600" :
                                     "text-slate-300"
          }>
            {line.text || "\u00A0"}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
            <span>Executing...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/[0.05] bg-[#04040b]">
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="shrink-0 font-mono text-[12px] text-green-500">msf6 &gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={busy}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Type a command... (↑↓ for history)"
            className="flex-1 bg-transparent font-mono text-[12px] text-green-400 caret-green-500 placeholder-slate-700 focus:outline-none disabled:opacity-40"
          />
          {busy && <span className="shrink-0 h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-green-500" />}
        </div>

        {/* Quick command chips */}
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.04] px-5 py-2">
          {["search eternalblue", "sessions -l", "jobs -l", "version", "use exploit/multi/handler", "set PAYLOAD windows/x64/meterpreter/reverse_tcp", "set LHOST 0.0.0.0", "set LPORT 4444", "run -j"].map(cmd => (
            <button
              key={cmd}
              type="button"
              onClick={() => run(cmd)}
              disabled={busy}
              className="rounded border border-white/[0.05] bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] text-slate-600 transition hover:border-green-900/50 hover:text-green-500 disabled:opacity-30"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
