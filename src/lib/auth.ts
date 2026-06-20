import { getDashboardApiKey } from "./msf-config";

export function isAuthorized(request: Request): boolean {
  const apiKey = getDashboardApiKey();

  if (!apiKey) {
    return process.env.NODE_ENV !== "production";
  }

  const headerKey = request.headers.get("x-api-key");
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  return headerKey === apiKey || bearerKey === apiKey;
}
