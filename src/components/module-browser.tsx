"use client";

import { useEffect, useState } from "react";

type Module = {
  name: string;
  rank?: string;
  description?: string;
  disclosureDate?: string;
};

const tabs = [
  { id: "exploit", label: "Exploits" },
  { id: "payload", label: "Payloads" },
  { id: "auxiliary", label: "Auxiliary" },
] as const;

export function ModuleBrowser() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("exploit");
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/modules?type=${activeTab}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setModules([]);
          return;
        }
        setModules(data.modules ?? []);
      })
      .catch(() => setError("Failed to load modules"))
      .finally(() => setLoading(false));
  }, [activeTab]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Module Browser</h2>
          <p className="text-sm text-zinc-400">Browse Metasploit framework modules</p>
        </div>
        <div className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                activeTab === tab.id
                  ? "bg-red-600 text-white"
                  : "bg-zinc-900 text-zinc-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading modules…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && (
        <div className="space-y-3">
          {modules.map((mod) => (
            <article
              key={mod.name}
              className="rounded-xl border border-zinc-800 bg-black/40 p-4 transition hover:border-zinc-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <code className="text-sm text-red-300">{mod.name}</code>
                {mod.rank && (
                  <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-wide text-zinc-400">
                    {mod.rank}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-zinc-400">{mod.description}</p>
              {mod.disclosureDate && (
                <p className="mt-2 text-xs text-zinc-600">Disclosed {mod.disclosureDate}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
