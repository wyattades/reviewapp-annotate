/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubRefLock } from "./lock";
import type { SharedCache } from "./shared-cache";
import { createFakeGitHub } from "./testing/fake-github";
import { createThreadStore } from "./threads";

const target = { repo: "o/r", prNumber: 7 };

const review = (text: string) => ({
  author: "Ada",
  avatar: null,
  authorId: "u1",
  text,
  pageUrl: "https://app.example.com/",
  selector: "body",
  rect: { x: 0, y: 0, w: 0, h: 0 },
  pageRect: { x: 1, y: 2, w: 0, h: 0 },
});

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
  /** a store with nothing in its memory, like a cold serverless instance */
  const instance = () =>
    createThreadStore({
      github: fake.port,
      lock: githubRefLock(fake.port.refs),
      assetsBranch: "assets",
      sharedCache,
    });
  return { fake, instance };
}

describe("thread store's shared comment ids", () => {
  it("lets a cold instance read the review comment without listing the PR's comments", async () => {
    const { fake, instance } = setup(memoryCache());
    await instance().post(target, review("first"));
    // other comments on a busy PR, which a listing would have to page through
    for (let n = 0; n < 5; n++) {
      fake.addComment("o/r", 7, {
        authorLogin: "someone",
        body: `chatter ${n}`,
      });
    }
    const listedBefore = fake.calls.listComments ?? 0;

    const { items } = await instance().list(target);
    assert.deepEqual(
      items.map((i) => i.text),
      ["first"],
    );
    assert.equal(
      fake.calls.listComments,
      listedBefore,
      "didn't list the comments",
    );
  });

  it("shares a second review comment when the first fills up", async () => {
    const cache = memoryCache();
    const { instance } = setup(cache);
    const store = instance();
    const heavy = (n: number) => ({
      ...review(`heavy ${n}`),
      consoleEntries: Array.from({ length: 100 }, () => ({
        level: "log",
        time: 1,
        message: "x".repeat(1900),
      })),
    });
    for (let n = 0; n < 9; n++) await store.post(target, heavy(n));

    const ids = JSON.parse(
      cache.entries.get("reviewapp-annotate:comment-ids:o/r#7")!,
    ) as number[];
    assert.equal(ids.length, 2);
    // a cold instance sees all nine threads, through both comments
    assert.equal((await instance().list(target)).items.length, 9);
  });

  it("looks at the PR itself when a shared id has gone", async () => {
    const { fake, instance } = setup(memoryCache());
    const store = instance();
    await store.post(target, review("first"));
    const { firstCommentId } = await store.list(target);

    fake.removeComment("o/r", firstCommentId!);
    // the shared list still names it: nothing to show...
    assert.deepEqual((await store.list(target)).items, []);

    // ...and the next read goes to the PR's comments, not to that stale list
    const listedBefore = fake.calls.listComments ?? 0;
    assert.deepEqual((await store.list(target)).items, []);
    assert.ok(
      (fake.calls.listComments ?? 0) > listedBefore,
      "went back to GitHub for the comments",
    );

    // and a new thread starts a new review comment that everyone then finds
    await store.post(target, review("second"));
    assert.deepEqual(
      (await instance().list(target)).items.map((i) => i.text),
      ["second"],
    );
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
    const { instance } = setup(broken);
    await instance().post(target, review("first"));
    assert.equal((await instance().list(target)).items.length, 1);
  });

  it("works without a cache at all", async () => {
    const { instance } = setup();
    await instance().post(target, review("first"));
    assert.equal((await instance().list(target)).items.length, 1);
  });
});
