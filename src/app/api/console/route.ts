import { NextResponse } from "next/server";
import { getMsfConfig } from "@/lib/msf-config";
import { demoVersion } from "@/lib/msf-demo";

// In-memory console state (server memory, resets on restart)
// Production would use Redis or DB — this is enough for single-server use
const consoleHistory: string[] = [];
let demoLine = 0;

const DEMO_RESPONSES: Record<string, string> = {
  help: `Core Commands
=============
    Command       Description
    -------       -----------
    ?             Help menu
    background    Backgrounds the current session
    cd            Change the current working directory
    connect       Communicate with a host
    debug         Display information for debugging
    exit          Exit the console
    info          Displays information about a module
    jobs          Displays and manages jobs
    kill          Kill a job
    load          Load a framework plugin
    quit          Exit the console
    route         Route traffic through a session
    search        Searches module names and descriptions
    sessions      Dump session listings
    set           Sets a variable to a value
    show          Displays modules of a given type, or all modules
    use           Selects a module by name
    version       Show the framework and console library version numbers`,

  version: `Framework: 6.4.0-dev
Console  : 6.4.0-dev (demo)`,

  sessions: `Active sessions
===============
  Id  Name  Type                     Information                   Connection
  --  ----  ----                     -----------                   ----------
  1         meterpreter x64/windows  DESKTOP-LAB\\admin @ DESKTOP  10.0.0.1:4444 -> 192.168.1.42:49152 (192.168.1.42)`,

  jobs: `Jobs
====
  Id  Name               Payload
  --  ----               -------
  0   Exploit: multi/handler  windows/x64/meterpreter/reverse_tcp`,

  "show exploits": "Use 'search' to filter exploits by keyword. Example: search type:exploit platform:windows",
  "show payloads": "Use 'search' to filter payloads by keyword. Example: search type:payload platform:windows",
  "show modules": "show exploits | show payloads | show auxiliary | show post | show encoders",
  route: "No routes defined.",
  exit: "[*] Exiting...",
  quit: "[*] Exiting...",
};

function demoExec(cmd: string): string {
  const lower = cmd.trim().toLowerCase();
  if (!lower) return "";
  if (lower.startsWith("search ")) {
    const kw = cmd.slice(7).trim();
    return `Matching Modules
================
   #   Name                                              Disclosure Date  Rank       Description
   -   ----                                              ---------------  ----       -----------
   0   exploit/windows/smb/ms17_010_eternalblue          2017-03-14       average    EternalBlue SMB RCE
   1   exploit/multi/http/log4shell_header_injection     2021-12-09       excellent  Log4Shell JNDI RCE
   2   auxiliary/scanner/portscan/tcp                    -                normal     TCP Port Scanner
   (filtered for: ${kw})`;
  }
  if (lower.startsWith("use ")) {
    const mod = cmd.slice(4).trim();
    return `[*] Using configured payload windows/x64/meterpreter/reverse_tcp\nmsf6 ${mod}(module) > `;
  }
  if (lower.startsWith("set ")) return `${cmd.slice(4).split(" ")[0].toUpperCase()} => ${cmd.slice(4).split(" ").slice(1).join(" ")}`;
  if (lower.startsWith("run") || lower.startsWith("exploit")) return `[*] Started reverse TCP handler on 0.0.0.0:4444\n[*] Sending stage (175686 bytes) to 192.168.1.42\n[*] Meterpreter session 2 opened`;
  if (lower.startsWith("sessions -i")) return `[*] Starting interaction with session ${lower.split(" ").pop()}...`;
  if (lower in DEMO_RESPONSES) return DEMO_RESPONSES[lower];
  return `[-] Unknown command: ${cmd}. Type 'help' for available commands.`;
}

export async function GET() {
  // Return console history
  return NextResponse.json({ history: consoleHistory.slice(-200) });
}

export async function POST(request: Request) {
  const { command } = await request.json();
  if (typeof command !== "string") {
    return NextResponse.json({ error: "command required" }, { status: 400 });
  }

  const config = getMsfConfig();

  if (config.demoMode) {
    const output = demoExec(command);
    const entry = `msf6 > ${command}`;
    consoleHistory.push(entry);
    if (output) consoleHistory.push(output);
    return NextResponse.json({ output, demo: true, version: demoVersion.version });
  }

  // Live mode — use MSF RPC
  try {
    const { rpcCall, getRpcToken } = await import("@/lib/msf-rpc");
    const token = await getRpcToken();

    // Create a console if we don't have one
    let consoleId: string;
    try {
      const created = await rpcCall<{ id?: string }>("console.create", [], token);
      consoleId = String(created.id ?? "0");
    } catch {
      consoleId = "0";
    }

    // Write command
    await rpcCall("console.write", [consoleId, command + "\n"], token);
    await new Promise(r => setTimeout(r, 600));

    // Read output
    const read = await rpcCall<{ data?: string }>("console.read", [consoleId], token);
    const output = (read?.data ?? "").trim();

    consoleHistory.push(`msf6 > ${command}`);
    if (output) consoleHistory.push(output);

    return NextResponse.json({ output, demo: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  // Clear history
  consoleHistory.length = 0;
  return NextResponse.json({ ok: true });
}
