/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredItem, StoredReply } from "../shared";
import type { ReviewEvent } from "./events";
import {
  recipientsFor,
  slackMessage,
  slackNotifier,
  type Recipient,
  type SlackMessage,
} from "./slack";

const reply = (overrides: Partial<StoredReply> = {}): StoredReply => ({
  id: "r1",
  author: "Ada",
  avatar: null,
  authorId: "ada",
  text: "On it, pushing now.",
  createdAt: "2026-10-21T18:31:00.000Z",
  ...overrides,
});

const thread = (overrides: Partial<StoredItem> = {}): StoredItem => ({
  id: "t1",
  author: "Grace",
  avatar: null,
  authorId: "grace",
  text: "This button wraps on smaller screens.",
  pageUrl: "https://web-git-new-pricing.vercel.app/pricing?plan=team",
  selector: "div.plan.pop > div.btn",
  rect: { x: 0, y: 0, w: 1, h: 1 },
  pageRect: { x: 0, y: 0, w: 10, h: 10 },
  createdAt: "2026-10-21T18:14:00.000Z",
  resolved: false,
  replies: [],
  imageUrls: [],
  ...overrides,
});

const common = {
  pull: {
    number: 128,
    title: "Redesign pricing page",
    url: "https://github.com/acme/web/pull/128",
    author: { login: "ahanthorn", type: "User" },
  },
  thread: thread(),
  actor: { id: "grace", name: "Grace Hopper" },
  participants: [],
  links: {
    thread: "https://github.com/acme/web/pull/128#issuecomment-55",
    page: "https://web-git-new-pricing.vercel.app/pricing?plan=team",
  },
};

const created = (overrides: Partial<ReviewEvent> = {}) =>
  ({ type: "thread-created", ...common, ...overrides }) as ReviewEvent;
const replied = (overrides: Partial<ReviewEvent> = {}) =>
  ({
    type: "reply-added",
    ...common,
    actor: { id: "ada", name: "Ada Lovelace" },
    reply: reply(),
    participants: [{ id: "grace", name: "Grace Hopper" }],
    ...overrides,
  }) as ReviewEvent;
const resolved = () =>
  ({ type: "thread-resolved", resolved: true, ...common }) as ReviewEvent;

describe("recipientsFor", () => {
  it("tells the PR's author about a new thread", () => {
    assert.deepEqual(recipientsFor(created()), [
      { kind: "github", login: "ahanthorn" },
    ]);
  });

  it("tells no one about a thread on a bot's PR, or a PR whose author's account is gone", () => {
    const bot = created({
      pull: { ...common.pull, author: { login: "cursor[bot]", type: "Bot" } },
    });
    assert.deepEqual(recipientsFor(bot), []);
    assert.deepEqual(
      recipientsFor(created({ pull: { ...common.pull, author: null } })),
      [],
    );
  });

  it("tells the others in a thread about a reply, and not the PR's author unless they're in it", () => {
    assert.deepEqual(recipientsFor(replied()), [{ kind: "user", id: "grace" }]);
    assert.deepEqual(
      recipientsFor(
        replied({
          participants: [
            { id: "grace", name: "Grace" },
            { id: "kai", name: "Kai" },
          ],
        }),
      ),
      [
        { kind: "user", id: "grace" },
        { kind: "user", id: "kai" },
      ],
    );
  });

  it("tells no one about a thread ticked off", () => {
    assert.deepEqual(recipientsFor(resolved()), []);
  });
});

