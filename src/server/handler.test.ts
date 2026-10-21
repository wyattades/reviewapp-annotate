/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UploadedImage } from "./config";
import type { ReviewEvent } from "./events";
import { createHandler } from "./handler";
import { createFakeGitHub } from "./testing/fake-github";
import { createTokens } from "./tokens";

const ORIGIN = "https://app-git-my-feature-team.vercel.app";
const BASE = "https://app.test/api/reviewapp-annotate";
const SECRET = "a-token-secret-that-is-long-enough";

/** a comment the way Vercel's bot leaves it, naming a preview */
const vercelComment = (url: string) =>
  `[vc]: #x\nLearn more about [Vercel for GitHub](https://vercel.link/github-learn-more).\n| [web](https://vercel.com/o/r) | [Preview](${url}) |`;

function setup(
  options: {
    latencyMs?: number;
    images?: Parameters<typeof createHandler>[0]["images"];
    onEvent?: Parameters<typeof createHandler>[0]["onEvent"];
    waitUntil?: Parameters<typeof createHandler>[0]["waitUntil"];
    pr?: Parameters<ReturnType<typeof createFakeGitHub>["addPull"]>[1];
  } = {},
) {
  const fake = createFakeGitHub(options);
  fake.addPull("o/r", {
    number: 7,
    headRef: "my-feature",
    title: "Redesign pricing",
    author: { login: "ahanthorn", type: "User" },
    ...options.pr,
  });
  fake.addComment("o/r", 7, {
    authorLogin: "vercel[bot]",
    body: vercelComment(ORIGIN),
  });

  const errors: unknown[] = [];
  const handle = createHandler({
    github: fake.port,
    repos: ["o/r"],
    tokenSecret: SECRET,
    // the test says who it is with a header
    authenticate: async (request) => {
      const who = request.headers.get("x-user");
      if (who === "banned") return new Response("no", { status: 403 });
      return who
        ? { id: `id-${who}`, name: who, image: `https://img.test/${who}.png` }
        : null;
    },
    signInUrl: (returnTo) => `/login?next=${encodeURIComponent(returnTo)}`,
    images: options.images,
    onEvent: options.onEvent,
    waitUntil: options.waitUntil,
    onError: (error) => errors.push(error),
  });

  /** signs `who` in for a review app's origin, as the popup does */
  async function signIn(who: string, origin = ORIGIN) {
    const res = await handle(
      new Request(`${BASE}/connect?origin=${encodeURIComponent(origin)}`, {
        headers: { "x-user": who },
      }),
    );
    const token = /"token":"([^"]+)"/.exec(await res.text())?.[1];
    assert.ok(token, "got a token");
    return token;
  }

  const call = (
    method: string,
    token: string | null,
    {
      query = "",
      body,
      origin = ORIGIN,
    }: { query?: string; body?: unknown; origin?: string } = {},
  ) =>
    handle(
      new Request(`${BASE}${query}`, {
        method,
        headers: {
          origin,
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );

  const comment = (text: string, extra: object = {}) => ({
    text,
    pageUrl: `${ORIGIN}/cart`,
    selector: "main > button",
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    pageRect: { x: 10, y: 20, w: 30, h: 40 },
    ...extra,
  });

  const state = async (token: string) =>
    (await call("GET", token)).json() as Promise<{
      user: string;
      repo: string;
      prNumber: number;
      commentUrl: string;
      items: {
        id: string;
        text: string;
        resolved: boolean;
        author: string;
        selector: string;
        imageUrls: string[];
        replies: { id: string; text: string }[];
      }[];
    }>;

  return { fake, errors, handle, signIn, call, comment, state };
}

describe("the sign-in popup", () => {
  it("sends someone who's signed out to sign in, then back", async () => {
    const { handle } = setup();
    const res = await handle(
      new Request(`${BASE}/connect?origin=${encodeURIComponent(ORIGIN)}`),
    );
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location")!, BASE);
    assert.equal(location.pathname, "/login");
    assert.equal(
      location.searchParams.get("next"),
      `/api/reviewapp-annotate/connect?origin=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("hands the token to the review app that opened it, and only that one", async () => {
    const { handle } = setup();
    const res = await handle(
      new Request(`${BASE}/connect?origin=${encodeURIComponent(ORIGIN)}`, {
        headers: { "x-user": "ada" },
      }),
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /text\/html/);
    const html = await res.text();
    assert.match(html, /postMessage\(.*"type":"reviewapp-annotate-token"/);
    assert.ok(
      html.includes(`, ${JSON.stringify(ORIGIN)})`),
      "targets the opener's origin",
    );
  });

  it("lets the app answer for someone who has no business here", async () => {
    const { handle } = setup();
    const res = await handle(
      new Request(`${BASE}/connect?origin=${encodeURIComponent(ORIGIN)}`, {
        headers: { "x-user": "banned" },
      }),
    );
    assert.equal(res.status, 403);
  });

  it("gives a token only to a review app a PR announces, not to any website", async () => {
    const { handle } = setup();
    for (const [origin, status] of [
      ["https://evil.test", 404], // a site no provider comment names
      ["http://evil.test", 400], // not even https
    ] as const) {
      const res = await handle(
        new Request(`${BASE}/connect?origin=${encodeURIComponent(origin)}`, {
          headers: { "x-user": "ada" },
        }),
      );
      assert.equal(res.status, status, origin);
      assert.ok(!(await res.text()).includes("token"), origin);
    }
  });

  it("works for a custom domain a provider comment names", async () => {
    const { fake, signIn, call } = setup();
    fake.addPull("o/r", { number: 8, headRef: "pricing" });
    fake.addComment("o/r", 8, {
      authorLogin: "vercel[bot]",
      body: vercelComment("https://pricing.staging.acme.dev"),
    });

    const custom = "https://pricing.staging.acme.dev";
    const token = await signIn("ada", custom);
    const res = await call("GET", token, { origin: custom });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { prNumber: number }).prNumber, 8);
  });
});

describe("the widget script", () => {
  it("is served by the server itself, to anyone", async () => {
    const { handle } = setup();
    const res = await handle(new Request(`${BASE}/widget.js`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /javascript/);
    assert.match(res.headers.get("cache-control")!, /public/);
    const script = await res.text();
    assert.ok(script.length > 10_000, "it's the real bundle");
    assert.ok(script.includes("reviewapp-annotate-token"));
  });
});

describe("access", () => {
  it("needs a token, from the right app, for an app with a PR", async () => {
    const { call, signIn, fake } = setup();
    assert.equal((await call("GET", null)).status, 401);
    assert.equal((await call("GET", "garbage")).status, 401);

    const token = await signIn("ada");
    assert.equal((await call("GET", token)).status, 200);
    // the token was signed for ORIGIN: a request from elsewhere is refused
    assert.equal(
      (
        await call("GET", token, {
          origin: "https://other-git-x-team.vercel.app",
        })
      ).status,
      403,
    );

    // a valid token for a review app that no PR announces (any more)
    const lost = "https://lost-git-x-team.vercel.app";
    const lostToken = await createTokens({
      secret: SECRET,
      ttlSeconds: 60,
    }).sign({ origin: lost, name: "ada", userId: "id-ada" });
    const res = await call("GET", lostToken, { origin: lost });
    assert.equal(res.status, 404);
    assert.ok(fake.calls.listPulls);
  });

  it("answers CORS for https origins, on any domain, and not for http", async () => {
    const { handle } = setup();
    for (const origin of [ORIGIN, "https://custom.acme.dev"]) {
      const res = await handle(
        new Request(BASE, { method: "OPTIONS", headers: { origin } }),
      );
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), origin);
    }
    const plain = await handle(
      new Request(BASE, {
        method: "OPTIONS",
        headers: { origin: "http://evil.test" },
      }),
    );
    assert.equal(plain.headers.get("access-control-allow-origin"), null);
  });

  it("404s other paths and 405s other methods", async () => {
    const { handle, signIn } = setup();
    const token = await signIn("ada");
    assert.equal(
      (await handle(new Request("https://app.test/elsewhere"))).status,
      404,
    );
    const put = await handle(
      new Request(BASE, {
        method: "PUT",
        headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
      }),
    );
    assert.equal(put.status, 405);
  });
});

describe("threads", () => {
  it("posts, replies, resolves, edits and deletes", async () => {
    const { call, signIn, comment, state, fake } = setup();
    const ada = await signIn("ada");
    const grace = await signIn("grace");

    // nothing yet, but who and where
    const empty = await state(ada);
    assert.deepEqual(
      [empty.user, empty.repo, empty.prNumber, empty.items.length],
      ["ada", "o/r", 7, 0],
    );
    assert.equal(empty.commentUrl, "https://github.com/o/r/pull/7");

    // ada posts, with a screenshot
    const posted = await call("POST", ada, {
      body: comment("Button is cut off", {
        screenshots: ["data:image/jpeg;base64,AAAA"],
        console: [{ level: "error", time: 5, message: "boom" }],
      }),
    });
    assert.equal(posted.status, 200);
    const { itemId } = (await posted.json()) as { itemId: string };
    assert.equal(fake.assets.length, 1);
    assert.deepEqual(fake.assets[0]!.branch, "reviewapp-annotate-assets");

    // everyone sees it, once, in one PR comment
    const seen = await state(grace);
    assert.deepEqual(
      seen.items.map((i) => [i.id, i.text, i.author]),
      [[itemId, "Button is cut off", "ada"]],
    );
    assert.equal(fake.reviewBodies("o/r", 7).length, 1);
    assert.match(
      fake.reviewBodies("o/r", 7)[0]!,
      /assets\.test\/o\/r\/reviewapp-annotate-assets\/pr-7\//,
    );

    // its screenshot comes back through the server, for anyone signed in to the review app
    assert.equal(seen.items[0]!.imageUrls.length, 1);
    const image = await call("GET", grace, {
      query: `/asset?id=${itemId}&n=0`,
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(
      [...new Uint8Array(await image.arrayBuffer())],
      [...Uint8Array.from(atob("AAAA"), (c) => c.charCodeAt(0))],
    );
    // ...but not to the signed out, and not an image the thread doesn't have
    assert.equal(
      (await call("GET", null, { query: `/asset?id=${itemId}&n=0` })).status,
      401,
    );
    assert.equal(
      (await call("GET", grace, { query: `/asset?id=${itemId}&n=1` })).status,
      404,
    );
    assert.equal(
      (await call("GET", grace, { query: `/asset?id=nope&n=0` })).status,
      404,
    );

    // grace replies; ada is told nothing she can't do
    assert.equal(
      (
        await call("POST", grace, {
          query: `?reply_to=${itemId}`,
          body: { text: "Same here" },
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await state(ada)).items[0]!.replies.map((r) => r.text),
      ["Same here"],
    );

    // anyone can resolve
    assert.equal(
      (
        await call("PATCH", grace, {
          query: `?id=${itemId}`,
          body: { resolved: true },
        })
      ).status,
      200,
    );
    assert.equal((await state(ada)).items[0]!.resolved, true);

    // anyone can move it, by dragging its pin
    assert.equal(
      (
        await call("PATCH", grace, {
          query: `?id=${itemId}`,
          body: {
            selector: "main > p",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            pageRect: { x: 1, y: 2, w: 3, h: 4 },
          },
        })
      ).status,
      200,
    );
    assert.equal((await state(ada)).items[0]!.selector, "main > p");

    // only the author edits or deletes
    const notYours = await call("PATCH", grace, {
      query: `?id=${itemId}`,
      body: { text: "mine now" },
    });
    assert.equal(notYours.status, 404);
    assert.equal(
      (
        await call("PATCH", ada, {
          query: `?id=${itemId}`,
          body: { text: "Button is cut off on mobile" },
        })
      ).status,
      200,
    );
    const edited = (await state(ada)).items[0]!;
    assert.equal(edited.text, "Button is cut off on mobile");

    const replyId = edited.replies[0]!.id;
    assert.equal(
      (await call("DELETE", ada, { query: `?id=${itemId}&reply=${replyId}` }))
        .status,
      404,
      "ada can't delete grace's reply",
    );
    assert.equal(
      (await call("DELETE", grace, { query: `?id=${itemId}&reply=${replyId}` }))
        .status,
      200,
    );
    assert.equal(
      (await call("DELETE", grace, { query: `?id=${itemId}` })).status,
      404,
    );
    assert.equal(
      (await call("DELETE", ada, { query: `?id=${itemId}` })).status,
      200,
    );
    assert.equal((await state(ada)).items.length, 0);
  });

  it("commits images to the branch `images.branch` names", async () => {
    const { fake, call, signIn, comment, state } = setup({
      images: { branch: "my-screenshots" },
    });
    const ada = await signIn("ada");
    const posted = await call("POST", ada, {
      body: comment("Cut off", {
        screenshots: ["data:image/jpeg;base64,AAAA"],
      }),
    });
    assert.equal(posted.status, 200);
    assert.equal(fake.assets[0]!.branch, "my-screenshots");
    // ...and serves them from it, to the signed in
    const { items } = await state(ada);
    const image = await call("GET", ada, {
      query: `/asset?id=${items[0]!.id}&n=0`,
    });
    assert.equal(image.status, 200);
  });

  describe("events", () => {
    it("tells onEvent about a thread, a reply and a thread ticked off, with who and where", async () => {
      const events: ReviewEvent[] = [];
      const { fake, call, signIn, comment } = setup({
        onEvent: (event) => void events.push(event),
      });
      const ada = await signIn("ada");
      const grace = await signIn("grace");

      const posted = await call("POST", ada, { body: comment("Cut off") });
      const { itemId } = (await posted.json()) as { itemId: string };
      assert.equal(events.length, 1);
      const [created] = events;
      assert.equal(created!.type, "thread-created");
      assert.equal(created!.actor.id, "id-ada");
      assert.equal(created!.actor.name, "ada");
      assert.equal(created!.thread.id, itemId);
      assert.equal(created!.thread.text, "Cut off");
      assert.deepEqual(created!.participants, []);
      assert.deepEqual(created!.pull, {
        number: 7,
        title: "Redesign pricing",
        url: "https://github.com/o/r/pull/7",
        author: { login: "ahanthorn", type: "User" },
      });
      assert.equal(created!.links.page, `${ORIGIN}/cart`);
      assert.match(
        created!.links.thread,
        /^https:\/\/github.com\/o\/r\/pull\/7#issuecomment-\d+$/,
      );
      assert.match(
        fake.reviewBodies("o/r", 7)[0]!,
        /Cut off/,
        "saved before it was announced",
      );

      await call("POST", grace, {
        query: `?reply_to=${itemId}`,
        body: { text: "Same here" },
      });
      const replied = events[1]!;
      assert.equal(replied.type, "reply-added");
      assert.equal(
        replied.type === "reply-added" && replied.reply.text,
        "Same here",
      );
      assert.equal(replied.actor.name, "grace");
      // the thread's other people, not the replier
      assert.deepEqual(replied.participants, [{ id: "id-ada", name: "ada" }]);
      assert.equal(replied.thread.replies.length, 1);

      await call("PATCH", grace, {
        query: `?id=${itemId}`,
        body: { resolved: true },
      });
      const done = events[2]!;
      assert.equal(done.type, "thread-resolved");
      assert.equal(done.type === "thread-resolved" && done.resolved, true);
      assert.deepEqual(
        done.participants.map((p) => p.id),
        ["id-ada"],
      );
    });

    it("says nothing about changes that aren't a new thread, reply or tick", async () => {
      const events: ReviewEvent[] = [];
      const { call, signIn, comment } = setup({
        onEvent: (event) => void events.push(event),
      });
      const ada = await signIn("ada");
      const posted = await call("POST", ada, { body: comment("Cut off") });
      const { itemId } = (await posted.json()) as { itemId: string };
      events.length = 0;

      await call("PATCH", ada, {
        query: `?id=${itemId}`,
        body: { text: "Edited" },
      });
      await call("PATCH", ada, {
        query: `?id=${itemId}`,
        body: {
          selector: "main",
          rect: { x: 0, y: 0, w: 1, h: 1 },
          pageRect: { x: 0, y: 0, w: 1, h: 1 },
        },
      });
      await call("DELETE", ada, { query: `?id=${itemId}` });
      assert.deepEqual(events, []);
    });

    it("saves the comment even when onEvent throws, and reports it", async () => {
      const { errors, call, signIn, comment, state } = setup({
        onEvent: () => {
          throw new Error("slack is down");
        },
      });
      const ada = await signIn("ada");
      const res = await call("POST", ada, { body: comment("Cut off") });
      assert.equal(res.status, 200);
      assert.equal((await state(ada)).items.length, 1);
      assert.match(String(errors[0]), /slack is down/);
    });

    it("saves the comment when the PR can't be looked up, and reports it", async () => {
      const events: ReviewEvent[] = [];
      const { fake, errors, call, signIn, comment, state } = setup({
        onEvent: (event) => void events.push(event),
      });
      fake.port.getPull = async () => {
        throw new Error("github is down");
      };
      const ada = await signIn("ada");
      assert.equal(
        (await call("POST", ada, { body: comment("Cut off") })).status,
        200,
      );
      assert.equal((await state(ada)).items.length, 1);
      assert.deepEqual(events, []);
      assert.match(String(errors[0]), /github is down/);
    });

    it("answers before onEvent finishes when the host has waitUntil, and still runs it", async () => {
      let release!: () => void;
      const finished = new Promise<void>((resolve) => (release = resolve));
      const events: ReviewEvent[] = [];
      const deferred: Promise<unknown>[] = [];
      const { call, signIn, comment } = setup({
        onEvent: async (event) => {
          await finished;
          events.push(event);
        },
        waitUntil: (work) => void deferred.push(work),
      });
      const ada = await signIn("ada");

      const res = await call("POST", ada, { body: comment("Cut off") });
      assert.equal(res.status, 200, "answered while onEvent was still waiting");
      assert.equal(events.length, 0);
      assert.equal(deferred.length, 1);

      release();
      await Promise.all(deferred);
      assert.equal(events.length, 1);
    });

    it("asks GitHub about the PR once for a burst of events", async () => {
      const { fake, call, signIn, comment } = setup({ onEvent: () => {} });
      const ada = await signIn("ada");
      for (const text of ["one", "two", "three"]) {
        await call("POST", ada, { body: comment(text) });
      }
      assert.equal(fake.calls.getPull, 1);
    });
  });

  describe("with images as a function", () => {
    it("stores images where the host says, and links them from the comment", async () => {
      const uploads: UploadedImage[] = [];
      const { fake, call, signIn, comment, state } = setup({
        images: async (image) => {
          uploads.push(image);
          return `https://blob.test/${image.repo}/pr-${image.prNumber}/${image.name}`;
        },
      });
      const ada = await signIn("ada");

      const posted = await call("POST", ada, {
        body: comment("Cut off", {
          screenshots: [
            "data:image/jpeg;base64,AAAA",
            "data:image/jpeg;base64,/+8=",
          ],
        }),
      });
      assert.equal(posted.status, 200);
      const { itemId } = (await posted.json()) as { itemId: string };

      // the host got each image's bytes, with a unique name, and the PR it's for
      assert.deepEqual(
        uploads.map((u) => [u.repo, u.prNumber, u.contentType, [...u.bytes]]),
        [
          ["o/r", 7, "image/jpeg", [0, 0, 0]],
          ["o/r", 7, "image/jpeg", [255, 239]],
        ],
      );
      assert.notEqual(uploads[0]!.name, uploads[1]!.name);
      assert.match(
        uploads[0]!.name,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
      );

      // the comment links them, and the repo's branch isn't used
      assert.equal(fake.assets.length, 0);
      const { items } = await state(ada);
      assert.deepEqual(
        items[0]!.imageUrls,
        uploads.map((u) => `https://blob.test/o/r/pr-7/${u.name}`),
      );
      assert.match(
        fake.reviewBodies("o/r", 7)[0]!,
        /!\[screenshot\]\(https:\/\/blob\.test\//,
      );

      // they're public, so the server has nothing to serve for them
      assert.equal(
        (await call("GET", ada, { query: `/asset?id=${itemId}&n=0` })).status,
        404,
      );
    });

    it("doesn't post when the upload fails, and says so", async () => {
      const { fake, errors, call, signIn, comment, state } = setup({
        images: async () => {
          throw new Error("blob store is down");
        },
      });
      const ada = await signIn("ada");
      const res = await call("POST", ada, {
        body: comment("Cut off", {
          screenshots: ["data:image/jpeg;base64,AAAA"],
        }),
      });
      assert.ok(res.status >= 500);
      assert.equal((await state(ada)).items.length, 0);
      assert.equal(fake.reviewBodies("o/r", 7).length, 0);
      assert.ok(errors.length > 0);
    });
  });

  it("rejects invalid input", async () => {
    const { call, signIn, comment } = setup();
    const ada = await signIn("ada");
    assert.equal((await call("POST", ada, { body: { text: "" } })).status, 400);
    assert.equal(
      (
        await call("POST", ada, {
          body: comment("x", { screenshots: ["data:image/png;base64,AA"] }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("POST", ada, { query: "?reply_to=x", body: {} })).status,
      400,
    );
    assert.equal(
      (await call("PATCH", ada, { body: { resolved: true } })).status,
      400,
    );
    assert.equal((await call("DELETE", ada)).status, 400);
  });

  it("keeps every comment when people post at once", async () => {
    const { call, signIn, comment, state, fake } = setup({ latencyMs: 3 });
    const tokens = await Promise.all(
      ["ada", "grace", "linus", "ken"].map((who) => signIn(who)),
    );

    const results = await Promise.all(
      tokens.flatMap((token, i) => [
        call("POST", token, { body: comment(`comment ${i}a`) }),
        call("POST", token, { body: comment(`comment ${i}b`) }),
      ]),
    );
    assert.ok(results.every((res) => res.status === 200));

    const { items } = await state(tokens[0]!);
    assert.equal(items.length, 8);
    assert.equal(fake.refs.size, 0, "the lock was let go");
  });

  it("starts a second PR comment when the first is full", async () => {
    const { call, signIn, comment, state, fake } = setup();
    const ada = await signIn("ada");
    // a thread's console log is cut to 8k, so nine of them overflow one PR comment
    const heavy = (n: number) =>
      comment(`heavy ${n}`, {
        console: Array.from({ length: 100 }, () => ({
          level: "log",
          time: 1,
          message: "x".repeat(1900),
        })),
      });
    for (let n = 0; n < 9; n++) {
      assert.equal((await call("POST", ada, { body: heavy(n) })).status, 200);
    }

    const bodies = fake.reviewBodies("o/r", 7);
    assert.equal(bodies.length, 2, "a second comment was started");
    assert.ok(bodies.every((body) => body.length <= 60_000));
    // ...and the widget still sees all of them
    assert.equal((await state(ada)).items.length, 9);
  });

  it("reports what breaks", async () => {
    const { call, signIn, comment, fake, errors } = setup();
    const ada = await signIn("ada");
    fake.port.updateComment = async () => {
      throw new Error("GitHub is down");
    };
    await call("POST", ada, { body: comment("first") }); // creates (no update needed)
    const res = await call("POST", ada, { body: comment("second") }); // needs an update
    assert.equal(res.status, 502);
    assert.equal(errors.length, 1);
  });
});
