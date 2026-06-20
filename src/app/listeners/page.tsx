import { ListenerPanel } from "@/components/listener-panel";

export default function ListenersPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Listeners</h1>
        <p className="mt-1 text-sm text-zinc-500">Manage active listeners for incoming connections</p>
      </div>
      <ListenerPanel />
    </div>
  );
}
