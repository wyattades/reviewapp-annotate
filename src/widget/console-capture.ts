export type ConsoleEntry = { level: string; time: number; message: string };

const MAX_ENTRIES = 100;
const MAX_MESSAGE_CHARS = 1500;
const LEVELS = ["log", "info", "warn", "error", "debug"] as const;

const entries: ConsoleEntry[] = [];

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error)
    return value.stack || `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function record(level: string, args: unknown[]) {
  const message = args.map(stringify).join(" ").slice(0, MAX_MESSAGE_CHARS);
  entries.push({ level, time: Math.round(performance.now()), message });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** Keeps the page's last console output and uncaught errors for the next comment. */
export function startConsoleCapture() {
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (event) => {
    record("error", [event.error ?? event.message]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    record("error", ["Unhandled rejection:", event.reason]);
  });
}

export const getConsoleEntries = () => entries.slice();
