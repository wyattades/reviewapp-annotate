/**
 * The image proxy behind the widget's screenshots. A page can't read the
 * pixels of an image from another site unless that site sends CORS headers,
 * so the screenshot would show a blank there; the server fetches it instead.
 *
 * It fetches any public URL a signed-in reviewer asks for, so it guards what
 * it can: http(s) only, no hosts that are obviously private (localhost, private
 * and link-local IPs, `.internal`), each redirect checked the same way, images
 * only, a size cap and a timeout. It can't see where a public hostname resolves
 * to; turn it off with `imageProxy: false` if your server can reach things
 * that shouldn't be fetched.
 */

/** The largest image it passes on. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** An http(s) URL to a host that isn't obviously private; null otherwise. */
export function publicUrl(raw: string | null): URL | null {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // URL has already turned 0x7f.1, 2130706433 and the like into dotted IPv4
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    (!host.includes(".") && !host.includes(":")) || // "localhost", "intranet"
    /(^|\.)(localhost|local|internal|home|lan|corp)$/.test(host)
  ) {
    return null;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return privateIPv4(Number(v4[1]), Number(v4[2])) ? null : url;
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, unique-local, link-local, and IPv4 inside IPv6
    if (
      host === "::1" ||
      host === "::" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("::ffff:") ||
      host.startsWith("64:ff9b:")
    ) {
      return null;
    }
  }
  return url;
}

function privateIPv4(a: number, b: number) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, and cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export type ProxiedImage = {
  /** The body, passed through as it arrives; it errors once it passes `MAX_IMAGE_BYTES`. */
  body: ReadableStream<Uint8Array>;
  contentType: string;
  /** From the image's own content-length, when it sent one. */
  length: number | null;
};

/**
 * The image at `url`, following up to 3 redirects (each checked like the
 * first); null when it isn't a public URL, isn't an image, says it's too big,
 * or doesn't answer in time.
 */
export async function fetchImage(
  url: URL,
  fetcher: typeof fetch = fetch,
): Promise<ProxiedImage | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetcher(current, {
      redirect: "manual",
      signal,
      headers: { accept: "image/*" },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const next = publicUrl(
        new URL(response.headers.get("location") ?? "", current).href,
      );
      if (!next) return null;
      current = next;
      continue;
    }
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim();
    const length = Number(response.headers.get("content-length") ?? NaN);
    if (
      !response.ok ||
      !response.body ||
      // never something a browser would run: no SVG (it can hold scripts), no HTML
      !/^image\/(?!svg)[a-z0-9.+-]+$/i.test(contentType) ||
      length > MAX_IMAGE_BYTES
    ) {
      await response.body?.cancel();
      return null;
    }
    return {
      body: response.body.pipeThrough(capped(MAX_IMAGE_BYTES)),
      contentType,
      length: Number.isFinite(length) ? length : null,
    };
  }
  return null;
}

/** Passes bytes through until more than `max` have gone by, then errors (a missing or wrong content-length can't make it pass more). */
function capped(max: number) {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > max) controller.error(new Error("Image too big"));
      else controller.enqueue(chunk);
    },
  });
}
