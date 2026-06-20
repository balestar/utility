/**
 * Metasploit RPC client using MessagePack protocol over raw TCP.
 *
 * MSFRPCD listens on port 55553 by default.
 * Protocol: send a MessagePack-encoded array [method, ...args],
 *            receive a MessagePack-encoded map/dict back.
 *
 * MSF RPC response shape:
 *   Success: { "result": "success", <data fields>... }
 *   Error:   { "error": true, "error_class": "...", "error_string": "..." }
 *            or { "result": "fail", "error_message": "..." }
 *
 * All calls happen server-side via Node.js net module.
 */

import { getMsfConfig } from "./msf-config";
import * as net from "net";
import { msgpackEncode, msgpackDecode } from "./msgpack";

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Sends a MessagePack RPC call over TCP to the Metasploit RPC server.
 * Returns the raw decoded response (a map object).
 */
async function rawRpcCall(
  method: string,
  args: unknown[] = [],
): Promise<Record<string, unknown>> {
  const config = getMsfConfig();

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      settled = true;
      socket.destroy();
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error("RPC socket timeout after 15s"));
      }
    }, 15000);

    socket.connect(config.port, config.host, () => {
      const payload = msgpackEncode([method, ...args]);
      socket.write(payload);
    });

    socket.on("data", (data) => {
      chunks.push(data);
    });

    socket.on("end", () => {
      clearTimeout(timeout);
      if (settled) return;

      try {
        const fullBuf = Buffer.concat(chunks);
        if (fullBuf.length === 0) {
          cleanup();
          reject(new Error("Empty RPC response"));
          return;
        }
        const result = msgpackDecode(fullBuf);
        if (typeof result !== "object" || result === null) {
          cleanup();
          reject(new Error("RPC response is not a map"));
          return;
        }
        cleanup();
        resolve(result as Record<string, unknown>);
      } catch (err) {
        cleanup();
        reject(
          new Error(
            `Failed to decode RPC response: ${err instanceof Error ? err.message : "unknown"}`,
          ),
        );
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      if (!settled) {
        cleanup();
        reject(new Error(`RPC socket error: ${err.message}`));
      }
    });
  });
}

/**
 * Authenticated RPC call. Automatically acquires and manages the API token.
 *
 * MSF RPC returns: { "result": "success", <actual data keys>... }
 * or error:        { "error": true, "error_class": "...", "error_string": "..." }
 *
 * This strips the metadata fields and returns the rest as the result.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown[] = [],
  token?: string,
): Promise<T> {
  const args = token ? [token, ...params] : params;
  const response = await rawRpcCall(method, args);

  // Check for errors in various MSF error formats
  if (response.error === true || response.result === "fail") {
    const msg =
      (response.error_string as string) ||
      (response.error_message as string) ||
      (response.error_class as string) ||
      "Unknown MSF RPC error";
    const code = (response.error_code as number) ?? -1;
    throw new Error(`MSF RPC error [${code}]: ${msg}`);
  }

  if (response.result !== "success") {
    // Result might be something else unexpected
    throw new Error(
      `MSF RPC unexpected result: ${JSON.stringify(response).slice(0, 200)}`,
    );
  }

  // Strip metadata fields; return everything else as T
  const metaKeys = new Set(["result", "error", "error_class", "error_string", "error_message", "error_code"]);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (!metaKeys.has(key)) {
      data[key] = value;
    }
  }

  return data as unknown as T;
}

/**
 * Authenticate and get a session token. Cached for 5 minutes.
 *
 * MSF auth.login response:
 *   { "result": "success", "token": "abc123" }
 */
export async function getRpcToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const config = getMsfConfig();

  const response = await rawRpcCall("auth.login", [
    config.user,
    config.password,
  ]);

  // Check for authentication errors
  if (response.error === true) {
    throw new Error(
      `MSF auth error: ${response.error_string || response.error_class || "authentication failed"}`,
    );
  }

  const token = response.token as string | undefined;
  if (!token) {
    throw new Error(
      `MSF auth returned no token. Response: ${JSON.stringify(response).slice(0, 200)}`,
    );
  }

  cachedToken = token;
  tokenExpiry = Date.now() + 5 * 60 * 1000;
  return cachedToken;
}

/**
 * Force re-auth on next call.
 */
export function invalidateToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}
