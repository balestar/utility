import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/* ─────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────── */
type TailscaleDevice = {
  name: string; ip: string; os: string; lastSeen: string;
  online: boolean; encrypted: boolean; keyExpiry: string; role: "admin" | "relay" | "c2";
};

type SecurityStatus = {
  tailscaleUp: boolean; dnsEncrypted: boolean; killSwitchOn: boolean;
  ipMasked: boolean; proxyActive: boolean; leakTest: "clean" | "leak" | "unknown";
  realIp: string; maskedIp: string; dnsProvider: string;
};

/* ─────────────────────────────────────────────────────────
   TAILSCALE STATUS
───────────────────────────────────────────────────────── */
async function getTailscaleStatus(): Promise<{
  up: boolean; ip: string; exitNodeActive: boolean; devices: TailscaleDevice[];
}> {
  try {
    const { stdout } = await execAsync("tailscale status --json 2>/dev/null", { timeout: 5000 });
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const self = data.Self as Record<string, unknown> | undefined;
    const peers = data.Peer as Record<string, Record<string, unknown>> | undefined;

    const devices: TailscaleDevice[] = [];

    // Add self
    if (self) {
      const addrs = (self.TailscaleIPs as string[]) ?? [];
      devices.push({
        name: String(self.HostName ?? "this-device"),
        ip: addrs[0] ?? "100.x.x.x",
        os: String(self.OS ?? "unknown"),
        lastSeen: "now",
        online: true,
        encrypted: true,
        keyExpiry: String(self.KeyExpiry ?? "unknown"),
        role: "admin",
      });
    }

    // Add peers
    if (peers) {
      for (const [, peer] of Object.entries(peers)) {
        const addrs = (peer.TailscaleIPs as string[]) ?? [];
        const hostname = String(peer.HostName ?? "unknown");
        const role: "admin" | "relay" | "c2" =
          hostname.includes("vps") || hostname.includes("relay") ? "relay" :
          hostname.includes("msf") || hostname.includes("c2")   ? "c2" : "admin";

        devices.push({
          name: hostname,
          ip: addrs[0] ?? "100.x.x.x",
          os: String(peer.OS ?? "unknown"),
          lastSeen: peer.LastSeen === "0001-01-01T00:00:00Z" ? "just now" : "recently",
          online: Boolean(peer.Online),
          encrypted: true,
          keyExpiry: String(peer.KeyExpiry ?? "unknown"),
          role,
        });
      }
    }

    const selfIps = (self?.TailscaleIPs as string[]) ?? [];
    const exitNodeActive = Boolean(data.ExitNodeStatus);

    return {
      up: Boolean(self),
      ip: selfIps[0] ?? "",
      exitNodeActive,
      devices,
    };
  } catch {
    return { up: false, ip: "", exitNodeActive: false, devices: [] };
  }
}

/* ─────────────────────────────────────────────────────────
   IP DETECTION
───────────────────────────────────────────────────────── */
async function detectPublicIp(): Promise<string> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
    const d = await r.json() as { ip: string };
    return d.ip;
  } catch {
    return "unable to detect";
  }
}

