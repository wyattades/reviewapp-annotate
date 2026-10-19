# reviewapp-annotate

Comment on a review app, like Vercel's preview comments, on **Heroku, Vercel or Cloudflare** previews (or any host that announces previews on the pull request). Drag a rectangle (or click a spot), type a comment, and it lands in **one comment on the PR**, with the page URL, the element's CSS path, a screenshot and the console log, so people and agents find everything where the work happens. Everyone sees each other's pins on the page, and can reply, resolve, edit and delete.

- **No separate website.** The threads live in a PR comment (a checklist: tick the box on GitHub to resolve, and it's resolved in the widget too).
- **No hosting-provider API keys.** It finds a review app's PR by reading the comment the provider's bot leaves on the PR, so custom domains work.
- **Your auth.** You say who's signed in (your own session); the sign-in popup only issues a token to a review app the PR announces.
- **Runs anywhere** that speaks web `Request` / `Response`, with ready-made Next.js route handlers.

It's one package with these parts:

| Import                             | What                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `reviewapp-annotate/server`        | the server: a function from a web `Request` to a `Response`                                   |
| `reviewapp-annotate/server/nextjs` | the same, as Next.js route handlers                                                           |
| `{basePath}/widget.js`             | the browser widget (Preact, ~260kB with its screenshot library), served by the server itself, and published as `dist/widget.js` for CDNs |
| `reviewapp-annotate/shared`        | the types the widget and server agree on (`StoredItem`, `StoredReply`, `Rect`, `ReviewState`) |

## Set it up (Next.js)

```sh
npm install reviewapp-annotate
```

```ts
// app/api/reviewapp-annotate/[[...path]]/route.ts
import { createReviewAnnotateRoutes } from "reviewapp-annotate/server/nextjs";

export const maxDuration = 60; // screenshots take a moment to commit

export const { GET, POST, PATCH, DELETE, OPTIONS } = createReviewAnnotateRoutes({
  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  },
  repos: ["my-org/web", "my-org/api"],
  tokenSecret: process.env.REVIEWAPP_ANNOTATE_SECRET!,
  authenticate: async (request) => {
    const user = await getUserFromYourSession(request); // null when signed out
    return user && { id: user.id, name: user.name, image: user.avatarUrl };
  },
  signInUrl: (returnTo) => `/login?next=${encodeURIComponent(returnTo)}`,
});
```

Then add the widget to your review apps, as early in the page as you can so the console log includes startup output:

```html
<script src="https://your-app.example.com/api/reviewapp-annotate/widget.js"></script>
```

It finds the API next to the script (the server serves `widget.js` itself): no file to copy, no build step. If the script is hosted elsewhere, point it at the API with `data-api="https://your-app.example.com/api/reviewapp-annotate"`.

Or load it from an npm CDN (jsDelivr, unpkg), pinned to a version. The CDN can't know where your server is, so say so with `data-api`:

```html
<script
  src="https://cdn.jsdelivr.net/npm/reviewapp-annotate@0.1.0/dist/widget.js"
  data-api="https://your-app.example.com/api/reviewapp-annotate"
></script>
```

Other hosts: `createReviewAnnotate(config).handle(request)` from `reviewapp-annotate/server` is the same thing as a plain `(Request) => Promise<Response>`; mount it at `basePath` (default `/api/reviewapp-annotate`).

### The GitHub App

Create a GitHub App (Settings → Developer settings → GitHub Apps), install it on `repos`, and give it:

- **Pull requests: read and write** and **Issues: read and write** (it reads PR comments and writes the review comment)
- **Contents: read and write** (it commits screenshots to a branch, and takes its default lock as a git ref)
- **Metadata: read**

Pass its **App ID** and **private key** (PEM) as `github`. Nothing is read from the environment: you pass everything in.

### Config

| Option                  | What                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`                | the GitHub App's `{ appId, privateKey }` (or any `GitHubPort`, e.g. a test fake)                                                                  |
| `repos`                 | `owner/name` of the repos whose PRs have review apps                                                                                              |
| `tokenSecret`           | signs the widget's sign-in tokens (16+ characters); rotating it signs everyone out                                                                |
| `authenticate(request)` | who's calling, from your own session: a `{ id, name, image? }`, `null` when signed out, or a `Response` to answer with instead (e.g. a 403 page) |
| `signInUrl(returnTo)`   | where to send someone who's signed out; they're sent back to `returnTo` after                                                                     |
| `lock?`                 | see "Locking"                                                                                                                                     |
| `sharedCache?`          | a key-value store your instances share (Redis...), so a cold one doesn't start from scratch: see "Speed"                                          |
| `providers?`            | whose PR comments announce review apps (default: Heroku, Vercel, Cloudflare Workers and Pages)                                                    |
| `basePath?`             | where it's mounted, default `/api/reviewapp-annotate`                                                                                             |
| `tokenTtlSeconds?`      | how long a sign-in lasts, default 12 hours                                                                                                        |
| `assetsBranch?`         | the branch screenshots are committed to, default `reviewapp-annotate-assets`                                                                      |
| `onError?`              | called with anything that goes wrong, to log or report                                                                                            |

### Routes

`GET {basePath}` (who's signed in, the PR, every thread), `POST` (a thread, or `?reply_to=<id>`), `PATCH ?id=[&reply=]` (`{ resolved }`, or `{ text }` to edit your own), `DELETE ?id=[&reply=]`, `GET {basePath}/connect?origin=` (the sign-in popup) and `GET {basePath}/widget.js`.

## Finding the PR

A review app's PR is found from its origin, with no calls to the hosting provider: providers announce each preview in a **comment on the PR, from a bot**, so the server reads those comments and matches the hostname. Which hostname a comment names is read from the comment itself (the link that calls itself a preview), so **custom domains work** as well as `*.vercel.app`. Only comments from the provider's own account count, and the sign-in popup only issues a token to an origin some provider comment names, so no other website gets one.

| Provider   | Comment from                        | What it reads                                                                                          |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Heroku     | `github-actions[bot]`               | Heroku itself doesn't comment: your workflow posts `[Review App](dashboard-link): https://…`           |
| Vercel     | `vercel[bot]`                       | the `[Preview](…)` link: the branch alias or a custom branch domain, but not each deployment's own URL |
| Cloudflare | `cloudflare-workers-and-pages[bot]` | Workers (commit and branch preview URLs) and Pages (preview and branch preview URLs)                   |

Each is a small `Provider` (`botLogins`, `parseComment`): pass your own, or `heroku({ botLogins: ["my-bot"] })`.

To look, it lists each repo's open PRs and reads the comments of those whose branch the hostname names (a handful of reads), then falls back to the most recent PRs (a custom domain with no branch in it, or a deployment's own URL, takes this wider look). It remembers every hostname it comes across.

