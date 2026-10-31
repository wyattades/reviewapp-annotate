# Review-App Annotate

![A review app with a comment thread open, beside the PR on GitHub with the review comment it keeps](https://raw.githubusercontent.com/wyattades/reviewapp-annotate/main/docs/hero.png)

Leave comments on review apps (preview deployments), like Vercel's preview comments, but on any host. Select a region of the page, write a comment, and it's saved to a single comment on the pull request along with the page URL, CSS selector, a screenshot and (optionally) the console log. Teammates see each other's pins and can reply and resolve.

- Comments live in one PR comment, so people and agents can read them right on the PR. Ticking a thread's checkbox on GitHub resolves it in the widget.
- Works with Vercel, Cloudflare Workers/Pages, Netlify, and anything else that has review-apps.
- No hosting-provider API keys: the PR is found by reading the preview link in the provider's bot comment.
- Only your signed-in users can comment. You provide the auth.
- Host it anywhere: a plain `(Request) => Promise<Response>` handler can run on Next.js, Hono, Cloudflare Workers, etc.

## Using it

<img align="right" width="260" alt="The widget on a phone: the list button beside the comment button, with the comments list open" src="https://raw.githubusercontent.com/wyattades/reviewapp-annotate/main/docs/mobile.png">

The widget is a round comment button in the corner of the page; its badge counts the PR's comments. Drag it anywhere.

- **Comment:** click the button, then drag over part of the page (or click to drop a pin) and write. The region's screenshot goes with it. It's redrawn from the page's HTML, so it can miss things like cross-origin images; in Chrome or Edge on a desktop, **Sharper screenshot** captures the tab exactly as it looks instead (the browser asks to share the tab first).
- **See everyone's comments:** while adding a comment, a list button shows beside the comment button, with the count. It opens every thread on the PR, across pages.
- **Reply and resolve:** threads are pins on the page; open one to reply, resolve it, or drag the pin to move it.
- Signed out, the badge is a lock: the button signs you in.

It works the same on phones, with taps.

<br clear="right">

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
  src="https://cdn.jsdelivr.net/npm/reviewapp-annotate@0.6.0/dist/widget.js"
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
| `images?`               | Where screenshots and pasted images are stored: a branch of the repo (default), or your own storage. See [Where images go](#where-images-go).                                |
| `onEvent?`              | Called after a thread, a reply or a thread being ticked off is saved to the PR, to tell people. See [Notifications](#notifications).                                         |
| `waitUntil?`            | Keeps `onEvent` running after the response is sent (Vercel's `waitUntil`, Next's `after`). Without it, a comment waits for `onEvent`.                                        |
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
  images: { branch: "annotate-screenshots" },
  onError: (error, { what }) => console.error(what, error),
});
```

### Where images go

Screenshots and pasted images have to live somewhere a PR comment can show them. GitHub has no API for the uploads you make by dragging an image into a comment, so by default they're committed to a branch of the repo (`images: { branch }`, default `reviewapp-annotate-assets`). That keeps them private: seeing an image needs access to the repo, and the widget loads them through the server.

To keep them out of the repo, make `images` a function that stores each image and returns a **public** URL. GitHub's image proxy fetches the link without signing in, so anyone with the link can see the image. The `name` you're given is a random UUID (122 random bits), so a link can't be guessed; store the image under it as it is. It's all that protects the image.

```ts
import { put } from "@vercel/blob";

createHandler({
  images: async ({ bytes, contentType, name, repo, prNumber }) => {
    // the repo and PR in the path make it easy to find (or delete) a PR's images
    const blob = await put(
      `${repo}/pr-${prNumber}/${name}`,
      new Blob([bytes], { type: contentType }),
      { access: "public", contentType },
    );
    return blob.url;
  },
  // ...
});
```

`repo` and `prNumber` are passed so you can sort images by PR, as above. They don't make a link safer (the `name` does), and they put your repo's name in the URL: leave them out if that matters.

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

## Notifications

`onEvent` is called after something is saved to the PR, with the PR (title, link, author), the thread, who did it, and who else is in the thread:

| `event.type`      | When                               |
| ----------------- | ---------------------------------- |
| `thread-created`  | someone starts a thread            |
| `reply-added`     | someone replies (`event.reply`)    |
| `thread-resolved` | a thread is ticked off or reopened |

If `onEvent` throws, the change is still saved and the error goes to `onError`. Changes made on GitHub itself, like a box ticked or a reply written by hand, aren't events: the server doesn't see them.

`reviewapp-annotate/slack` turns events into Slack direct messages. It doesn't talk to Slack or know who anyone is: you give it a way to find someone's Slack user id, and a way to send.

```ts
import { after } from "next/server";
import { slackNotifier } from "reviewapp-annotate/slack";

createHandler({
  onEvent: slackNotifier({
    // a Slack user id (U…), or null to skip them. `who` is the PR's author
    // ({ kind: "github", login }) or someone who comments in your app
    // ({ kind: "user", id }, the id `authenticate` gave them)
    resolveSlackUser: (who) =>
      who.kind === "github"
        ? slackIdForGithubLogin(who.login)
        : slackIdForUser(who.id),
    // `channel` is a user id, so this is a direct message from your app (`chat:write`)
    send: (message) => slack.chat.postMessage(message),
  }),
  waitUntil: after,
  // ...
});
```

Who hears about what:

- **A new thread:** the PR's author, unless the PR was opened by a bot.
- **A reply:** everyone else in the thread, so the PR's author only if they're in it.
- **A thread ticked off:** no one.
- Never the person who did it, and once each. A message has the thread's text, a screenshot when it's somewhere Slack can fetch (not a private repo), and buttons to the thread on GitHub and the page.

For something other than Slack, use `recipientsFor(event)` from the same import to get who should hear, and write your own message.

## Theming

The widget's colors are CSS variables. Override them from your own CSS:

```css
[data-reviewapp-annotate-widget] {
  --ra-accent: #0d9488;
  --ra-pill: #134e4a;
}
```

The variables are `--ra-ink`, `--ra-paper`, `--ra-paper-2`, `--ra-line`, `--ra-muted`, `--ra-accent`, `--ra-accent-hover`, `--ra-accent-ink`, `--ra-sticky`, `--ra-sticky-hover`, `--ra-sticky-ink`, `--ra-resolved`, `--ra-resolved-ink`, `--ra-danger`, `--ra-pill`, `--ra-pill-hover`, `--ra-pill-ink` and `--ra-shadow`.

## The PR comment

Each thread is a checklist item, with replies nested underneath:

```md
- [ ] **The enroll button is cut off on this card**
  - Ada · [/courses](https://…) · Oct 19, 15:04 UTC · 📍 `main > section.hero > div.card` · 220×64 at (880, 420) · 1440×900
  - ![screenshot](…)
  - ↩ **Grace** · Oct 19, 16:02 UTC: Fixed in the next push.
```

The comment starts with `<!-- reviewapp-annotate -->`. If another tool uses the same GitHub App and edits PR comments, have it skip comments with that marker.

A comment fills up to 45,000 characters with threads; past that, new threads start a new comment, so each thread keeps room for replies (a comment grows to at most 64,000 characters, under GitHub's 65,536).

### For agents

Agents (and people) can work through the threads on GitHub itself, with nothing but the `gh` CLI. The comment says how, in a note hidden at its top:

- **Resolve a thread:** change its `- [ ]` to `- [x]`.
- **Reply:** add a line at the end of the thread, indented two spaces: `  - ↩ **Your name** · Your reply`. It shows in the widget as a reply "on GitHub".

```sh
# the review comment's id
gh api repos/OWNER/REPO/issues/PR_NUMBER/comments -q '.[] | select(.body | startswith("<!-- reviewapp-annotate")) | .id'
# read it, edit body.md, write it back
gh api repos/OWNER/REPO/issues/comments/COMMENT_ID -q .body > body.md
gh api -X PATCH repos/OWNER/REPO/issues/comments/COMMENT_ID -F body=@body.md
```

Keep the hidden `<!-- review-item:… -->` and `<!-- reply:… -->` markers as they are. Editing the comment on GitHub needs write access to the repo.

## Development

```sh
pnpm install
pnpm dev           # the widget's playground at http://localhost:4321, rebuilt on save
pnpm typecheck
pnpm test
pnpm build
pnpm screenshots   # the README's images, from the playground
```

The playground (`playground/`) is a review app with the widget (`index.html`) and the PR it comments on, as GitHub shows it (`pr.html`). The widget runs against a fake server in the page, so you can try commenting, replying, resolving and moving pins without GitHub or a deployed review app. The PR page shows the comment the server would write, built with its own formatter and updated as you go: tick a box to resolve a thread, or edit the comment (its `···` menu) as an agent would. A toolbar at the bottom switches pages, resets the threads, and signs in or out.

`pnpm screenshots` drives both pages in headless Chrome (the installed Chrome, or `pnpm exec playwright install chromium`) and writes `docs/hero.png` and `docs/mobile.png`: change the playground, then run it again.

## License

MIT
