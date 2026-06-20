import { SessionPanel } from "@/components/session-panel";

export default function SessionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="border-b border-white/[0.05] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Remote Access</p>
        <h1 className="mt-1 text-xl font-bold text-white">Active Sessions</h1>
        <p className="mt-1 text-[11px] text-slate-600">
          Live Meterpreter &amp; shell sessions · auto-refreshes every 8 s · click a session to expand &amp; control
        </p>
      </div>
      <SessionPanel />
    </div>
  );
}
