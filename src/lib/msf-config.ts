export type MsfConfig = {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  password: string;
  demoMode: boolean;
};

export function getMsfConfig(): MsfConfig {
  const explicitDemo = process.env.MSF_DEMO_MODE;
  const host = process.env.MSF_RPC_HOST ?? "127.0.0.1";

  // Auto-enable demo mode when:
  // - MSF_DEMO_MODE=true, or
  // - MSF_RPC_HOST is not set and we're not in Docker (NODE_ENV != production)
  const demoMode =
    explicitDemo === "true" ||
    (explicitDemo === undefined && process.env.NODE_ENV !== "production");

  return {
    host,
    port: Number(process.env.MSF_RPC_PORT ?? "55553"),
    ssl: process.env.MSF_RPC_SSL === "true",
    user: process.env.MSF_RPC_USER ?? "msf",
    password: process.env.MSF_RPC_PASSWORD ?? "changeme",
    demoMode,
  };
}

export function getDashboardApiKey(): string | undefined {
  const key = process.env.DASHBOARD_API_KEY;
  // Empty string = no key
  return key && key.length > 0 ? key : undefined;
}
