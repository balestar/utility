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
    const version = await rpcCall<{ version: string }>("core.version", [], token);
    return { connected: true, demo: false, version: version.version };
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

  const modules = await rpcCall<Record<string, unknown>>(method, [], token);

  return Object.entries(modules).map(([name, info]) => {
    const meta = (info ?? {}) as Record<string, string>;
    return {
      name,
      rank: meta.rank ?? "unknown",
      description: meta.description ?? meta.name ?? name,
      disclosureDate: meta.disclosuredate,
    };
  });
}

export async function listSessions() {
  const config = getMsfConfig();

  if (config.demoMode) return demoSessions;

  const token = await getRpcToken();
  const sessions = await rpcCall<Record<string, Record<string, string>>>(
    "session.list",
    [],
    token,
  );

  return Object.entries(sessions).map(([id, session]) => ({
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
  const workspaces = await rpcCall<Record<string, { created_at?: number }>>(
    "workspace.list",
    [],
    token,
  );

  return Object.entries(workspaces).map(([name, meta]) => ({
    name,
    created_at: meta.created_at,
  }));
}
