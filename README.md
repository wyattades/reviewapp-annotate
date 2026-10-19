# Review-App Annotate

![A review app with a comment thread open, and the PR comment it keeps on GitHub](https://raw.githubusercontent.com/wyattades/reviewapp-annotate/main/docs/hero.png)

Leave comments on review apps (preview deployments), like Vercel's preview comments, but on any host. Select a region of the page, write a comment, and it's saved to a single comment on the pull request along with the page URL, CSS selector, a screenshot and (optionally) the console log. Teammates see each other's pins and can reply and resolve.

- Comments live in one PR comment, so people and agents can read them right on the PR. Ticking a thread's checkbox on GitHub resolves it in the widget.
- Works with Vercel, Cloudflare Workers/Pages, Netlify, and anything else that has review-apps.
- No hosting-provider API keys: the PR is found by reading the preview link in the provider's bot comment.
- Only your signed-in users can comment. You provide the auth.
- Host it anywhere: a plain `(Request) => Promise<Response>` handler can run on Next.js, Hono, Cloudflare Workers, etc.

## Setup

```sh
npm install reviewapp-annotate
```

### 1. Create a GitHub App

Create a GitHub App, install it on the repos that have review apps, and give it these permissions:

- Pull requests: read and write
- Issues: read and write
- Contents: read and write (screenshots are committed to a branch)

### 2. Mount the server

Next.js example:

```ts
// app/api/reviewapp-annotate/[[...path]]/route.ts
import { createHandler } from "reviewapp-annotate/server";

export const maxDuration = 60; // uploading screenshots can take a moment

const handler = createHandler({
  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  },
  repos: ["my-org/web"],
  tokenSecret: process.env.REVIEWAPP_ANNOTATE_SECRET!,
  authenticate: async (request) => {
    const user = await getUserFromYourSession(request); // null if signed out
    return user && { id: user.id, name: user.name, image: user.avatarUrl };
  },
  signInUrl: (returnTo) => `/login?next=${encodeURIComponent(returnTo)}`,
});

export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
```

### 3. Add the widget to your review apps

The server serves the widget itself. Add it to your app's HTML, as early as possible so the console log includes startup output:

```html
<script src="https://your-app.example.com/api/reviewapp-annotate/widget.js"></script>
```

Or load it from a CDN, pinned to a version. A CDN can't know where your server is, so also set `data-api`:

```html
<script
  src="https://cdn.jsdelivr.net/npm/reviewapp-annotate@0.1.0/dist/widget.js"
  data-api="https://your-app.example.com/api/reviewapp-annotate"
></script>
```

## Config

| Option                  | Purpose                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`                | The GitHub App's `{ appId, privateKey }`. It reads PR comments and writes the review comment.                                                                                |
| `repos`                 | The `owner/name` repos whose PRs have review apps.                                                                                                                           |
| `tokenSecret`           | Secret (16+ characters) used to sign the widget's sign-in tokens. Changing it signs everyone out.                                                                            |
| `authenticate(request)` | Returns the signed-in user `{ id, name, image? }` from your own session, `null` if signed out, or a `Response` to send instead (e.g. a 403 for non-teammates).               |
| `signInUrl(returnTo)`   | Where to send signed-out users. After signing in, send them back to `returnTo`.                                                                                              |
| `additionalProviders?`  | Extra hosts to find review apps on, besides the built-in Vercel, Cloudflare and Netlify. See [Custom providers](#custom-providers).                                          |
| `lock?`                 | Runs writes to a PR's comment one at a time, since GitHub can't safely merge two simultaneous edits. Defaults to a lock built on a git ref; pass your own to save API calls. |
| `sharedCache?`          | A key-value store (Redis, KV, ...) shared by your server instances. Speeds up cold starts by remembering which PR each review app belongs to.                                |
| `basePath?`             | Where the server is mounted. Default `/api/reviewapp-annotate`.                                                                                                              |
| `tokenTtlSeconds?`      | How long a sign-in lasts. Default 12 hours.                                                                                                                                  |
| `assetsBranch?`         | Branch that screenshots are committed to. Default `reviewapp-annotate-assets`.                                                                                               |
| `onError?`              | Called with unexpected errors, so you can log or report them.                                                                                                                |

Example with the optional settings:

```ts
import { Redis } from "@upstash/redis";

const redis = new Redis({ url: "...", token: "..." });

const handler = createHandler({
  // ...required options from above

  additionalProviders: [myProvider],

  // `get` returns a string or null; `set` stores a string for `ttlSeconds`
  sharedCache: {
    get: async (key) => redis.get<string>(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, { ex: ttlSeconds });
    },
  },

  // `key` looks like "owner/name#123"
  lock: async (key, run) => {
    // acquire a lock for `key`, then:
    try {
      return await run();
    } finally {
      // release it
    }
  },

  basePath: "/api/annotate",
  tokenTtlSeconds: 60 * 60,
  assetsBranch: "annotate-screenshots",
  onError: (error, { what }) => console.error(what, error),
});
```

### Custom providers

A provider tells the server which bot's PR comments to trust, and how to read the review app URLs out of one (`parseUrls` returns URLs or bare hostnames, or `[]` for a comment that isn't announcing a preview). This one finds Heroku review apps from a comment your GitHub Actions workflow posts:

```ts
import type { Provider } from "reviewapp-annotate/server";

const heroku: Provider = {
  id: "heroku",
  botLogins: ["github-actions[bot]"],
  parseUrls: (commentBody) =>
    commentBody.match(/https:\/\/[\w.-]+\.herokuapp\.com/g) ?? [],
};

createHandler({ additionalProviders: [heroku] /* ... */ });
```

## Theming

The widget's colors are CSS variables. Override them from your own CSS:

```css
[data-reviewapp-annotate-widget] {
  --ra-accent: #0d9488;
  --ra-pill: #134e4a;
}
```

The variables are `--ra-ink`, `--ra-paper`, `--ra-paper-2`, `--ra-line`, `--ra-muted`, `--ra-accent`, `--ra-accent-hover`, `--ra-accent-ink`, `--ra-sticky`, `--ra-sticky-hover`, `--ra-sticky-ink`, `--ra-resolved`, `--ra-resolved-ink`, `--ra-danger`, `--ra-pill`, `--ra-pill-hover`, `--ra-pill-ink`, `--ra-toast-error` and `--ra-shadow`.

## The PR comment

Each thread is a checklist item, with replies nested underneath:

```md
- [ ] **The enroll button is cut off on this card**
  - Ada · [/courses](https://…) · Oct 19, 15:04 UTC · 📍 `main > section.hero > div.card` · 220×64 at (880, 420) · 1440×900
  - ![screenshot](…)
  - ↩ **Grace** · Oct 19, 16:02 UTC: Fixed in the next push.
```

The comment starts with `<!-- reviewapp-annotate -->`. If another tool uses the same GitHub App and edits PR comments, have it skip comments with that marker.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
