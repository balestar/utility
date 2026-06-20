export type MsfConfig = {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  password: string;
  demoMode: boolean;
};

export function getMsfConfig(): MsfConfig {
  return {
    host: process.env.MSF_RPC_HOST ?? "127.0.0.1",
    port: Number(process.env.MSF_RPC_PORT ?? "55553"),
    ssl: process.env.MSF_RPC_SSL === "true",
    user: process.env.MSF_RPC_USER ?? "msf",
    password: process.env.MSF_RPC_PASSWORD ?? "changeme",
    demoMode: process.env.MSF_DEMO_MODE === "true",
  };
}

export function getDashboardApiKey(): string | undefined {
  return process.env.DASHBOARD_API_KEY;
}
