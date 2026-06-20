import { getMsfConfig } from "./msf-config";
import { getRpcToken, rpcCall } from "./msf-rpc";
import { demoModules, demoSessions, demoVersion, demoWorkspaces } from "./msf-demo";

export type MsfConnectionStatus = {
  connected: boolean;
  demo: boolean;
  version?: string;
  error?: string;
};

export async function getConnectionStatus(): Promise<MsfConnectionStatus> {
  const config = getMsfConfig();

  if (config.demoMode) {
    return { connected: true, demo: true, version: demoVersion.version };
  }

  try {
    const token = await getRpcToken();
    const info = await rpcCall<Record<string, string>>("core.version", [], token);
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

export async function listModules(type: "exploit" | "payload" | "auxiliary") {
  const config = getMsfConfig();

  if (config.demoMode) {
    if (type === "exploit") return demoModules.exploits;
    if (type === "payload") return demoModules.payloads;
    return demoModules.auxiliary;
  }

  const token = await getRpcToken();
  const method =
    type === "exploit"
      ? "module.exploits"
      : type === "payload"
        ? "module.payloads"
        : "module.auxiliary";

  const response = await rpcCall<Record<string, unknown>>(method, [], token);
  // MSF returns modules under the "modules" key
  const moduleCollection = response.modules as Record<string, Record<string, string>> | undefined;
  if (!moduleCollection) return [];

  return Object.entries(moduleCollection).map(([name, info]) => {
    const meta = (info ?? {}) as Record<string, string>;
    return {
      name,
      rank: meta.rank ?? "unknown",
      description: meta.description ?? meta.name ?? name,
      disclosureDate: meta.disclosuredate ?? meta.disclosure_date,
    };
  });
}

export async function listSessions() {
  const config = getMsfConfig();

  if (config.demoMode) return demoSessions;

  const token = await getRpcToken();
  const response = await rpcCall<Record<string, unknown>>("session.list", [], token);

  // MSF returns session IDs as keys, e.g. { "1": { type: "meterpreter", ... } }
  const sessionMap = response as Record<string, Record<string, string>>;

  return Object.entries(sessionMap).map(([id, session]) => ({
    id: Number(id),
    type: session.type ?? "unknown",
    tunnel: session.tunnel_peer ?? session.tunnel_local ?? "—",
    via: session.via_exploit ?? "—",
    info: session.info ?? "—",
    workspace: session.workspace ?? "default",
  }));
}

export async function listWorkspaces() {
  const config = getMsfConfig();

  if (config.demoMode) return demoWorkspaces;

  const token = await getRpcToken();
  const response = await rpcCall<Record<string, unknown>>("workspace.list", [], token);

  // MSF returns workspaces as either a map { name: { created_at: ... } }
  // or an array under a "workspaces" key
  const workspaces = (response.workspaces ?? response) as Record<string, unknown> | unknown[];

  if (Array.isArray(workspaces)) {
    return (workspaces as { name?: string; created_at?: number }[]).map((w) => ({
      name: w.name ?? "unknown",
      created_at: w.created_at,
    }));
  }

  return Object.entries(workspaces).map(([name, meta]) => ({
    name,
    created_at: (meta as Record<string, number>)?.created_at,
  }));
}
