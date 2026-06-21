"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type PaletteItem = {
  id: string;
  label: string;
  sub: string;
  href?: string;
  action?: () => void;
  keys?: string;
};

const ROUTES: PaletteItem[] = [
  { id: "dashboard",  label: "Dashboard",       sub: "Overview & status",                href: "/",          keys: "G D" },
  { id: "agents",     label: "Agent Control",    sub: "C2 — send commands to sessions",  href: "/agents",    keys: "G A" },
  { id: "sessions",   label: "Sessions",         sub: "Active remote sessions",           href: "/sessions",  keys: "G S" },
  { id: "listeners",  label: "Listeners",        sub: "Manage multi/handler listeners",   href: "/listeners", keys: "G L" },
  { id: "console",    label: "MSF Console",      sub: "Interactive Metasploit terminal",  href: "/console",   keys: "G T" },
  { id: "payloads",   label: "Payloads",         sub: "Generate msfvenom payloads",       href: "/payloads",  keys: "G P" },
  { id: "modules",    label: "Module Browser",   sub: "Browse exploits & auxiliary",      href: "/modules",   keys: "G M" },
  { id: "locker",     label: "CryptoLocker",     sub: "AES-256 encryption campaigns",     href: "/locker",    keys: "G C" },
  { id: "devices",    label: "All Devices",       sub: "Real-time device feed (Supabase)",  href: "/devices",   keys: "G V" },
  { id: "map",        label: "Live Map",          sub: "GPS tracker — device locations",    href: "/map",       keys: "G G" },
  { id: "comms",      label: "Comms Intel",       sub: "Calls, SMS, social media SIGINT",   href: "/comms",     keys: "G C" },
  { id: "biometrics", label: "Biometrics",        sub: "Lock screen, passkeys, keystore",   href: "/biometrics",keys: "G B" },
  { id: "finance",    label: "Finance Intel",     sub: "Wallets, banks, OTP, TX hijack",   href: "/finance",   keys: "G W" },
  { id: "vault",      label: "File Vault",        sub: "All captured files across devices", href: "/vault",     keys: "G F" },
  { id: "workspaces", label: "Workspaces",        sub: "Create/switch/delete workspaces",  href: "/workspaces" },
  { id: "settings",   label: "Settings",          sub: "Config, PIN, connection, shortcuts", href: "/settings", keys: "G ," },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = ROUTES.filter(r =>
    !query ||
    r.label.toLowerCase().includes(query.toLowerCase()) ||
    r.sub.toLowerCase().includes(query.toLowerCase())
  );

  const go = useCallback((item: PaletteItem) => {
    setOpen(false);
    setQuery("");
    if (item.href) router.push(item.href);
    else item.action?.();
  }, [router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => { setIdx(0); }, [query]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[idx]) go(filtered[idx]);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/[0.10] bg-[#0b0b14] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Navigate to..."
            className="flex-1 bg-transparent text-[13px] text-slate-200 placeholder-slate-600 focus:outline-none"
          />
          <kbd className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-[11px] text-slate-600">No results</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                i === idx ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex-1">
                <p className="text-[12px] font-medium text-slate-200">{item.label}</p>
                <p className="text-[10px] text-slate-500">{item.sub}</p>
              </div>
              {item.keys && (
                <kbd className="shrink-0 rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">
                  {item.keys}
                </kbd>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-white/[0.04] px-4 py-2">
          <p className="text-[9px] text-slate-700">
            <kbd className="mr-1 rounded border border-white/[0.06] px-1">↑↓</kbd> navigate
            <kbd className="mx-1 rounded border border-white/[0.06] px-1">↵</kbd> select
            <kbd className="ml-1 rounded border border-white/[0.06] px-1">⌘K</kbd> toggle
          </p>
        </div>
      </div>
    </div>
  );
}
