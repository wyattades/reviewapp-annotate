/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultProviders } from "./providers";
import { createReviewAppPrFinder } from "./review-app-pr-finder";
import type { SharedCache } from "./shared-cache";
import { createFakeGitHub } from "./testing/fake-github";

const VERCEL = "vercel[bot]";
const CLOUDFLARE = "cloudflare-workers-and-pages[bot]";
const HEROKU = "github-actions[bot]";

/** the comments the providers' bots leave, naming a preview */
const vercelComment = (url: string) =>
  `[vc]: #x\nLearn more about [Vercel for GitHub](https://vercel.link/github-learn-more).\n| [web](https://vercel.com/o/web) | [Preview](${url}) |`;
const cloudflareComment = (url: string) =>
  `## Deploying with Cloudflare Workers\n<a href='${url}'>Branch Preview URL</a>`;
const herokuComment = (url: string) =>
  `[Review App](https://dashboard.heroku.com/apps/x): ${url}`;

/** a shared cache in a Map */
function memoryCache(): SharedCache & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
  };
}

function setup(sharedCache?: SharedCache) {
  const fake = createFakeGitHub();
  /** a finder with nothing in its memory, like a cold serverless instance */
  const instance = () =>
    createReviewAppPrFinder({
      github: fake.port,
      repos: ["o/web", "o/api"],
      providers: defaultProviders(),
      sharedCache,
    });
  return { fake, instance, find: instance().find };
}

