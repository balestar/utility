import { WorkspacePanel } from "@/components/workspace-panel";

export default function WorkspacesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="border-b border-white/[0.05] pb-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Metasploit</p>
        <h1 className="mt-1 text-xl font-bold text-white">Workspaces</h1>
        <p className="mt-1 text-[11px] text-slate-600">
          Isolated engagement environments · create, switch, or delete workspaces
        </p>
      </div>
      <WorkspacePanel />
    </div>
  );
}
