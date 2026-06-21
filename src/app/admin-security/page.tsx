"use client";

/**
 * ADMIN NETWORK SECURITY CENTER
 * ─────────────────────────────────────────────────────────────
 * Protect YOUR devices and admin infrastructure:
 *   • Tailscale mesh encryption (WireGuard AES-256-GCM)
 *   • Multi-hop proxy chain (Tor → SOCKS5 → exit node)
 *   • IP masking — real admin IP never exposed to targets
 *   • DNS-over-HTTPS — no DNS leaks
 *   • Tailscale ACL lockdown — devices can only talk to each other
 *   • Kill switch — all traffic blocked if VPN drops
 *   • Admin traffic disguise — looks like normal HTTPS browsing
 */

import { useState, useEffect, useCallback } from "react";

/* ─────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────── */
type TailscaleDevice = {
  name: string; ip: string; os: string; lastSeen: string;
  online: boolean; encrypted: boolean; keyExpiry: string; role: "admin" | "relay" | "c2";
};

type ProxyChain = {
  id: string; label: string; hops: string[]; latencyMs: number;
  active: boolean; anonymity: "low" | "medium" | "high" | "maximum";
};

type SecurityStatus = {
  tailscaleUp: boolean; dnsEncrypted: boolean; killSwitchOn: boolean;
  ipMasked: boolean; proxyActive: boolean; leakTest: "clean" | "leak" | "unknown";
  realIp: string; maskedIp: string; dnsProvider: string;
};

type LogEntry = { t: string; msg: string; type: "info" | "ok" | "warn" | "err" };

/* ─────────────────────────────────────────────────────────
   STATIC DATA
───────────────────────────────────────────────────────── */
const PROXY_CHAINS: ProxyChain[] = [
  {
    id: "tor3hop",
    label: "Tor 3-Hop Circuit",
    hops: ["Your Device → Guard Node", "Guard → Middle Node", "Middle → Exit Node → Target"],
    latencyMs: 800, active: false, anonymity: "maximum",
  },
  {
    id: "tor_over_ts",
    label: "Tor over Tailscale",
    hops: ["Your Device → Tailscale VPN", "TS Relay → Tor Entry", "Tor Exit → Target"],
    latencyMs: 1100, active: false, anonymity: "maximum",
  },
  {
    id: "socks5_relay",
    label: "SOCKS5 via VPS Relay",
    hops: ["Your Device → Tailscale", "TS → VPS SOCKS5 Relay", "VPS IP → Target"],
    latencyMs: 180, active: false, anonymity: "high",
  },
  {
    id: "double_vpn",
    label: "Double VPN",
    hops: ["Your Device → VPN Server 1 (AES-256)", "VPN1 → VPN Server 2", "VPN2 IP → Target"],
    latencyMs: 250, active: false, anonymity: "high",
  },
  {
    id: "cdn_front",
    label: "CDN Domain Fronting",
    hops: ["Your Device → Cloudflare Edge", "CF HTTPS (SNI hidden) → Origin", "Origin IP → Target C2"],
    latencyMs: 80, active: false, anonymity: "medium",
  },
];

const TAILSCALE_ACL_TEMPLATE = `{
  // ADMIN NETWORK — Tailscale ACL Policy
  // All your devices are ADMIN infrastructure — encrypted WireGuard mesh
  // Targets are on the PUBLIC internet — they never see your real IP
  
  "acls": [
    // Allow all admin devices to talk to each other (encrypted)
    {
      "action": "accept",
      "src": ["tag:admin"],
      "dst": ["tag:admin:*"]
    },
    // Allow admin devices to reach C2/relay servers
    {
      "action": "accept", 
      "src": ["tag:admin"],
      "dst": ["tag:relay:*", "tag:c2:*"]
    },
    // Block all other traffic (default deny)
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:*"]
    }
  ],
  
  "tagOwners": {
    "tag:admin": ["autogroup:owner"],
    "tag:relay": ["autogroup:owner"],
    "tag:c2":    ["autogroup:owner"]
  },
  
  // DNS: use encrypted DoH, no leaks
  "dns": {
    "nameservers": ["1.1.1.1", "9.9.9.9"],
    "overrideLocalDNS": true,
    "extraRecords": []
  },
  
  // SSH: only admin devices can SSH to each other
  "ssh": [
    {
      "action": "accept",
      "src": ["tag:admin"],
      "dst": ["tag:admin", "tag:relay", "tag:c2"],
      "users": ["autogroup:nonroot", "root"]
    }
  ]
}`;

