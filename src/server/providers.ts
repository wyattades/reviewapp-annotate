/**
 * How to find a review app's PR: hosting providers announce each preview in a
 * comment on the PR, from a bot. A provider says which accounts' comments to
 * trust and how to read the preview hostnames out of one, by the comment's own
 * structure, so a custom domain is found as readily as `*.vercel.app`.
 */
export type Provider = {
  id: string;
  /** the accounts whose comments name its review apps: anyone else's are ignored */
  botLogins: string[];
  /**
   * The review apps a comment announces, as URLs (`https://…`) or bare
   * hostnames; none if it isn't this provider's kind of comment.
   */
  parseUrls: (commentBody: string) => string[];
};

type ProviderOptions = {
  /** to trust other accounts, e.g. your own workflow's, instead of the default */
  botLogins?: string[];
};

type Link = {
  url: string;
  /** what the link says, tags and all stripped */
  text: string;
  /** the text just before it: a label like "Preview URL:" */
  before: string;
};

const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const HTML_LINK =
  /<a\s[^>]*href=['"](https?:\/\/[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The links in a comment, whether written as markdown or HTML. */
function links(body: string): Link[] {
  const found: Link[] = [];
  const before = (index: number) =>
    stripTags(body.slice(Math.max(0, index - 120), index));
  for (const m of body.matchAll(MARKDOWN_LINK)) {
    found.push({ url: m[2]!, text: m[1]!.trim(), before: before(m.index) });
  }
  for (const m of body.matchAll(HTML_LINK)) {
    found.push({ url: m[1]!, text: stripTags(m[2]!), before: before(m.index) });
  }
  return found;
}

export function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
}

/** A URL or bare hostname a provider returned, as the lower-case hostname review apps are matched by. */
export function previewHostname(urlOrHostname: string) {
  const value = urlOrHostname.trim();
  return hostnameOf(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

const unique = (hosts: (string | null)[]) => [
  ...new Set(hosts.filter((h): h is string => !!h)),
];

/**
 * "Preview URL: https://…" written as plain text, not a link: the rest of its
 * line, which can name several ("Preview URL: https://a.dev, https://b.dev (commit 4f2c1a9)").
 */
const BARE_PREVIEW_LINE = /preview url:?\**\s*([^\n]*)/gi;
const URL_IN_TEXT = /https?:\/\/[^\s,;)<>'"]+/g;

/**
 * The hostnames of links that say they're a preview: the link's own text
 * ("Preview", "Branch Preview URL"), or a "Preview URL:" label in front of it.
 */
export function previewHosts(body: string) {
  const fromLinks = links(body)
    .filter(
      (link) =>
        /preview/i.test(link.text) ||
        (/^https?:\/\//.test(link.text) && /preview url:?$/i.test(link.before)),
    )
    .map((link) => hostnameOf(link.url));
  const bare = [...body.matchAll(BARE_PREVIEW_LINE)].flatMap((line) =>
    [...line[1]!.matchAll(URL_IN_TEXT)].map((url) =>
      // a sentence's full stop or colon isn't part of the address
      hostnameOf(url[0].replace(/[.:]+$/, "")),
    ),
  );
  return unique([...fromLinks, ...bare]);
}

/**
 * Vercel's comment, which links each project's `[Preview](…)`: the branch
 * alias (or a custom branch domain), but not each deployment's own URL, so
 * only the alias finds its PR.
 */
export const vercel = (options: ProviderOptions = {}): Provider => ({
  id: "vercel",
  botLogins: options.botLogins ?? ["vercel[bot]"],
  parseUrls: (body) => (/vercel/i.test(body) ? previewHosts(body) : []),
});

/**
 * Cloudflare's comment, for both Workers (Workers Builds: a commit URL and a
 * branch URL) and Pages (a preview URL and a branch preview URL). Previews on
 * `workers.dev`, `pages.dev` or a custom domain.
 */
export const cloudflare = (options: ProviderOptions = {}): Provider => ({
  id: "cloudflare",
  botLogins: options.botLogins ?? ["cloudflare-workers-and-pages[bot]"],
  parseUrls: (body) => (/cloudflare/i.test(body) ? previewHosts(body) : []),
});

/**
 * Netlify's "Deploy Preview for site ready!" comment: the deploy preview
 * (`deploy-preview-12--site.netlify.app`) and, when it has one, the branch
 * deploy, or a custom domain for either.
 */
export const netlify = (options: ProviderOptions = {}): Provider => ({
  id: "netlify",
  botLogins: options.botLogins ?? ["netlify[bot]"],
  parseUrls: (body) =>
    /netlify/i.test(body)
      ? unique(
          links(body)
            .filter((link) => /^https?:\/\//.test(link.text))
            .filter((link) => /(deploy|branch) preview\W*$/i.test(link.before))
            .map((link) => hostnameOf(link.url)),
        )
      : [],
});

export const defaultProviders = (): Provider[] => [
  vercel(),
  cloudflare(),
  netlify(),
];
