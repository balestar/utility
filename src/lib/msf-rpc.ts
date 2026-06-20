/**
 * Metasploit RPC client using MessagePack protocol over raw TCP.
 *
 * MSFRPCD listens on port 55553 by default.
 * Protocol: send a MessagePack-encoded array [method, ...args],
 *            receive a MessagePack-encoded map/dict back.
 *
 * All calls happen server-side via Node.js net module (no fetch/HTTP).
 */

import { getMsfConfig } from "./msf-config";
import * as net from "net";
import { msgpackEncode, msgpackDecode } from "./msgpack";

// Token cache (module-level, lasts 5 minutes)
let cachedToken: string | null = null;
let tokenExpiry = 0;

type MsfRpcResponse = {
  result?: unknown;
  error?: { message: string; code?: number };
};

/**
 * Sends a MessagePack RPC call over TCP to the Metasploit RPC server.
 */
async function rawRpcCall(
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  const config = getMsfConfig();

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let timeout: ReturnType<typeof setTimeout>;
    const chunks: Buffer[] = [];

    const cleanup = () => {
      clearTimeout(timeout);
      socket.destroy();
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("RPC socket timeout"));
    }, 15000);

    socket.connect(config.port, config.host, () => {
      // Build MessagePack array: [method, ...args]
      const payload = msgpackEncode([method, ...args]);
      socket.write(payload);
    });

    socket.on("data", (data) => {
      chunks.push(data);
    });

    socket.on("end", () => {
      clearTimeout(timeout);

      try {
        const fullBuf = Buffer.concat(chunks);
        const result = msgpackDecode(fullBuf);
        socket.destroy();
        resolve(result);
      } catch (err) {
        socket.destroy();
        reject(
          new Error(
            `Failed to decode RPC response: ${err instanceof Error ? err.message : "unknown"}`,
          ),
        );
      }
    });

    socket.on("error", (err) => {
      cleanup();
      reject(new Error(`RPC socket error: ${err.message}`));
    });
  });
}

/**
 * Authenticated RPC call. Automatically acquires and manages the API token.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown[] = [],
  token?: string,
): Promise<T> {
  const config = getMsfConfig();

  // If we have a token, prepend it to params per MSF convention:
  //   [method, token, ...args]
  const args = token ? [token, ...params] : params;

  const raw = await rawRpcCall(method, args);
  const response = raw as MsfRpcResponse;

  if (response.error) {
    throw new Error(
      `MSF RPC error [${response.error.code ?? "?"}]: ${response.error.message}`,
    );
  }

  // MSF returns the result directly as an object
  return response.result as T;
}

/**
 * Authenticate and get a session token. Cached for 5 minutes.
 */
export async function getRpcToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const config = getMsfConfig();

  // auth.login returns a map with a "token" key, e.g. { "token": "abc123" }
  const result = await rawRpcCall("auth.login", [
    config.user,
    config.password,
  ]);

  const res = result as MsfRpcResponse;
  if (res.error) {
    throw new Error(
      `MSF auth error: ${res.error.message}`,
    );
  }

  const token = (res.result as Record<string, string>)?.token;
  if (!token) {
    throw new Error("MSF auth returned no token");
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
