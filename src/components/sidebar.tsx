"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navItems = [
  {
    label: "OVERVIEW",
    href: "/",
    icon: <GridIcon />,
  },
  {
    section: "OPERATIONS",
  },
  {
    label: "AGENT CONTROL",
    href: "/agents",
    icon: <AgentIcon />,
    badge: "C2",
    badgeColor: "text-red-400 border-red-800/60",
  },
  {
    label: "SESSIONS",
    href: "/sessions",
    icon: <SessionIcon />,
  },
  {
    label: "LISTENERS",
    href: "/listeners",
    icon: <ListenerIcon />,
  },
  {
    label: "CONSOLE",
    href: "/console",
    icon: <ConsoleIcon />,
    badge: "MSF",
    badgeColor: "text-green-400 border-green-800/60",
  },
  {
    section: "INTELLIGENCE",
  },
  {
    label: "NETWORK OPS",
    href: "/network",
    icon: <NetworkIcon />,
    badge: "LAN",
    badgeColor: "text-cyan-400 border-cyan-800/60",
  },
  {
    label: "ALL DEVICES",
    href: "/devices",
    icon: <DevicesIcon />,
    badge: "RT",
    badgeColor: "text-green-400 border-green-800/60",
  },
  {
    label: "LIVE MAP",
    href: "/map",
    icon: <MapIcon />,
    badge: "GPS",
    badgeColor: "text-green-400 border-green-800/60",
  },
  {
    label: "FILE VAULT",
    href: "/vault",
    icon: <VaultIcon />,
  },
  {
    label: "COMMS INTEL",
    href: "/comms",
    icon: <CommsIcon />,
    badge: "SIGINT",
    badgeColor: "text-blue-400 border-blue-800/60",
  },
  {
    label: "SESSION BROWSER",
    href: "/browser",
    icon: <BrowserIcon />,
    badge: "MIRROR",
    badgeColor: "text-sky-400 border-sky-800/60",
  },
  {
    label: "BIOMETRICS",
    href: "/biometrics",
    icon: <BioIcon />,
    badge: "KEY",
    badgeColor: "text-purple-400 border-purple-800/60",
  },
  {
    label: "FINANCE INTEL",
    href: "/finance",
    icon: <FinanceIcon />,
    badge: "FININT",
    badgeColor: "text-yellow-400 border-yellow-800/60",
  },
  {
    section: "TOOLS",
  },
  {
    label: "PAYLOADS",
    href: "/payloads",
    icon: <PayloadIcon />,
  },
  {
    label: "MODULES",
    href: "/modules",
    icon: <ModuleIcon />,
  },
  {
    label: "AV/EDR EVASION",
    href: "/evasion",
    icon: <EvasionIcon />,
    badge: "STEALTH",
    badgeColor: "text-orange-400 border-orange-800/60",
  },
  {
    label: "PAYLOAD EMBED",
    href: "/embed",
    icon: <EmbedIcon />,
    badge: "TROJAN",
    badgeColor: "text-pink-400 border-pink-800/60",
  },
  {
    label: "CRYPTOLOCKER",
    href: "/locker",
    icon: <LockIcon />,
    badge: "AES",
    badgeColor: "text-amber-400 border-amber-800/60",
  },
  {
    section: "SYSTEM",
  },
  {
    label: "TEST LAB",
    href: "/test",
    icon: <TestIcon />,
    badge: "QA",
    badgeColor: "text-teal-400 border-teal-800/60",
  },
  {
    label: "WORKSPACES",
    href: "/workspaces",
    icon: <WorkspaceIcon />,
  },
  {
    label: "SETTINGS",
    href: "/settings",
    icon: <SettingsIcon />,
  },
];

function DevicesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/>
    </svg>
  );
}
function VaultIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}
function ConsoleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function AgentIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function SessionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function ListenerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function PayloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    </svg>
  );
}
function ModuleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" />
    </svg>
  );
}
function WorkspaceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}
function CommsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.15a16 16 0 006.05 6.05l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  );
}
function BioIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
    </svg>
  );
}
function FinanceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  );
}
function NetworkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="6" height="6" rx="1"/><rect x="16" y="2" width="6" height="6" rx="1"/>
      <rect x="9" y="16" width="6" height="6" rx="1"/>
      <path d="M5 8v4h14V8M12 12v4"/>
    </svg>
  );
}
function TestIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
    </svg>
  );
}
function BrowserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="18" rx="2"/>
      <line x1="2" y1="8" x2="22" y2="8"/>
      <circle cx="6" cy="5.5" r="1" fill="currentColor" stroke="none"/>
      <circle cx="10" cy="5.5" r="1" fill="currentColor" stroke="none"/>
      <path d="M6 13h4M6 17h8"/>
    </svg>
  );
}
function EvasionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  );
}
function EmbedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="12" y1="18" x2="12" y2="12"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed left-4 top-3 z-50 flex h-8 w-8 items-center justify-center rounded border border-white/8 bg-[#0a0a0f] text-slate-400 md:hidden"
        aria-label="Menu"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[220px] flex-col border-r border-white/[0.05] bg-[#080810] transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.05] px-5">
          <div className="flex h-6 w-6 items-center justify-center rounded border border-red-900/40 bg-red-950/30">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-200">Utility</p>
            <p className="text-[9px] uppercase tracking-[0.1em] text-slate-600">Command Center</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          {navItems.map((item, i) => {
            if ("section" in item) {
              return (
                <p key={i} className="mt-4 mb-1 px-5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600 first:mt-2">
                  {item.section}
                </p>
              );
            }
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href!}
                onClick={() => setOpen(false)}
                className={`group flex items-center gap-3 px-4 py-2 text-xs transition-all ${
                  isActive
                    ? "bg-red-950/20 text-red-400"
                    : "text-slate-500 hover:bg-white/[0.03] hover:text-slate-300"
                }`}
              >
                <span className={`shrink-0 transition ${isActive ? "text-red-500" : "text-slate-600 group-hover:text-slate-400"}`}>
                  {item.icon}
                </span>
                <span className="flex-1 uppercase tracking-[0.08em]">{item.label}</span>
                {item.badge && (
                  <span className={`rounded border px-1 py-px text-[8px] font-semibold uppercase ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
                {isActive && (
                  <span className="h-4 w-0.5 rounded-full bg-red-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.05] p-4">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 status-pulse" />
            <span className="text-[9px] uppercase tracking-widest text-slate-600">System Online</span>
          </div>
        </div>
      </aside>
    </>
  );
}
