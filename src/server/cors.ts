import { normalizeOrigin } from "./origin";

/**
 * CORS for the widget's calls from a review app, which can be on any domain.
 * It's safe to answer any https origin: nothing here uses cookies, and what
 * the widget sends is a bearer token that only works for the one review app
 * it was issued to.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin.origin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
