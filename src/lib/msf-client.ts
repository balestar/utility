import { getRpcToken, rpcCall } from "./msf-rpc";
import { getMsfConfig } from "./msf-config";
import { demoVersion } from "./msf-demo";

export type MsfConnectionStatus = {
  connected: boolean;
  demo: boolean;
  version?: string;
  error?: string;
};

export async function getConnectionStatus(): Promise<MsfConnectionStatus> {
  const { demoMode } = getMsfConfig();
  if (demoMode) {
    return { connected: true, demo: true, version: demoVersion.version };
  }
  try {
    const token = await getRpcToken();
    const info = await rpcCall<{ version?: string; api?: string }>("core.version", [], token);
    return {
      connected: true,
      demo: false,
      version: info.version ?? info.api ?? "unknown",
    };
  } catch (error) {
    return {
      connected: false,
      demo: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * MSF RPC v6 returns module lists as flat arrays of module-path strings:
 *   module.exploits  → { "modules": ["exploit/windows/smb/ms17_010_eternalblue", ...] }
 *   module.payloads  → { "modules": ["windows/x64/meterpreter/reverse_tcp", ...] }
 *   module.auxiliary → { "modules": ["auxiliary/scanner/portscan/tcp", ...] }
 */
export async function listModules(
  type: "exploit" | "payload" | "auxiliary" | "post" | "encoder" | "nop",
) {
  const methodMap: Record<string, string> = {
    exploit:   "module.exploits",
    payload:   "module.payloads",
    auxiliary: "module.auxiliary",
    post:      "module.post",
    encoder:   "module.encoders",
    nop:       "module.nops",
  };

  const token = await getRpcToken();
  const response = await rpcCall<{ modules?: unknown }>(methodMap[type] ?? "module.exploits", [], token);

  const raw = response.modules;
  if (!raw) return [];

  // MSF v6 returns an array of module-path strings
  if (Array.isArray(raw)) {
    return (raw as string[]).map((name) => ({ name, rank: "normal", description: name }));
  }

  // Older format: map of name → info object
  return Object.entries(raw as Record<string, Record<string, string>>).map(([name, info]) => ({
    name,
    rank: info?.rank ?? "unknown",
    description: info?.description ?? info?.name ?? name,
  }));
}

/**
 * Get detailed info about a specific module.
 */
export async function getModuleInfo(type: string, moduleName: string) {
  const token = await getRpcToken();
  try {
    const info = await rpcCall<Record<string, unknown>>("module.info", [type, moduleName], token);
    return info;
  } catch {
    return null;
  }
}

/**
 * MSF session.list returns a map of session ID → session info object:
 *   { "1": { "type": "meterpreter", "tunnel_peer": "...", ... } }
 * Empty = {}
 */
export async function listSessions() {
  const token = await getRpcToken();
  const response = await rpcCall<Record<string, Record<string, string>>>("session.list", [], token);

  if (!response || Object.keys(response).length === 0) return [];

  return Object.entries(response).map(([id, session]) => ({
    id: Number(id),
    type:      session.type ?? "unknown",
    tunnel:    session.tunnel_peer ?? session.tunnel_local ?? "—",
    via:       session.via_exploit ?? "—",
    info:      session.info ?? "—",
    workspace: session.workspace ?? "default",
    platform:  session.platform ?? "unknown",
    arch:      session.arch ?? "unknown",
    username:  session.username ?? session.info?.split(" ")?.[0] ?? "—",
    remoteHost: session.tunnel_peer?.split(":")?.[0] ?? "—",
  }));
}

/**
 * MSF db.workspaces returns:
 *   { "workspaces": [{ "id": 1, "name": "default", "created_at": ..., ... }, ...] }
 */
export async function listWorkspaces() {
  const token = await getRpcToken();
  try {
    const response = await rpcCall<{ workspaces?: unknown }>("db.workspaces", [], token);
    const ws = response.workspaces;

    if (Array.isArray(ws)) {
      return (ws as { name?: string; created_at?: number }[]).map((w) => ({
        name: w.name ?? "unknown",
        created_at: w.created_at,
      }));
    }

    if (ws && typeof ws === "object") {
      return Object.entries(ws as Record<string, unknown>).map(([name, meta]) => ({
        name,
        created_at: (meta as Record<string, number>)?.created_at,
      }));
    }

    return [{ name: "default", created_at: undefined }];
  } catch {
    return [{ name: "default", created_at: undefined }];
  }
}

/**
 * Get current active workspace.
 */
export async function getCurrentWorkspace(): Promise<string> {
  try {
    const token = await getRpcToken();
    const response = await rpcCall<{ workspace?: string }>("db.current_workspace", [], token);
    return response.workspace ?? "default";
  } catch {
    return "default";
  }
}

/**
 * Run a search across MSF modules.
 * Returns matching module paths.
 */
export async function searchModules(keyword: string): Promise<string[]> {
  const token = await getRpcToken();
  try {
    const response = await rpcCall<{ modules?: unknown }>("module.search", [keyword], token);
    const raw = response.modules;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    return Object.keys(raw as object);
  } catch {
    return [];
  }
}
