/**
 * A review app's origin, normalized (`https://host`), or null when it isn't an
 * https origin. Whether it's really a review app is for the PR finder to
 * say: its hostname has to be named in a provider's comment on a PR.
 */
export function normalizeOrigin(
  origin: string | null | undefined,
): { origin: string; hostname: string } | null {
  if (!origin) return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || !url.hostname.includes(".")) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  return { origin: `https://${hostname}`, hostname };
}