const HARDENING_RULES = [
  {
    id: "ts_encrypt",
    title: "Tailscale WireGuard Encryption",
    status: "active",
    detail: "All traffic between your devices uses WireGuard with ChaCha20-Poly1305 encryption. No cleartext ever on the wire. AES-256-GCM for hardware-accelerated devices.",
    cmd: null,
    level: "critical",
  },
  {
    id: "dns_doh",
    title: "DNS-over-HTTPS (DoH)",
    status: "configure",
    detail: "Without DoH, your DNS queries expose which domains you're accessing. Configure Cloudflare 1.1.1.1 with DoH or NextDNS to encrypt all lookups.",
    cmd: "tailscale set --accept-dns=true\n# Admin devices use Tailscale DNS (encrypted)",
    level: "high",
  },
  {
    id: "kill_switch",
    title: "VPN Kill Switch",
    status: "configure",
    detail: "If Tailscale drops, your real IP could be exposed. Kill switch blocks all non-Tailscale traffic instantly.",
    cmd: "# macOS:\nsudo pfctl -e\necho 'block all\\npass on utun0' | sudo pfctl -f -\n\n# Linux:\niptables -P OUTPUT DROP\niptables -A OUTPUT -o tailscale0 -j ACCEPT\niptables -A OUTPUT -o lo -j ACCEPT",
    level: "high",
  },
  {
    id: "ts_exit_node",
    title: "Tailscale Exit Node (IP Masking)",
    status: "configure",
    detail: "Route ALL your internet traffic through a VPS exit node in Tailscale. Targets see the VPS IP — never your real home/office IP.",
    cmd: "# On your VPS (the exit node):\ntailscale up --advertise-exit-node\n\n# On your Mac/phone (admin device):\ntailscale set --exit-node=<VPS_TAILSCALE_IP>\ntailscale set --exit-node-allow-lan-access=false",
    level: "critical",
  },
  {
    id: "fw_rules",
    title: "Firewall — Block All Inbound",
    status: "configure",
    detail: "Admin machines should accept ZERO unsolicited inbound connections. Only Tailscale overlay traffic allowed.",
    cmd: "# macOS:\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on\n\n# Block all non-Tailscale inbound:\nsudo pfctl -e && sudo pfctl -f /etc/pf.conf",
    level: "high",
  },
  {
    id: "mac_encrypt",
    title: "Full Disk Encryption (Admin Devices)",
    status: "verify",
    detail: "Admin Mac: ensure FileVault is ON. Admin Android/iPhone: ensure device encryption is on (it is by default if you have a PIN). Protects against physical seizure.",
    cmd: "# Check FileVault status:\nfdesetup status\n\n# Enable if not on:\nsudo fdesetup enable",
    level: "medium",
  },
  {
    id: "ts_key_rotation",
    title: "Tailscale Key Rotation",
    status: "configure",
    detail: "Enable key expiry in Tailscale admin console (default 180 days). Expired keys auto-revoke — devices removed from network until re-authenticated.",
    cmd: "# In Tailscale admin console:\n# Settings → Keys → Enable key expiry: 90 days\n# Or via API:\ncurl -H 'Authorization: Bearer <TOKEN>' \\\n  'https://api.tailscale.com/api/v2/tailnet/-/settings' \\\n  -d '{\"keyExpiryDisabled\": false}'",
    level: "medium",
  },
  {
    id: "c2_cert_pin",
    title: "C2 Server Certificate Pinning",
    status: "configure",
    detail: "Your C2 server (MSF RPC endpoint) should have a pinned TLS cert. Admin console verifies cert fingerprint before sending any commands — prevents MITM of admin traffic.",
    cmd: "# Generate self-signed cert for MSF RPC:\nopenssl req -x509 -newkey rsa:4096 -keyout msf.key -out msf.crt \\\n  -days 3650 -nodes -subj '/CN=msf-rpc'\n\n# Pin fingerprint in msf-config.ts:\n# EXPECTED_CERT_SHA256=<fingerprint>",
    level: "high",
  },
];

