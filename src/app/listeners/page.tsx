import { ListenerPanel } from "@/components/listener-panel";

export default function ListenersPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="border-b border-white/[0.05] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">C2 Infrastructure</p>
        <h1 className="mt-1 text-xl font-bold text-white">Listeners</h1>
        <p className="mt-1 text-[11px] text-slate-600">
          Start multi/handler listeners · choose from payload presets · auto-refreshes every 6 s · click Clone to duplicate config
        </p>
      </div>
      <ListenerPanel />
    </div>
  );
}
