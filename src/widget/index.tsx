import { render } from "preact";
import { hasApi } from "./api";
import { App, NAVIGATE_EVENT } from "./app";
import { startConsoleCapture } from "./console-capture";

// Start before anything else so the page's own startup logs are kept.
startConsoleCapture();

// Single-page apps change the URL without loading a page: tell the app when they do.
for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = (...args: Parameters<History["pushState"]>) => {
    original(...args);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  };
}

function boot() {
  if (!hasApi) {
    console.error(
      '[reviewapp-annotate] Loaded from a CDN: say where your server is with data-api="https://your-app.example.com/api/reviewapp-annotate" on the script tag.',
    );
    return;
  }

  // a shadow root keeps the page's CSS out of the widget, and ours out of the page
  const host = document.createElement("div");
  host.setAttribute("data-reviewapp-annotate-widget", "");
  const root = host.attachShadow({ mode: "closed" });

  // on <html>, not <body>: single-page apps replace the body's contents
  document.documentElement.append(host);
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host);
  }).observe(document.documentElement, { childList: true });

  render(<App host={host} />, root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
