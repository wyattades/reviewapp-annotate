import { resolveApiBase } from "./api-base";

// The bundle runs while its <script> is the current script: that's how we find
// the server (see `resolveApiBase`).
const script = document.currentScript as HTMLScriptElement | null;
const resolved = script?.src ? resolveApiBase(script.src, script.dataset.api) : null;
const API_BASE = resolved ?? "";
const SERVER_ORIGIN = API_BASE ? new URL(API_BASE).origin : "";

/** False when there's no telling where the server is (loaded from a CDN without `data-api`). */
export const hasApi = !!resolved;

const TOKEN_KEY = "reviewapp-annotate-token";

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token === null) localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // storage blocked: the widget just asks to sign in again next time
    }
  },
};

/** The widget's one endpoint: GET the state, POST a comment, DELETE `?id=`. */
export const api = (query = "", init: RequestInit = {}) =>
  fetch(`${API_BASE}${query}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${tokenStore.get() ?? ""}`,
    },
  });

/** Opens the server's sign-in popup; it posts the token back (see `listenForToken`). */
export function openSignIn() {
  window.open(
    `${API_BASE}/connect?origin=${encodeURIComponent(location.origin)}`,
    "reviewapp-annotate-signin",
    "width=520,height=720",
  );
}

export function listenForToken(onToken: (token: string) => void) {
  const handler = (event: MessageEvent) => {
    if (event.origin !== SERVER_ORIGIN) return;
    const data = event.data as { type?: string; token?: string } | null;
    if (data?.type !== "reviewapp-annotate-token" || !data.token) return;
    tokenStore.set(data.token);
    onToken(data.token);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/** A JSON request to the widget's endpoint, e.g. `send("PATCH", "?id=abc", { resolved: true })`. */
export const send = (method: string, query: string, body?: object) =>
  api(query, {
    method,
    ...(body && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