describe("slackMessage", () => {
  const texts = (message: SlackMessage) => JSON.stringify(message.blocks);

  it("says who commented on which PR, quotes it, and links the thread and the page", () => {
    const message = slackMessage(created(), { youArePrAuthor: true })!;
    const blocks = texts(message);
    assert.match(
      message.text,
      /Grace Hopper commented on Redesign pricing page #128/,
    );
    assert.match(
      blocks,
      /\*Grace Hopper\* commented on your pull request <https:\/\/github.com\/acme\/web\/pull\/128\|Redesign pricing page #128>/,
    );
    assert.match(blocks, /> This button wraps on smaller screens\./);
    assert.match(
      blocks,
      /Review app comment · \/pricing\?plan=team · `div.plan.pop > div.btn`/,
    );
    assert.match(
      blocks,
      /"url":"https:\/\/github.com\/acme\/web\/pull\/128#issuecomment-55"/,
    );
    assert.match(
      blocks,
      /"url":"https:\/\/web-git-new-pricing.vercel.app\/pricing\?plan=team"/,
    );
  });

  it("says 'a thread you're in' for a reply, and what it replies to", () => {
    const blocks = texts(slackMessage(replied())!);
    assert.match(blocks, /\*Ada Lovelace\* replied in a thread you're in, on /);
    assert.match(blocks, /> On it, pushing now\./);
    assert.match(
      blocks,
      /Replying to “This button wraps on smaller screens\.” · \/pricing/,
    );
  });

  it("escapes what Slack would read as markup, and shortens a long quote", () => {
    const message = slackMessage(
      created({
        thread: thread({ text: `<!channel> a & b ${"x".repeat(400)}` }),
      }),
    )!;
    const blocks = texts(message);
    assert.match(blocks, /&lt;!channel&gt; a &amp; b/);
    assert.doesNotMatch(blocks, /<!channel>/);
    const quoted = JSON.parse(blocks)[1].text.text as string;
    assert.ok(quoted.length < 320 && quoted.endsWith("…"));
  });

  it("shows the screenshot when it's somewhere Slack can fetch it, not when it's in the repo", () => {
    const withImage = (url: string) =>
      texts(slackMessage(created({ thread: thread({ imageUrls: [url] }) }))!);
    assert.match(
      withImage("https://abc.public.blob.vercel-storage.com/a.jpg"),
      /"type":"image","image_url":"https:\/\/abc.public/,
    );
    assert.doesNotMatch(
      withImage(
        "https://github.com/acme/web/blob/assets/pr-128/a.jpg?raw=true",
      ),
      /"type":"image"/,
    );
  });

  it("has nothing to say about a thread ticked off", () => {
    assert.equal(slackMessage(resolved()), null);
  });
});

describe("slackNotifier", () => {
  /** Slack ids by person; the PR's author and the commenters are different accounts */
  const slackIds: Record<string, string> = {
    "github:ahanthorn": "UADA",
    "user:ada": "UADA",
    "user:grace": "UGRACE",
    "user:kai": "UKAI",
  };
  const resolveSlackUser = (who: Recipient) =>
    slackIds[
      who.kind === "github" ? `github:${who.login}` : `user:${who.id}`
    ] ?? null;

  const setup = (failFor: string[] = []) => {
    const sent: (SlackMessage & { channel: string })[] = [];
    const notify = slackNotifier({
      resolveSlackUser,
      send: async (message) => {
        if (failFor.includes(message.channel)) throw new Error("boom");
        sent.push(message);
      },
    });
    return { sent, notify };
  };

  it("sends a new thread to the PR's author", async () => {
    const { sent, notify } = setup();
    await notify(created());
    assert.deepEqual(
      sent.map((m) => m.channel),
      ["UADA"],
    );
    assert.match(JSON.stringify(sent[0]!.blocks), /on your pull request/);
  });

  it("doesn't tell the PR's author about their own comment, though it's a different id", async () => {
    const { sent, notify } = setup();
    await notify(created({ actor: { id: "ada", name: "Ada Lovelace" } }));
    assert.deepEqual(sent, []);
  });

  it("sends a reply to each other person in the thread, once, and not the one who wrote it", async () => {
    const { sent, notify } = setup();
    await notify(
      replied({
        participants: [
          { id: "grace", name: "Grace" },
          { id: "kai", name: "Kai" },
          { id: "ada", name: "Ada" },
        ],
      }),
    );
    assert.deepEqual(sent.map((m) => m.channel).sort(), ["UGRACE", "UKAI"]);
  });

  it("skips people with no Slack account", async () => {
    const { sent, notify } = setup();
    await notify(
      replied({
        participants: [
          { id: "stranger", name: "Stranger" },
          { id: "kai", name: "Kai" },
        ],
      }),
    );
    assert.deepEqual(
      sent.map((m) => m.channel),
      ["UKAI"],
    );
  });

  it("sends nothing for a thread ticked off", async () => {
    const { sent, notify } = setup();
    await notify(resolved());
    assert.deepEqual(sent, []);
  });

  it("tries everyone when one send fails, then says so", async () => {
    const { sent, notify } = setup(["UGRACE"]);
    await assert.rejects(
      notify(
        replied({
          participants: [
            { id: "grace", name: "Grace" },
            { id: "kai", name: "Kai" },
          ],
        }),
      ),
      /Couldn't tell 1 of 2 on Slack/,
    );
    assert.deepEqual(
      sent.map((m) => m.channel),
      ["UKAI"],
    );
  });
});