/* ─────────────────────────────────────────────────────────
   DNS PROBE
───────────────────────────────────────────────────────── */
async function checkDns(): Promise<{ encrypted: boolean; provider: string }> {
  try {
    // Try DoH probe — if we can reach Cloudflare DoH and get a valid response it's encrypted
    const r = await fetch("https://1.1.1.1/dns-query?name=example.com&type=A", {
      headers: { "Accept": "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) return { encrypted: true, provider: "Cloudflare 1.1.1.1 DoH" };
    return { encrypted: false, provider: "unknown" };
  } catch {
    return { encrypted: false, provider: "system default (cleartext)" };
  }
}

/* ─────────────────────────────────────────────────────────
   GET — /api/admin-security?action=status
───────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "status";

  if (action === "status") {
    const [ts, publicIp, dns] = await Promise.all([
      getTailscaleStatus(),
      detectPublicIp(),
      checkDns(),
    ]);

    const exitNodeActive = ts.exitNodeActive;

    const status: SecurityStatus = {
      tailscaleUp: ts.up,
      dnsEncrypted: dns.encrypted,
      killSwitchOn: false, // would need pf/iptables check — N/A server-side
      ipMasked: exitNodeActive,
      proxyActive: false,
      leakTest: "unknown",
      realIp: ts.ip || publicIp,
      maskedIp: exitNodeActive ? "(via exit node)" : publicIp,
      dnsProvider: dns.provider,
    };

    return NextResponse.json({ ok: true, status, devices: ts.devices });
  }

  return NextResponse.json({ ok: false, error: "unknown action" });
}

/* ─────────────────────────────────────────────────────────
   POST — /api/admin-security
───────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const action = String(body.action ?? "");

  /* ── IP Leak Test ──────────────────────────────────────── */
  if (action === "run_leak_test") {
    const results: Record<string, unknown> = {};

    // WebRTC leak would be browser-side — log instructions
    results.webrtc_note = "Check browser WebRTC leak: https://browserleaks.com/webrtc";

    // DNS leak check via api
    try {
      const r = await fetch("https://www.dnsleaktest.com/test?extended=1", {
        signal: AbortSignal.timeout(6000),
      });
      results.dns_reachable = r.ok;
    } catch {
      results.dns_reachable = false;
    }

    // Check if Tailscale exit node active
    const ts = await getTailscaleStatus();
    results.tailscale_up = ts.up;
    results.exit_node_active = ts.exitNodeActive;
    results.public_ip = await detectPublicIp();
    results.tailscale_ip = ts.ip;

    const hasLeak =
      !ts.up ||
      (!ts.exitNodeActive && results.public_ip !== ts.ip && results.public_ip !== "unable to detect");

    return NextResponse.json({
      ok: true,
      leak: hasLeak ? "potential" : "clean",
      results,
      recommendations: hasLeak
        ? [
            ts.exitNodeActive ? null : "Set up a Tailscale exit node on your VPS — your real IP is exposed.",
            !ts.up ? "Tailscale is NOT running — all traffic is unprotected." : null,
          ].filter(Boolean)
        : ["No obvious IP leak detected. Enable WebRTC leak test in browser for full verification."],
    });
  }

  /* ── Refresh Status ─────────────────────────────────────── */
  if (action === "refresh_status") {
    const [ts, publicIp, dns] = await Promise.all([
      getTailscaleStatus(),
      detectPublicIp(),
      checkDns(),
    ]);

    return NextResponse.json({
      ok: true,
      status: {
        tailscaleUp: ts.up,
        dnsEncrypted: dns.encrypted,
        killSwitchOn: false,
        ipMasked: ts.exitNodeActive,
        proxyActive: false,
        leakTest: "unknown",
        realIp: ts.ip || publicIp,
        maskedIp: ts.exitNodeActive ? "(via exit node)" : publicIp,
        dnsProvider: dns.provider,
      },
      devices: ts.devices,
    });
  }

  /* ── Apply Tailscale Exit Node (instructions) ─────────────── */
  if (action === "set_exit_node") {
    const nodeIp = String(body.node_ip ?? "");
    if (!nodeIp) return NextResponse.json({ ok: false, error: "node_ip required" });

    return NextResponse.json({
      ok: true,
      steps: [
        { on: "VPS (exit node)", cmd: `tailscale up --advertise-exit-node --accept-routes\necho 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf && sysctl -p` },
        { on: "Your Mac/device", cmd: `tailscale set --exit-node=${nodeIp}\ntailscale set --exit-node-allow-lan-access=false` },
        { on: "Verify",         cmd: `curl https://api.ipify.org\n# Should show VPS IP, not your real IP` },
      ],
    });
  }

  /* ── Apply DNS over HTTPS ─────────────────────────────────── */
  if (action === "apply_doh") {
    return NextResponse.json({
      ok: true,
      steps: [
        {
          platform: "Tailscale (applies to all your devices)",
          cmd: `# In Tailscale admin console → DNS:\n# Enable MagicDNS\n# Set nameservers: 1.1.1.1, 9.9.9.9\n# Ensure "Override local DNS" is ON`,
        },
        {
          platform: "macOS (system-level DoH)",
          cmd: `# Install dnscrypt-proxy:\nbrew install dnscrypt-proxy\n\n# Edit /usr/local/etc/dnscrypt-proxy/dnscrypt-proxy.toml:\n# server_names = ['cloudflare', 'cloudflare-ipv6']\n\nbrew services start dnscrypt-proxy\n\n# Set DNS to 127.0.0.1:\nnetworksetup -setdnsservers Wi-Fi 127.0.0.1`,
        },
        {
          platform: "Android (system-level DoT)",
          cmd: `# Settings → Network & Internet → Private DNS\n# Set hostname: one.one.one.one\n# (Cloudflare DNS-over-TLS)`,
        },
      ],
    });
  }

  /* ── Generate Kill Switch instructions ──────────────────── */
  if (action === "kill_switch_config") {
    const platform = String(body.platform ?? "macos");
    const scripts: Record<string, string> = {
      macos: `#!/bin/bash
# macOS Tailscale Kill Switch
# Drop all traffic if Tailscale interface disappears

cat > /etc/pf-ts-killswitch.conf <<'EOF'
block all
pass on lo0
pass on utun0
pass on utun1
pass on utun2
pass on utun3
pass out proto udp to any port 41641
pass out proto tcp to any port 443
EOF

sudo pfctl -e -f /etc/pf-ts-killswitch.conf
echo "Kill switch active"`,

      linux: `#!/bin/bash
# Linux iptables Kill Switch — block all if Tailscale drops
iptables -P INPUT  DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP

iptables -A INPUT  -i lo          -j ACCEPT
iptables -A OUTPUT -o lo          -j ACCEPT
iptables -A INPUT  -i tailscale0  -j ACCEPT
iptables -A OUTPUT -o tailscale0  -j ACCEPT

# Allow Tailscale control plane
iptables -A OUTPUT -p udp --dport 41641 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443   -j ACCEPT

# Allow established connections
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

iptables-save > /etc/iptables/rules.v4
echo "Kill switch configured"`,
    };

    return NextResponse.json({
      ok: true,
      script: scripts[platform] ?? scripts.macos,
      note: "Save this script and run on your admin device. All traffic blocked if Tailscale drops — your real IP is never exposed.",
    });
  }

  /* ── Generate Proxy Config ───────────────────────────────── */
  if (action === "proxy_config") {
    const type = String(body.proxy_type ?? "socks5");
    const vpsIp = String(body.vps_ts_ip ?? "<VPS_TAILSCALE_IP>");

    const configs: Record<string, unknown> = {
      socks5: {
        label: "SOCKS5 via Tailscale VPS",
        macConfig: { host: vpsIp, port: 1080, type: "SOCKS5" },
        msfConfig: `setg Proxies socks5:${vpsIp}:1080`,
        browserConfig: `Firefox → Settings → Network → Manual proxy: SOCKS5 ${vpsIp}:1080`,
      },
      tor: {
        label: "Tor via Tailscale VPS",
        macConfig: { host: vpsIp, port: 9050, type: "SOCKS5" },
        msfConfig: `setg Proxies socks5:${vpsIp}:9050`,
        browserConfig: `Tor Browser recommended, or: Firefox proxy SOCKS5 ${vpsIp}:9050`,
      },
    };

    return NextResponse.json({ ok: true, ...(configs[type] ?? configs.socks5) });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` });
}
