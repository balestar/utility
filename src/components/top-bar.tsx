"use client";

export function TopBar() {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#06060c] px-5 md:px-6">
      <span className="font-mono text-[9px] uppercase tracking-widest text-slate-700">
        UTILITY · COMMAND CENTER
      </span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
          className="hidden items-center gap-1.5 text-[9px] text-slate-700 transition hover:text-slate-500 md:flex"
        >
          <kbd className="rounded border border-white/[0.06] px-1 py-px text-[8px]">⌘K</kbd>
        </button>
        <span className="h-1 w-1 rounded-full bg-green-500 status-pulse" />
        <span className="text-[9px] uppercase tracking-widest text-slate-700">SECURE</span>
      </div>
    </div>
  );
}
