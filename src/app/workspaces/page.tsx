import { WorkspacePanel } from "@/components/workspace-panel";

export default function WorkspacesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Workspaces</h1>
        <p className="mt-1 text-sm text-zinc-500">Isolated engagement workspaces</p>
      </div>
      <WorkspacePanel />
    </div>
  );
}
