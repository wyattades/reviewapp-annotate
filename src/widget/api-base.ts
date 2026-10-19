/** Public CDNs that serve npm packages: a script from one of these can't say where *your* server is. */
const CDN_HOSTS = /(^|\.)(jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|skypack\.dev|cdn\.skypack\.dev)$/;

/**
 * Where the server's API is, for a widget script loaded from `scriptSrc`: the
 * `data-api` the script tag says, else next to the script when the server
 * serves it (`{base}/widget.js`), else the usual place on the script's own
 * origin. Null when it's loaded from a public CDN with no `data-api`: there's
 * nothing sensible to guess.
 */
export function resolveApiBase(
  scriptSrc: string,
  dataApi: string | undefined,
  defaultPath = "/api/reviewapp-annotate",
) {
  const url = new URL(scriptSrc);
  let base: URL;
  if (dataApi !== undefined) {
    // told outright: a URL, or a path on the script's origin
    base = new URL(dataApi, url);
  } else if (url.pathname.endsWith("/widget.js") && !CDN_HOSTS.test(url.hostname)) {
    // served by the server itself: the API is right there
    base = new URL(".", url);
  } else if (CDN_HOSTS.test(url.hostname)) {
    return null;
  } else {
    // a copy of the script hosted elsewhere: the usual place on its origin
    base = new URL(defaultPath, url);
  }
  return base.href.replace(/\/+$/, "");
}
