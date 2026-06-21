/**
 * MSF Console API — persistent console session per server lifetime.
 * Uses MSF RPC console.create / console.write / console.read.
 *
 * Each Next.js server instance owns one MSF console. Commands are
 * serialized through a single console to avoid interleaving output.
 */

import { NextResponse } from "next/server";
import { getMsfConfig } from "@/lib/msf-config";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { demoSessions, demoModules, demoVersion, demoWorkspaces } from "@/lib/msf-demo";

// ── Demo command simulator ────────────────────────────────────
function simulateDemoCommand(cmd: string): string {
  const c = cmd.trim().toLowerCase();
  if (c === "version" || c === "core.version")
    return `Framework Version: ${demoVersion.version}\nRuby Version: ${demoVersion.ruby}\nAPI: ${demoVersion.api}`;
  if (c === "sessions" || c === "sessions -l")
    return demoSessions.map((s) =>
      `  ${s.id}  ${s.type}  ${s.tunnel}  opened  ${s.info}`).join("\n") || "No active sessions.";
  if (c.startsWith("sessions -i"))
    return `[*] Starting interaction with session ${c.split(" ").pop()}...\nmeterpreter > `;
  if (c === "workspace" || c === "workspace -l")
    return demoWorkspaces.map((w) => `  ${w.name}`).join("\n");
  if (c.startsWith("search ")) {
    const kw = c.replace("search ", "");
    const all = [...demoModules.exploits, ...demoModules.payloads, ...demoModules.auxiliary];
    const hits = all.filter((m) => m.name.includes(kw) || m.description.toLowerCase().includes(kw));
    if (hits.length === 0) return `[*] No results for '${kw}'`;
    return hits.map((m) => `   ${m.name}   ${m.rank}   ${m.description}`).join("\n");
  }
  if (c === "show exploits")
    return demoModules.exploits.map((m) => `   ${m.name}   ${m.rank}   ${m.description}`).join("\n");
  if (c === "show payloads")
    return demoModules.payloads.map((m) => `   ${m.name}   ${m.rank}   ${m.description}`).join("\n");
  if (c === "show auxiliary")
    return demoModules.auxiliary.map((m) => `   ${m.name}   ${m.rank}   ${m.description}`).join("\n");
  if (c === "help" || c === "?")
    return `Core Commands\n=============\n  sessions  - Manage sessions\n  search    - Search modules\n  use       - Select module\n  show      - Display info\n  workspace - Manage workspaces\n  version   - Show version\n  exit      - Exit console`;
  if (c.startsWith("use "))
    return `[*] Using configured module ${c.replace("use ", "")}`;
  if (c === "exit" || c === "quit")
    return "[*] Demo mode — console reset";
  return `[*] DEMO MODE — Command '${cmd}' simulated (MSF backend not connected)\nmsf6 > `;
}

// In-memory state (server lifetime)
let persistentConsoleId: string | null = null;
const consoleHistory: string[] = [];
let commandLock = false;

// Queue: when the console is busy, subsequent requests wait in line
interface QueuedCommand {
  command: string;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}
const commandQueue: QueuedCommand[] = [];
const QUEUE_MAX = 10;

async function enqueueCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (commandQueue.length >= QUEUE_MAX) {
      reject(new Error("Console queue full — too many pending commands"));
      return;
    }
    commandQueue.push({ command, resolve, reject });
  });
}

async function drainQueue(token: string, consoleId: string) {
  while (commandQueue.length > 0) {
    const item = commandQueue.shift()!;
    try {
      await rpcCall("console.write", [consoleId, item.command + "\n"], token);
      const output = await waitForOutput(token, consoleId);
      consoleHistory.push(`msf6 > ${item.command}`);
      if (output) consoleHistory.push(output);
      if (consoleHistory.length > 1000) consoleHistory.splice(0, consoleHistory.length - 1000);
      item.resolve(output);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

// ── Console lifecycle ─────────────────────────────────────────

async function getOrCreateConsole(token: string): Promise<string> {
  if (persistentConsoleId !== null) {
    // Verify the console is still alive
    try {
      await rpcCall<{ busy?: boolean }>("console.read", [persistentConsoleId], token);
      return persistentConsoleId;
    } catch {
      persistentConsoleId = null;
    }
  }

  const created = await rpcCall<{ id?: string | number }>("console.create", [], token);
  persistentConsoleId = String(created.id ?? "0");

  // Wait for MSF banner to finish loading
  await new Promise((r) => setTimeout(r, 1500));
  // Drain any banner output
  await rpcCall("console.read", [persistentConsoleId], token);

  return persistentConsoleId;
}

/**
 * Wait until the console is no longer busy, collecting all output.
 */
async function waitForOutput(token: string, consoleId: string, maxWaitMs = 30000): Promise<string> {
  const start = Date.now();
  let output = "";

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await rpcCall<{ data?: string; busy?: boolean }>(
      "console.read", [consoleId], token,
    );
    output += res.data ?? "";
    if (!res.busy) break;
  }

  return output.trim();
}

// ── API Handlers ──────────────────────────────────────────────

export async function GET() {
  const config = getMsfConfig();
  return NextResponse.json({
    history: consoleHistory.slice(-500),
    demo: config.demoMode,
    consoleId: persistentConsoleId,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command required" }, { status: 400 });
  }

  const config = getMsfConfig();
  if (config.demoMode) {
    const simulated = simulateDemoCommand(command);
    consoleHistory.push(`msf6 > ${command}`);
    if (simulated) consoleHistory.push(simulated);
    return NextResponse.json({ output: simulated, demo: true });
  }

  // If console is busy, queue this command and wait (up to 30s)
  if (commandLock) {
    try {
      const output = await Promise.race([
        enqueueCommand(command),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Console queue timeout (30s)")), 30000)
        ),
      ]);
      return NextResponse.json({ output, demo: false, consoleId: persistentConsoleId, queued: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 503 });
    }
  }

  commandLock = true;
  try {
    const token = await getRpcToken();
    const consoleId = await getOrCreateConsole(token);

    // Write and read the primary command
    await rpcCall("console.write", [consoleId, command + "\n"], token);
    const output = await waitForOutput(token, consoleId);

    consoleHistory.push(`msf6 > ${command}`);
    if (output) consoleHistory.push(output);
    if (consoleHistory.length > 1000) consoleHistory.splice(0, consoleHistory.length - 1000);

    // Drain any queued commands while we still hold the token
    await drainQueue(token, consoleId);

    return NextResponse.json({ output, demo: false, consoleId });
  } catch (err) {
    persistentConsoleId = null;
    // Drain queue with errors so queued callers don't hang
    commandQueue.splice(0).forEach((q) =>
      q.reject(err instanceof Error ? err : new Error(String(err)))
    );
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    commandLock = false;
  }
}

export async function DELETE() {
  // Reset console and clear history
  if (persistentConsoleId !== null) {
    try {
      const token = await getRpcToken();
      await rpcCall("console.destroy", [persistentConsoleId], token);
    } catch { /* ignore */ }
    persistentConsoleId = null;
  }
  consoleHistory.length = 0;
  return NextResponse.json({ ok: true });
}