describe("finder", () => {
  it("finds the PR whose provider comment names the review app", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1 });
    fake.addPull("o/web", { number: 2 });
    fake.addComment("o/web", 2, {
      authorLogin: VERCEL,
      body: vercelComment("https://web-git-feature-team.vercel.app"),
    });

    assert.deepEqual(await find("https://web-git-feature-team.vercel.app"), {
      repo: "o/web",
      prNumber: 2,
    });
  });

  it("finds each provider's review apps", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1, headRef: "one" });
    fake.addPull("o/web", { number: 2, headRef: "two" });
    fake.addPull("o/web", { number: 3, headRef: "three" });
    fake.addComment("o/web", 1, {
      authorLogin: HEROKU,
      body: herokuComment("https://app-abc123.herokuapp.com"),
    });
    fake.addComment("o/web", 2, {
      authorLogin: CLOUDFLARE,
      body: cloudflareComment("https://abc123.site.pages.dev"),
    });
    fake.addComment("o/web", 3, {
      authorLogin: VERCEL,
      body: vercelComment("https://web-git-three-team.vercel.app"),
    });

    assert.equal((await find("https://app-abc123.herokuapp.com"))?.prNumber, 1);
    assert.equal((await find("https://abc123.site.pages.dev"))?.prNumber, 2);
    assert.equal(
      (await find("https://web-git-three-team.vercel.app"))?.prNumber,
      3,
    );
  });

  it("finds a review app on a custom domain", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 5, headRef: "checkout-v2" });
    fake.addComment("o/web", 5, {
      authorLogin: VERCEL,
      body: vercelComment("https://checkout.staging.acme.dev"),
    });

    assert.deepEqual(await find("https://checkout.staging.acme.dev"), {
      repo: "o/web",
      prNumber: 5,
    });
    // ...but not its neighbours: only what a comment names
    assert.equal(await find("https://other.staging.acme.dev"), null);
  });

  it("looks in every repo it's given", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1 });
    fake.addPull("o/api", { number: 9 });
    fake.addComment("o/api", 9, {
      authorLogin: CLOUDFLARE,
      body: cloudflareComment("https://abc123.api.pages.dev"),
    });

    assert.deepEqual(await find("https://abc123.api.pages.dev"), {
      repo: "o/api",
      prNumber: 9,
    });
  });

  it("ignores a comment from anyone but the provider's bot", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1 });
    // someone tries to claim a preview for their PR
    fake.addComment("o/web", 1, {
      authorLogin: "someone",
      body: vercelComment("https://web-git-feature-team.vercel.app"),
    });
    // a provider's bot, but not that provider's kind of comment
    fake.addComment("o/web", 1, {
      authorLogin: CLOUDFLARE,
      body: vercelComment("https://web-git-feature-team.vercel.app"),
    });

    assert.equal(await find("https://web-git-feature-team.vercel.app"), null);
  });

  it("refuses origins that can't be review apps, without asking GitHub", async () => {
    const { fake, find } = setup();
    assert.equal(await find("http://example.com"), null);
    assert.equal(await find("not a url"), null);
    assert.equal(fake.calls.listPulls, undefined);
  });

  it("prefers the open PR when a closed one names the same preview", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", {
      number: 1,
      state: "closed",
      updatedAt: "2026-10-19T13:00:00Z",
    });
    fake.addPull("o/web", {
      number: 2,
      state: "open",
      updatedAt: "2026-10-19T12:00:00Z",
    });
    for (const issue of [1, 2]) {
      fake.addComment("o/web", issue, {
        authorLogin: VERCEL,
        body: vercelComment("https://web-git-shared-team.vercel.app"),
      });
    }

    assert.equal(
      (await find("https://web-git-shared-team.vercel.app"))?.prNumber,
      2,
    );
  });

  it("remembers what it read, so the next lookup costs nothing", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1 });
    fake.addPull("o/web", { number: 2 });
    fake.addComment("o/web", 1, {
      authorLogin: VERCEL,
      body: vercelComment("https://a-git-one-team.vercel.app"),
    });
    fake.addComment("o/web", 2, {
      authorLogin: VERCEL,
      body: vercelComment("https://a-git-two-team.vercel.app"),
    });

    await find("https://a-git-one-team.vercel.app");
    const callsAfterFirst = { ...fake.calls };

    assert.equal(
      (await find("https://a-git-one-team.vercel.app"))?.prNumber,
      1,
    );
    assert.deepEqual(fake.calls, callsAfterFirst);
  });

  it("reads only the PR named in the hostname, however many are open", async () => {
    const { fake, find } = setup();
    for (let n = 1; n <= 80; n++) {
      fake.addPull("o/web", { number: n, headRef: `other-${n}` });
    }
    fake.addPull("o/web", { number: 81, headRef: "payments-redesign" });
    fake.addComment("o/web", 81, {
      authorLogin: VERCEL,
      body: vercelComment("https://web-git-payments-redesign-team.vercel.app"),
    });

    const target = await find(
      "https://web-git-payments-redesign-team.vercel.app",
    );
    assert.equal(target?.prNumber, 81);
    assert.equal(fake.calls.listComments, 1);
  });

  it("finds an old open PR that's long off the recent list", async () => {
    const { fake, find } = setup();
    // 40 busier PRs since, then the one we want: updated long ago, still open
    for (let n = 1; n <= 40; n++) {
      fake.addPull("o/web", {
        number: n,
        headRef: `busy-${n}`,
        updatedAt: `2026-10-19T12:${String(n).padStart(2, "0")}:00Z`,
      });
    }
    fake.addPull("o/web", {
      number: 99,
      headRef: "SXP-2184/may-rerun",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    fake.addComment("o/web", 99, {
      authorLogin: HEROKU,
      body: herokuComment(
        "https://acme-sxp-2184-may-re-tffnkh.herokuapp.com",
      ),
    });

    const target = await find(
      "https://acme-sxp-2184-may-re-tffnkh.herokuapp.com",
    );
    assert.equal(target?.prNumber, 99);
  });

  it("falls back to the recent PRs when no branch name matches", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1, headRef: "unrelated" });
    fake.addComment("o/web", 1, {
      authorLogin: CLOUDFLARE,
      body: cloudflareComment("https://zzzzzzzz-site.sub.workers.dev"),
    });

    assert.equal(
      (await find("https://zzzzzzzz-site.sub.workers.dev"))?.prNumber,
      1,
    );
  });

  it("remembers a miss for a moment", async () => {
    const { fake, find } = setup();
    fake.addPull("o/web", { number: 1 });
    assert.equal(await find("https://nope-team.vercel.app"), null);
    const calls = fake.calls.listPulls;
    assert.equal(await find("https://nope-team.vercel.app"), null);
    assert.equal(fake.calls.listPulls, calls);
  });

  describe("with a shared cache", () => {
    it("lets a cold instance skip the search another already did", async () => {
      const { fake, instance } = setup(memoryCache());
      fake.addPull("o/web", { number: 1 });
      fake.addComment("o/web", 1, {
        authorLogin: VERCEL,
        body: vercelComment("https://web-git-one-team.vercel.app"),
      });

      assert.equal(
        (await instance().find("https://web-git-one-team.vercel.app"))
          ?.prNumber,
        1,
      );
      const callsAfterFirst = { ...fake.calls };

      // a brand new instance: nothing in its memory
      assert.equal(
        (await instance().find("https://web-git-one-team.vercel.app"))
          ?.prNumber,
        1,
      );
      assert.deepEqual(
        fake.calls,
        callsAfterFirst,
        "GitHub wasn't asked again",
      );
    });

    it("shares every preview it came across, not only the one asked for", async () => {
      const { fake, instance } = setup(memoryCache());
      fake.addPull("o/web", { number: 1, headRef: "alpha" });
      fake.addPull("o/web", { number: 2, headRef: "beta" });
      fake.addComment("o/web", 1, {
        authorLogin: VERCEL,
        body: vercelComment("https://web-git-alpha-team.vercel.app"),
      });
      fake.addComment("o/web", 2, {
        authorLogin: VERCEL,
        body: vercelComment("https://web-git-beta-team.vercel.app"),
      });

      // reads everything, and finds nothing
      await instance().find("https://zzz-unknown.example.com");
      const callsAfter = { ...fake.calls };

      assert.equal(
        (await instance().find("https://web-git-alpha-team.vercel.app"))
          ?.prNumber,
        1,
      );
      assert.equal(
        (await instance().find("https://web-git-beta-team.vercel.app"))
          ?.prNumber,
        2,
      );
      assert.deepEqual(fake.calls, callsAfter);
    });

    it("shares a miss too, briefly", async () => {
      const { fake, instance } = setup(memoryCache());
      fake.addPull("o/web", { number: 1 });
      assert.equal(await instance().find("https://nope-team.vercel.app"), null);
      const calls = fake.calls.listPulls;
      assert.equal(await instance().find("https://nope-team.vercel.app"), null);
      assert.equal(fake.calls.listPulls, calls);
    });

    it("carries on when the cache is down", async () => {
      const broken: SharedCache = {
        async get() {
          throw new Error("redis is down");
        },
        async set() {
          throw new Error("redis is down");
        },
      };
      const { fake, instance } = setup(broken);
      fake.addPull("o/web", { number: 1 });
      fake.addComment("o/web", 1, {
        authorLogin: VERCEL,
        body: vercelComment("https://web-git-one-team.vercel.app"),
      });
      assert.equal(
        (await instance().find("https://web-git-one-team.vercel.app"))
          ?.prNumber,
        1,
      );
    });
  });
});
