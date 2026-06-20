import { SessionPanel } from "@/components/session-panel";

export default function SessionsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Sessions</h1>
        <p className="mt-1 text-sm text-zinc-500">Active remote sessions and their metadata</p>
      </div>
      <SessionPanel />
    </div>
  );
}
