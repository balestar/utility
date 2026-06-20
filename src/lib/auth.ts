import { getDashboardApiKey } from "./msf-config";

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), v.join("=").trim()];
    })
  );
}

export function isAuthorized(request: Request): boolean {
  const apiKey = getDashboardApiKey();

  // No API key configured → allow in dev, deny in prod
  if (!apiKey) {
    return process.env.NODE_ENV !== "production";
  }

  // 1. Header-based auth (API clients, Caddy proxy)
  const headerKey = request.headers.get("x-api-key");
  if (headerKey === apiKey) return true;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerKey = authHeader.slice(7);
    if (bearerKey === apiKey) return true;
  }

  // 2. Cookie-based auth (Samsung/mobile browsers via PWA)
  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies["utility_key"] === apiKey) return true;

  return false;
}