## Speed

A lookup that isn't remembered takes a few seconds (about 3s when the branch is in the hostname, 5 to 6s for a full search), and serverless instances start cold often, each with an empty memory. Pass `sharedCache` (`{ get(key), set(key, value, ttlSeconds) }`: Redis, Workers KV, a table) and what one instance learns serves all of them:

- which PR a review app belongs to, and every other hostname it read along the way (an hour; a miss for 30 seconds)
- which comments in a PR are the review comments, so a cold poll reads them directly instead of listing every comment on the PR (a minute)
- the GitHub App's installation on each repo, and its own login (hours)

```ts
import { Redis } from "@upstash/redis";
const redis = new Redis({ url, token });

sharedCache: {
  get: async (key) => {
    const value = await redis.get(key);
    return value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
  },
  set: async (key, value, ttlSeconds) => void (await redis.set(key, value, { ex: ttlSeconds })),
},
```

With it, a lookup another instance already did takes milliseconds. The cache is only ever a speed-up: if it fails, the server carries on without it. Nothing in it is secret.

## Locking

GitHub can't compare-and-swap an edit to a comment, so two people commenting at once would overwrite each other. Writes to a PR's review comment run one at a time through a `Lock`: `(key, run) => Promise`, with the key `owner/name#123`.

- **Default: `githubRefLock`**: nothing else to run. Creating a git ref that already exists fails, so `refs/reviewapp-annotate/lock-<pr>` is a mutex, at a few API calls per write. Taking it is exclusive; pushing aside a holder that died (after 60s) is best effort, since GitHub can't update a ref conditionally.
- **Your own**: pass a Redis, database or advisory lock as `lock`; it's cheaper if you have one.

## Using the widget

- One draggable pill (it remembers where you put it). Its comment icon starts a selection; **N Comments / PR #N** opens the list, with a link to the PR comment.
- Drag a rectangle to comment on a region (its screenshot is attached, and you can remove it with the X), or click to drop a pin with no screenshot. Paste images from the clipboard (up to 3). **Enter** sends, **Shift+Enter** is a new line. **Attach console log** is off by default.
- Sending is instant: the composer closes at once, the new thread opens with its reply box focused, and it goes in the background (with retry on failure).
- Each thread is a pin with a comment count and the avatars of who's in it. Hover it for a preview (with Resolve); click it to open the thread: reply, resolve (which ticks the box in the PR comment), and edit or delete your own comments from the **...** menu.
- Everyone's threads refresh every 10s.

### Theming

Every colour is a CSS variable on the widget's host element, so you can retheme it from your own CSS (your styles win over the defaults):

```css
[data-reviewapp-annotate-widget] {
  --ra-accent: #0d9488;
  --ra-pill: #134e4a;
}
```

`--ra-ink`, `--ra-paper`, `--ra-paper-2`, `--ra-line`, `--ra-muted` (cards and text), `--ra-accent`, `--ra-accent-hover`, `--ra-accent-ink` (buttons, selections), `--ra-sticky`, `--ra-sticky-hover`, `--ra-sticky-ink` (pins), `--ra-resolved`, `--ra-resolved-ink`, `--ra-danger`, `--ra-pill`, `--ra-pill-hover`, `--ra-pill-ink` (the pill and toasts), `--ra-toast-error`, `--ra-shadow`.

## The PR comment

Each thread is one checklist item, with the page, element, region and viewport on a single line, then any screenshots, the console log, and replies as nested bullets:

```md
- [ ] **The enroll button is cut off on this card**
  - Ada · [/courses](https://…) · Oct 19, 15:04 UTC · 📍 `main > section.hero > div.card` · 220×64 at (880, 420) · 1440×900
  - ![screenshot](…)
  - ↩ **Grace** · Oct 19, 16:02 UTC: Fixed in the next push.
```

The comment starts with `<!-- reviewapp-annotate -->`: if another tool shares your GitHub App and edits "its" comment on a PR, have it skip comments with that marker.

## Develop

```sh
pnpm install
pnpm typecheck   # builds the widget (the server embeds it), then tsc
pnpm test        # bun test: the server's tests run against an in-memory GitHubPort (src/server/testing/fake-github.ts)
pnpm build       # dist/: the widget, and the server as ESM and CJS with types
```

## License

MIT