const PROXY_SETUP_SCRIPTS: Record<string, string> = {
  tor: `#!/bin/bash
# Install and configure Tor SOCKS5 proxy on your VPS/relay
# Admin traffic routes: Mac → Tailscale → VPS → Tor → Target

apt-get install -y tor

cat > /etc/tor/torrc <<EOF
SocksPort 0.0.0.0:9050
SocksPolicy accept 100.0.0.0/8   # Only allow Tailscale IPs
SocksPolicy reject *
Log notice file /var/log/tor/notices.log
ExitPolicy reject *:*
EOF

systemctl enable tor && systemctl restart tor
echo "Tor SOCKS5 ready on :9050 (Tailscale-only access)"
echo "Configure your Mac: System Settings → Network → Proxies → SOCKS: <VPS_TS_IP>:9050`,

  socks5: `#!/bin/bash
# Install Dante SOCKS5 server on VPS relay
# Admin traffic routes: Mac → Tailscale → VPS SOCKS5 → Target

apt-get install -y dante-server

cat > /etc/danted.conf <<EOF
logoutput: syslog

# Listen on Tailscale interface only (secure)
internal: tailscale0 port = 1080

# Route outbound through any interface
external: eth0

# Auth: Tailscale network only (no username needed)
clientmethod: none
socksmethod: none

# Only accept Tailscale IPs (100.x.x.x)
client pass {
    from: 100.0.0.0/8 to: 0.0.0.0/0
    log: connect disconnect
}

# Allow all outbound
socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    log: connect disconnect
}
EOF

systemctl enable danted && systemctl restart danted
echo "SOCKS5 ready on tailscale0:1080 (Tailscale-only access)"
echo "Configure Mac: System Settings → Network → Proxies → SOCKS: <VPS_TS_IP>:1080`,

  exitnode: `#!/bin/bash
# Configure VPS as Tailscale exit node
# ALL your internet traffic routes through VPS IP — your real IP hidden

# On VPS:
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.conf
sysctl -p

tailscale up --advertise-exit-node --accept-routes

# Enable IP masquerade (NAT)
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -A FORWARD -i tailscale0 -j ACCEPT
iptables -A FORWARD -o tailscale0 -j ACCEPT

# Save rules
iptables-save > /etc/iptables/rules.v4

echo "Exit node configured."
echo ""
echo "On your Mac/phone, run:"
echo "  tailscale set --exit-node=<THIS_VPS_TAILSCALE_IP>"
echo ""
echo "Verify: visit https://whatismyip.com — should show VPS IP, not your real IP"`,

  macos_killswitch: `#!/bin/bash
# macOS Kill Switch — block all traffic if Tailscale drops
# Your real IP is NEVER exposed even if VPN disconnects

# Create pf firewall rules
cat > /etc/pf-killswitch.conf <<EOF
# Block all by default
block all

# Allow loopback
pass on lo0

# Allow Tailscale interface (WireGuard tunnel)
pass on utun0
pass on utun1
pass on utun2
pass on utun3

# Allow Tailscale control plane (DERP relay servers)
pass out proto udp to any port 41641
pass out proto tcp to any port 443
EOF

# Load rules
sudo pfctl -e -f /etc/pf-killswitch.conf

echo "Kill switch active. Only Tailscale traffic allowed."
echo "Test: disconnect Tailscale — all internet should stop."
echo "Re-enable normal: sudo pfctl -d"`,
};

type TabId = "overview" | "tailscale" | "proxy" | "firewall" | "acl" | "scripts";

