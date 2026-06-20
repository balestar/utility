/**
 * Metasploit RPC client — MessagePack over HTTP POST (MSF v6+)
 *
 * Protocol: POST http(s)://host:port/api/1.0
 *   Content-Type: binary/message-pack
 *   Body:         MessagePack-encoded [method, ...args]
 *   Response:     MessagePack-encoded map
 *
 * MSF RPC response shape:
 *   Success: { "result": "success", <data fields>... }
 *   Error:   { "error": true, "error_class": "...", "error_string": "..." }
 */

import { getMsfConfig } from "./msf-config";
import { msgpackEncode, msgpackDecode } from "./msgpack";

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Send a MessagePack-encoded RPC call via HTTP POST.
 */
async function rawRpcCall(
  method: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>> {
  const config = getMsfConfig();
  const scheme = config.ssl ? "https" : "http";
  const url = `${scheme}://${config.host}:${config.port}/api/1.0`;

  const encoded = msgpackEncode([method, ...args]);
  // Copy into a fresh ArrayBuffer for strict fetch body compatibility
  const body = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "binary/message-pack" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`MSF RPC HTTP ${res.status}: ${res.statusText}`);
  }

  const buf = await res.arrayBuffer();
  const result = msgpackDecode(Buffer.from(buf));

  if (typeof result !== "object" || result === null) {
    throw new Error("MSF RPC response is not a map");
  }

  return result as Record<string, unknown>;
}

/**
 * Authenticated RPC call — auto-acquires and caches the session token.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown[] = [],
  token?: string,
): Promise<T> {
  const args = token ? [token, ...params] : params;
  const response = await rawRpcCall(method, args);

  // Explicit error formats
  if (response.error === true || response.result === "fail") {
    const msg =
      (response.error_string as string) ||
      (response.error_message as string) ||
      (response.error_class as string) ||
      "Unknown MSF RPC error";
    throw new Error(`MSF RPC error: ${msg}`);
  }

  // Some calls (console.read, job.list) don't include result:"success" —
  // they just return the data map directly. Only reject if result is present
  // AND not "success".
  if ("result" in response && response.result !== "success") {
    throw new Error(
      `MSF RPC unexpected result: ${JSON.stringify(response).slice(0, 200)}`,
    );
  }

  // Strip metadata keys; return data as T
  const metaKeys = new Set(["result", "error", "error_class", "error_string", "error_message", "error_code"]);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (!metaKeys.has(key)) data[key] = value;
  }
  return data as unknown as T;
}

/**
 * Authenticate and get a session token — cached for 5 minutes.
 */
export async function getRpcToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const config = getMsfConfig();
  const response = await rawRpcCall("auth.login", [config.user, config.password]);

  if (response.error === true) {
    throw new Error(
      `MSF auth failed: ${response.error_string || response.error_class || "bad credentials"}`,
    );
  }

  const token = response.token as string | undefined;
  if (!token) {
    throw new Error(`MSF auth returned no token. Response: ${JSON.stringify(response).slice(0, 200)}`);
  }

  cachedToken = token;
  tokenExpiry = Date.now() + 5 * 60 * 1000;
  return cachedToken;
}

export function invalidateToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}
