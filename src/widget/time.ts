const HOUR_MS = 3_600_000;
const AGO_LIMIT_MS = 12 * HOUR_MS;
const UNITS = [
  ["hour", HOUR_MS],
  ["minute", 60_000],
] as const;

/** "5 minutes ago" within the last 12 hours, else a short date like "Oct 16, 2:30 PM" (with the year when it isn't this one). */
export function formatTime(iso: string, now = Date.now()) {
  const then = new Date(iso);
  const elapsed = now - then.getTime();
  if (elapsed < AGO_LIMIT_MS) {
    for (const [unit, ms] of UNITS) {
      if (elapsed >= ms) {
        const n = Math.floor(elapsed / ms);
        return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
      }
    }
    return "just now";
  }
  return then.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year:
      then.getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