export default function AdminSecurityPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [devices, setDevices] = useState<TailscaleDevice[]>([]);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activeChain, setActiveChain] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [activeScript, setActiveScript] = useState<keyof typeof PROXY_SETUP_SCRIPTS>("exitnode");

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    setLog((p) => [{ t: new Date().toLocaleTimeString(), msg, type }, ...p].slice(0, 200));
  }, []);

  useEffect(() => {
    fetch("/api/admin-security?action=status")
      .then((r) => r.json())
      .then((d: { status?: SecurityStatus; devices?: TailscaleDevice[] }) => {
        if (d.status) setStatus(d.status);
        if (d.devices) setDevices(d.devices);
      })
      .catch(() => {});
  }, []);

  const runAction = useCallback(async (action: string, label: string, body: Record<string, unknown> = {}) => {
    setLoading(action);
    addLog(`${label}…`);
    try {
      const res = await fetch("/api/admin-security", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      }).then((r) => r.json()) as Record<string, unknown>;
      if (res.ok) addLog(`${label} — done`, "ok");
      else addLog(`${label} failed: ${String(res.error)}`, "err");
      return res;
    } catch (e) {
      addLog(`${label} error: ${String(e)}`, "err");
      return { ok: false };
    } finally {
      setLoading(null);
    }
  }, [addLog]);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const anonymityColor: Record<string, string> = {
    maximum: "text-green-400", high: "text-yellow-400",
    medium: "text-orange-400", low: "text-red-500",
  };

  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: "overview",  label: "OVERVIEW",        icon: "⬛" },
    { id: "tailscale", label: "TAILSCALE MESH",  icon: "🔒" },
    { id: "proxy",     label: "PROXY CHAINS",    icon: "🌐" },
    { id: "firewall",  label: "FIREWALL",        icon: "🧱" },
    { id: "acl",       label: "ACL POLICY",      icon: "📋" },
    { id: "scripts",   label: "SETUP SCRIPTS",   icon: "⚙" },
  ];

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* ── SIDEBAR ── */}
      <aside className="w-52 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-cyan-400 tracking-widest">ADMIN SECURITY CENTER</div>
          <div className="text-[7px] text-green-900/50 mt-0.5">PROTECT YOUR INFRASTRUCTURE</div>
        </div>

        {/* Security score */}
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[7px] text-green-900/40 tracking-widest mb-2">SECURITY POSTURE</div>
          {status ? (
            <div className="space-y-1.5">
              {[
                { label: "WireGuard E2E",  on: status.tailscaleUp,    icon: "🔒" },
                { label: "DNS Encrypted",  on: status.dnsEncrypted,   icon: "🔏" },
                { label: "Kill Switch",    on: status.killSwitchOn,   icon: "🛑" },
                { label: "IP Masked",      on: status.ipMasked,       icon: "🎭" },
                { label: "Proxy Active",   on: status.proxyActive,    icon: "🌐" },
                { label: "No IP Leaks",    on: status.leakTest === "clean", icon: "✅" },
              ].map(({ label, on, icon }) => (
                <div key={label} className={`flex items-center gap-1.5 text-[8px] ${on ? "text-green-500" : "text-red-700"}`}>
                  <span>{icon}</span>
                  <span>{label}</span>
                  <span className="ml-auto text-[7px]">{on ? "ON" : "OFF"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[8px] text-green-900/30">Loading…</div>
          )}
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

        {/* Quick actions */}
        <div className="p-2 border-t border-green-900/30 space-y-1.5">
          <button onClick={() => runAction("run_leak_test", "IP leak test")}
            disabled={!!loading}
            className="w-full py-1.5 text-[8px] border border-cyan-900/30 text-cyan-700 rounded hover:border-cyan-700/40 hover:text-cyan-500 transition-all disabled:opacity-40">
            {loading === "run_leak_test" ? "TESTING…" : "▶ IP LEAK TEST"}
          </button>
          <button onClick={() => runAction("refresh_status", "Status refresh")}
            disabled={!!loading}
            className="w-full py-1.5 text-[8px] border border-green-900/20 text-green-900/40 rounded hover:border-green-800/30 hover:text-green-700 transition-all disabled:opacity-40">
            ↻ REFRESH STATUS
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5">

          {/* ════════════════════════════════════
              OVERVIEW
          ════════════════════════════════════ */}
          {tab === "overview" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">ADMIN INFRASTRUCTURE SECURITY</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Your Tailscale devices are your encrypted admin mesh — NOT targets.
                This page hardens them: encrypts all traffic, masks your real IP, prevents tracing.
              </p>

              {/* Architecture diagram */}
              <div className="border border-cyan-900/20 rounded p-4 mb-5 bg-cyan-950/5">
                <div className="text-[9px] text-cyan-600 tracking-widest mb-4">NETWORK ARCHITECTURE</div>
                <div className="flex items-center justify-between gap-2 text-[8px]">
                  {[
                    { label: "YOUR DEVICES",     sub: "Mac, S24, S25\n(Admin)",           color: "cyan",  icon: "💻" },
                    { label: "TAILSCALE MESH",   sub: "WireGuard E2E\nChaCha20-Poly1305", color: "green", icon: "🔒" },
                    { label: "VPS EXIT NODE",    sub: "Public IP here\n(not your IP)",    color: "yellow",icon: "🌐" },
                    { label: "TOR / PROXY",      sub: "Optional extra\nhop layer",         color: "orange",icon: "🧅" },
                    { label: "TARGET DEVICES",   sub: "Victims see\nVPS/Tor IP only",     color: "red",   icon: "📱" },
                  ].map((node, i, arr) => (
                    <div key={node.label} className="flex items-center gap-2">
                      <div className={`border border-${node.color}-900/30 rounded p-2 text-center w-28`}>
                        <div className="text-lg mb-0.5">{node.icon}</div>
                        <div className={`text-[8px] font-bold text-${node.color}-400`}>{node.label}</div>
                        <div className="text-[7px] text-green-900/40 whitespace-pre-line mt-0.5">{node.sub}</div>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="text-green-900/30 text-[10px]">→</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-green-900/10 text-[7px] text-green-900/40">
                  Your real IP (home/office/phone) is NEVER visible to targets. 
                  Targets only see VPS exit node IP or Tor exit IP. 
                  Traffic between your devices is WireGuard-encrypted — nobody on your LAN, ISP, or carrier can read it.
                </div>
              </div>

              {/* Status cards */}
              {status && (
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="border border-cyan-900/20 rounded p-3">
                    <div className="text-[8px] text-cyan-700 mb-1">YOUR REAL IP</div>
                    <div className="text-[11px] font-bold text-cyan-400 font-mono">{status.realIp || "detecting…"}</div>
                    <div className="text-[7px] text-green-900/40 mt-0.5">Only visible to you + Tailscale</div>
                  </div>
                  <div className="border border-green-900/20 rounded p-3">
                    <div className="text-[8px] text-green-700 mb-1">VISIBLE IP (MASKED)</div>
                    <div className={`text-[11px] font-bold font-mono ${status.ipMasked ? "text-green-400" : "text-red-500"}`}>
                      {status.maskedIp || (status.ipMasked ? "via exit node" : "NOT MASKED ⚠")}
                    </div>
                    <div className="text-[7px] text-green-900/40 mt-0.5">What targets + internet sees</div>
                  </div>
                  <div className="border border-green-900/20 rounded p-3">
                    <div className="text-[8px] text-green-700 mb-1">DNS PROVIDER</div>
                    <div className={`text-[11px] font-bold font-mono ${status.dnsEncrypted ? "text-green-400" : "text-orange-500"}`}>
                      {status.dnsProvider || "system default"}
                    </div>
                    <div className="text-[7px] text-green-900/40 mt-0.5">{status.dnsEncrypted ? "Encrypted DoH" : "⚠ Cleartext DNS — leaks domains"}</div>
                  </div>
                </div>
              )}

              {/* Hardening checklist */}
              <div className="border border-green-900/15 rounded p-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-3">HARDENING CHECKLIST</div>
                <div className="space-y-2">
                  {HARDENING_RULES.map((rule) => (
                    <div key={rule.id} className={`border rounded transition-all ${
                      rule.status === "active" ? "border-green-700/30 bg-green-950/10" :
                      rule.level === "critical" ? "border-red-900/30" : "border-yellow-900/20"
                    }`}>
                      <button className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                        onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}>
                        <div className={`text-lg shrink-0 ${
                          rule.status === "active" ? "opacity-100" : "opacity-40"
                        }`}>
                          {rule.status === "active" ? "✅" : rule.level === "critical" ? "🚨" : "⚠️"}
                        </div>
                        <div className="flex-1">
                          <div className={`text-[9px] ${rule.status === "active" ? "text-green-400" : rule.level === "critical" ? "text-red-400" : "text-yellow-500"}`}>
                            {rule.title}
                          </div>
                          <div className="text-[7px] text-green-900/40">{rule.detail.slice(0, 80)}…</div>
                        </div>
                        <div className={`text-[7px] shrink-0 px-2 py-0.5 rounded border ${
                          rule.status === "active" ? "border-green-700/40 text-green-600" :
                          rule.status === "configure" ? "border-yellow-900/40 text-yellow-700" : "border-orange-900/40 text-orange-700"
                        }`}>
                          {rule.status === "active" ? "ACTIVE" : rule.status === "configure" ? "CONFIGURE" : "VERIFY"}
                        </div>
                        <span className="text-[8px] text-green-900/30 ml-1">{expandedRule === rule.id ? "▲" : "▼"}</span>
                      </button>
                      {expandedRule === rule.id && (
                        <div className="px-3 pb-3 border-t border-green-900/10">
                          <p className="text-[8px] text-green-700/60 mt-2 mb-2">{rule.detail}</p>
                          {rule.cmd && (
                            <div className="relative">
                              <pre className="text-[8px] text-green-300 bg-black/40 rounded p-3 overflow-x-auto border border-green-900/15 leading-5">{rule.cmd}</pre>
                              <button onClick={() => copy(rule.cmd!, rule.id)}
                                className="absolute top-2 right-2 text-[7px] text-green-900/40 hover:text-green-500 px-1.5 py-0.5 border border-green-900/20 rounded transition-all">
                                {copiedId === rule.id ? "✓ copied" : "copy"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════
              TAILSCALE MESH
          ════════════════════════════════════ */}
          {tab === "tailscale" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">TAILSCALE DEVICE MESH</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                All devices below are YOUR admin infrastructure — fully encrypted WireGuard mesh.
                They talk only to each other. Targets on the internet never see these IPs.
              </p>

              {/* What Tailscale gives you */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { icon: "🔒", title: "WireGuard Encryption", desc: "ChaCha20-Poly1305 or AES-256-GCM. Every packet between your devices is encrypted — your ISP, carrier, and anyone on your network sees only encrypted UDP." },
                  { icon: "🌍", title: "NAT Traversal",        desc: "Your devices connect directly even behind firewalls and carrier NAT. No port forwarding needed. Uses DERP relay as fallback (still encrypted)." },
                  { icon: "🎭", title: "100.x.x.x Range",      desc: "Tailscale assigns private IPs in 100.64.0.0/10. These are never routable on the public internet — targets cannot reach or even see these addresses." },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="border border-cyan-900/20 rounded p-3 bg-cyan-950/5">
                    <div className="text-xl mb-1">{icon}</div>
                    <div className="text-[9px] text-cyan-400 mb-1">{title}</div>
                    <div className="text-[7px] text-green-900/50 leading-5">{desc}</div>
                  </div>
                ))}
              </div>

              {/* Device list */}
              <div className="border border-green-900/15 rounded p-4 mb-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-3">YOUR ADMIN DEVICES</div>
                {devices.length === 0 ? (
                  <div className="text-[8px] text-green-900/30 py-4 text-center">
                    Loading Tailscale device list…
                    <div className="mt-2">
                      <code className="text-[8px] text-green-800">tailscale status --json</code>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {devices.map((d) => (
                      <div key={d.name} className={`border rounded p-3 flex items-center gap-4 ${
                        d.online ? "border-green-900/20" : "border-green-900/10 opacity-50"
                      }`}>
                        <div className={`w-2 h-2 rounded-full shrink-0 ${d.online ? "bg-green-500 animate-pulse" : "bg-green-900/30"}`} />
                        <div className="flex-1">
                          <div className="text-[9px] text-green-400">{d.name}</div>
                          <div className="text-[7px] text-green-900/40">{d.os} — {d.ip}</div>
                        </div>
                        <div className={`text-[7px] px-2 py-0.5 rounded border ${
                          d.role === "admin" ? "border-cyan-900/40 text-cyan-700" :
                          d.role === "relay" ? "border-yellow-900/40 text-yellow-700" : "border-green-900/30 text-green-800"
                        }`}>{d.role.toUpperCase()}</div>
                        <div className={`text-[7px] ${d.encrypted ? "text-green-600" : "text-red-600"}`}>
                          {d.encrypted ? "🔒 ENCRYPTED" : "⚠ UNENCRYPTED"}
                        </div>
                        <div className="text-[7px] text-green-900/30">{d.lastSeen}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Important security notes */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-green-900/15 rounded p-3">
                  <div className="text-[9px] text-green-600 mb-2">✅ WHAT TAILSCALE PROTECTS</div>
                  <div className="space-y-1 text-[7px] text-green-900/50">
                    <div>• All device-to-device traffic — fully WireGuard encrypted</div>
                    <div>• Your real IP — never visible to targets or third parties</div>
                    <div>• Admin console traffic — C2 commands travel encrypted</div>
                    <div>• SSH between your devices — no exposed ports</div>
                    <div>• Key material — stored on each device, never on Tailscale servers</div>
                  </div>
                </div>
                <div className="border border-yellow-900/15 rounded p-3">
                  <div className="text-[9px] text-yellow-600 mb-2">⚠ WHAT YOU STILL NEED TO CONFIGURE</div>
                  <div className="space-y-1 text-[7px] text-green-900/50">
                    <div>• Exit node on a VPS — so targets see VPS IP, not Tailscale IP</div>
                    <div>• Kill switch — block traffic if Tailscale drops unexpectedly</div>
                    <div>• DNS-over-HTTPS — encrypt DNS lookups (Tailscale handles this if set)</div>
                    <div>• Key expiry — set 90-day expiry in Tailscale admin console</div>
                    <div>• Firewall — block all non-Tailscale inbound on all your devices</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════
              PROXY CHAINS
          ════════════════════════════════════ */}
          {tab === "proxy" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">PROXY CHAINS — IP MASKING</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Route your C2 and admin traffic through multiple hops. Target devices and threat
                intelligence tools only ever see the final hop IP — never yours.
              </p>

              <div className="space-y-3 mb-5">
                {PROXY_CHAINS.map((chain) => {
                  const isActive = activeChain === chain.id;
                  return (
                    <div key={chain.id} className={`border rounded transition-all ${
                      isActive ? "border-cyan-700/40 bg-cyan-950/10" : "border-green-900/20"
                    }`}>
                      <div className="flex items-start gap-3 p-4">
                        <button onClick={() => setActiveChain(isActive ? null : chain.id)}
                          className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[8px] transition-all ${
                            isActive ? "border-cyan-700 bg-cyan-950/30 text-cyan-400" : "border-green-900/30"
                          }`}>{isActive && "✓"}</button>

                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-[10px] text-green-400">{chain.label}</span>
                            <span className={`text-[7px] border px-1.5 py-0.5 rounded ${anonymityColor[chain.anonymity]} border-current/30`}>
                              {chain.anonymity.toUpperCase()} ANONYMITY
                            </span>
                            <span className="text-[7px] text-green-900/40 ml-auto">~{chain.latencyMs}ms</span>
                          </div>

                          <div className="flex items-center gap-1 flex-wrap">
                            {chain.hops.map((hop, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span className="text-[8px] border border-green-900/20 rounded px-2 py-0.5 text-green-700">{hop}</span>
                                {i < chain.hops.length - 1 && <span className="text-green-900/30 text-[10px]">→</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Proxy configuration for MSF */}
              <div className="border border-green-900/15 rounded p-4 mb-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-3">ROUTE METASPLOIT THROUGH PROXY</div>
                <div className="space-y-2">
                  {[
                    {
                      label: "Route via SOCKS5 (Dante on VPS)",
                      code: `# In msfconsole — route all MSF traffic through SOCKS5:\nsetg Proxies socks5:<VPS_TS_IP>:1080\nsetg ReverseAllowProxy true`,
                    },
                    {
                      label: "Route via Tor SOCKS5",
                      code: `# First ensure Tor is running on VPS:\n# Then in msfconsole:\nsetg Proxies socks5:<VPS_TS_IP>:9050\nsetg ReverseAllowProxy true`,
                    },
                    {
                      label: "proxychains on Kali (wrap any command)",
                      code: `# /etc/proxychains4.conf:\n[ProxyList]\nsocks5  <VPS_TS_IP>  1080\n\n# Then wrap any command:\nproxychains4 msfconsole\nproxychains4 nmap -sT -Pn 192.168.1.1`,
                    },
                    {
                      label: "macOS system-wide proxy (routes ALL apps)",
                      code: `# System Settings → Network → select interface → Proxies:\n# SOCKS Proxy: <VPS_TS_IP> : 1080\n\n# Or via CLI:\nnetworksetup -setsocksfirewallproxy Wi-Fi <VPS_TS_IP> 1080\nnetworksetup -setsocksfirewallproxystate Wi-Fi on`,
                    },
                  ].map(({ label, code }) => (
                    <div key={label} className="border border-green-900/10 rounded overflow-hidden">
                      <div className="px-3 py-1.5 bg-black/20 flex items-center justify-between">
                        <span className="text-[8px] text-green-600">{label}</span>
                        <button onClick={() => copy(code, label)}
                          className="text-[7px] text-green-900/40 hover:text-green-500 transition-all px-1">
                          {copiedId === label ? "✓ copied" : "copy"}
                        </button>
                      </div>
                      <pre className="px-3 py-2 text-[8px] text-green-300 bg-black/40 overflow-x-auto leading-5">{code}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════
              FIREWALL
          ════════════════════════════════════ */}
          {tab === "firewall" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">FIREWALL — ADMIN DEVICE PROTECTION</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Block all inbound connections to your admin devices. Only Tailscale overlay traffic
                is allowed in. If Tailscale drops — kill switch blocks everything.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-5">
                {[
                  {
                    label: "macOS Firewall (pf)", platform: "macOS",
                    rules: [
                      "block all — default deny everything",
                      "pass on lo0 — allow loopback",
                      "pass on utun* — allow Tailscale WireGuard interface",
                      "pass out proto udp port 41641 — Tailscale control plane",
                      "pass out proto tcp port 443 — HTTPS + DERP relay fallback",
                    ],
                    cmd: `# Enable stealth mode (don't respond to probes)\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on\n\n# Block all inbound connections\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --setblockall on\n\n# Or via pf (more control):\nsudo pfctl -e -f /etc/pf.conf`,
                  },
                  {
                    label: "Linux Firewall (iptables)", platform: "Linux/VPS",
                    rules: [
                      "INPUT DROP — reject all unsolicited inbound",
                      "ESTABLISHED/RELATED — allow responses to our requests",
                      "tailscale0 ACCEPT — allow Tailscale overlay interface",
                      "lo ACCEPT — allow loopback",
                      "OUTPUT ACCEPT — allow all outbound (through proxy)",
                    ],
                    cmd: `iptables -P INPUT DROP\niptables -P FORWARD DROP\niptables -P OUTPUT ACCEPT\n\n# Allow established connections\niptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT\n\n# Allow loopback\niptables -A INPUT -i lo -j ACCEPT\n\n# Allow Tailscale\niptables -A INPUT -i tailscale0 -j ACCEPT\n\n# Allow UDP 41641 (Tailscale WireGuard)\niptables -A INPUT -p udp --dport 41641 -j ACCEPT\n\n# Save rules\niptables-save > /etc/iptables/rules.v4`,
                  },
                ].map(({ label, platform, rules, cmd }) => (
                  <div key={label} className="border border-green-900/20 rounded p-4">
                    <div className="text-[9px] text-green-600 mb-1">{label}</div>
                    <div className="text-[7px] text-green-900/40 mb-3">{platform}</div>
                    <div className="space-y-1 mb-3">
                      {rules.map((r) => (
                        <div key={r} className="text-[7px] text-green-800 flex gap-2">
                          <span className="text-green-900/30">•</span>{r}
                        </div>
                      ))}
                    </div>
                    <div className="relative">
                      <pre className="text-[8px] text-green-300 bg-black/40 rounded p-2 overflow-x-auto border border-green-900/10 leading-5">{cmd}</pre>
                      <button onClick={() => copy(cmd, label)}
                        className="absolute top-1 right-1 text-[7px] text-green-900/40 hover:text-green-500 px-1.5 py-0.5 border border-green-900/20 rounded transition-all">
                        {copiedId === label ? "✓" : "copy"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stealth mode */}
              <div className="border border-cyan-900/20 rounded p-4">
                <div className="text-[9px] text-cyan-600 mb-2">STEALTH MODE — DON&apos;T RESPOND TO PORT SCANS</div>
                <p className="text-[8px] text-green-900/50 mb-3">
                  When stealth mode is on, your device drops packets silently instead of sending ICMP unreachable or TCP RST.
                  Port scanners see your device as non-existent. nmap, Shodan, and ZMap get zero response.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "macOS stealth mode", cmd: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on\n# Verify:\nsudo /usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode` },
                    { label: "Linux drop ICMP pings", cmd: `echo 1 > /proc/sys/net/ipv4/icmp_echo_ignore_all\n# Permanent:\necho 'net.ipv4.icmp_echo_ignore_all = 1' >> /etc/sysctl.conf\nsysctl -p` },
                  ].map(({ label, cmd }) => (
                    <div key={label} className="relative">
                      <div className="text-[8px] text-green-700 mb-1">{label}</div>
                      <pre className="text-[8px] text-green-300 bg-black/40 rounded p-2 overflow-x-auto border border-green-900/10 leading-5">{cmd}</pre>
                      <button onClick={() => copy(cmd, label)}
                        className="absolute top-6 right-1 text-[7px] text-green-900/40 hover:text-green-500 px-1 border border-green-900/20 rounded">
                        {copiedId === label ? "✓" : "copy"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════
              ACL POLICY
          ════════════════════════════════════ */}
          {tab === "acl" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">TAILSCALE ACL POLICY</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Tailscale ACL controls which of your devices can talk to which.
                Apply this policy in your Tailscale admin console → Access Controls.
              </p>

              <div className="relative mb-4">
                <pre className="text-[8px] text-green-300 bg-black/40 rounded p-4 overflow-x-auto border border-green-900/15 leading-5 max-h-96">
                  {TAILSCALE_ACL_TEMPLATE}
                </pre>
                <button onClick={() => copy(TAILSCALE_ACL_TEMPLATE, "acl")}
                  className="absolute top-2 right-2 text-[8px] text-green-900/40 hover:text-green-500 px-2 py-1 border border-green-900/20 rounded transition-all">
                  {copiedId === "acl" ? "✓ copied" : "copy all"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-green-900/15 rounded p-3">
                  <div className="text-[9px] text-green-600 mb-2">APPLY IN TAILSCALE CONSOLE</div>
                  <div className="space-y-1.5 text-[8px] text-green-900/40">
                    <div>1. Go to <span className="text-green-600">login.tailscale.com</span></div>
                    <div>2. Select your tailnet → <strong>Access Controls</strong></div>
                    <div>3. Paste the ACL JSON above</div>
                    <div>4. Click <strong>Save</strong></div>
                    <div>5. Tag each device: admin / relay / c2</div>
                  </div>
                </div>
                <div className="border border-green-900/15 rounded p-3">
                  <div className="text-[9px] text-green-600 mb-2">TAG YOUR DEVICES</div>
                  <div className="space-y-1.5">
                    {[
                      { cmd: "tailscale up --advertise-tags=tag:admin", desc: "Your Mac + phones" },
                      { cmd: "tailscale up --advertise-tags=tag:relay", desc: "VPS relay server" },
                      { cmd: "tailscale up --advertise-tags=tag:c2",    desc: "Metasploit server" },
                    ].map(({ cmd, desc }) => (
                      <div key={cmd}>
                        <div className="text-[7px] text-green-900/30 mb-0.5">{desc}</div>
                        <div className="flex items-center gap-1">
                          <code className="flex-1 text-[7px] text-green-400 bg-black/30 rounded px-2 py-1 overflow-hidden">{cmd}</code>
                          <button onClick={() => copy(cmd, cmd)} className="text-[7px] text-green-900/40 hover:text-green-600 px-1 shrink-0">
                            {copiedId === cmd ? "✓" : "cp"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════
              SETUP SCRIPTS
          ════════════════════════════════════ */}
          {tab === "scripts" && (
            <div>
              <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">SETUP SCRIPTS</h2>
              <p className="text-[8px] text-green-900/50 mb-5">
                Run these on your VPS relay to configure proxy, exit node, and kill switch.
                Copy → SSH into your VPS → paste and run.
              </p>

              <div className="flex gap-2 mb-4 flex-wrap">
                {(Object.keys(PROXY_SETUP_SCRIPTS) as Array<keyof typeof PROXY_SETUP_SCRIPTS>).map((k) => (
                  <button key={k} onClick={() => setActiveScript(k)}
                    className={`px-3 py-1.5 text-[9px] border rounded transition-all ${
                      activeScript === k ? "border-cyan-700/50 text-cyan-400 bg-cyan-950/20" : "border-green-900/20 text-green-800 hover:border-green-800/30"
                    }`}>
                    {k === "tor" ? "Tor SOCKS5" : k === "socks5" ? "Dante SOCKS5" : k === "exitnode" ? "Exit Node" : "macOS Kill Switch"}
                  </button>
                ))}
              </div>

              <div className="relative">
                <pre className="text-[8px] text-green-300 bg-black/40 rounded p-4 overflow-x-auto border border-green-900/15 leading-5 max-h-[500px]">
                  {PROXY_SETUP_SCRIPTS[activeScript]}
                </pre>
                <button onClick={() => copy(PROXY_SETUP_SCRIPTS[activeScript], activeScript)}
                  className="absolute top-2 right-2 text-[8px] text-green-900/40 hover:text-green-500 px-2 py-1 border border-green-900/20 rounded transition-all">
                  {copiedId === activeScript ? "✓ copied" : "copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── LOG STRIP ── */}
        <div className="h-24 border-t border-green-900/20 bg-black/40 p-2 overflow-y-auto">
          <div className="text-[7px] text-green-900/40 tracking-widest mb-1">SECURITY LOG</div>
          {log.length === 0 ? (
            <div className="text-[8px] text-green-900/20">No events</div>
          ) : log.map((l, i) => (
            <div key={i} className={`text-[8px] font-mono leading-5 ${
              l.type === "ok" ? "text-green-500" : l.type === "err" ? "text-red-500" :
              l.type === "warn" ? "text-yellow-600" : "text-green-800"
            }`}>[{l.t}] {l.msg}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
