import { ModuleBrowser } from "@/components/module-browser";

export default function ModulesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Modules</h1>
        <p className="mt-1 text-sm text-zinc-500">Browse available exploits, payloads, and auxiliary modules</p>
      </div>
      <ModuleBrowser />
    </div>
  );
}
