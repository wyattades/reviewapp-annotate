/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addReply,
  appendItem,
  COMMENT_MARKER,
  editItemText,
  editReplyText,
  formatItem,
  MAX_COMMENT_LENGTH,
  parseItems,
  removeItem,
  removeReply,
  setResolved,
  type ReviewItem,
  type ReviewReply,
} from "./comment";

const item = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "abc",
  author: "Ada Lovelace",
  authorId: "u1",
  text: "Button is cut off",
  pageUrl: "https://app.herokuapp.com/cart?x=1",
  selector: "body > button.buy",
  rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
  pageRect: { x: 40, y: 300, w: 200, h: 80 },
  createdAt: new Date("2026-10-19T12:34:56Z"),
  ...overrides,
});

const reply = (overrides: Partial<ReviewReply> = {}): ReviewReply => ({
  id: "r1",
  author: "Grace Hopper",
  avatar: null,
  authorId: "u2",
  text: "On it",
  createdAt: new Date("2026-10-19T13:00:00Z"),
  ...overrides,
});

/** Three threads: the first with a reply, a screenshot, a console log and two lines of text. */
const body = () => {
  const first = appendItem(
    null,
    item({
      id: "one",
      text: "First\nwith two lines",
      screenshotUrls: ["https://x/1.jpg"],
      consoleEntries: [{ level: "log", time: 1, message: "hi" }],
    }),
  )!;
  const second = appendItem(
    first,
    item({ id: "two", authorId: "u2", text: "Second" }),
  )!;
  const third = appendItem(second, item({ id: "three", text: "Third" }))!;
  return addReply(third, "one", reply())!;
};

const ids = (text: string) => parseItems(text).map((i) => i.id);

describe("formatItem", () => {
  it("makes a checklist item with one line of context", () => {
    const lines = formatItem(
      item({
        viewport: { width: 1024, height: 768 },
        elementText: "Buy now",
      }),
    ).split("\n");
    assert.match(
      lines[0]!,
      /^- \[ \] <!-- review-item:\S+ -->\*\*Button is cut off\*\*$/,
    );
    assert.equal(lines.length, 2);
    const meta = lines[1]!;
    assert.match(
      meta,
      /^ {2}- Ada Lovelace · \[\/cart\?x=1\]\(https:\/\/app\.herokuapp\.com\/cart\?x=1\)/,
    );
    assert.match(meta, /Oct 19, 12:34 UTC/);
    assert.match(meta, /📍 `body > button\.buy` "Buy now"/);
    assert.match(meta, /200×80 at \(40, 300\)/);
    assert.match(meta, /1024×768$/);
  });

  it("says pin for a point comment", () => {
    const text = formatItem(item({ pageRect: { x: 5, y: 6, w: 0, h: 0 } }));
    assert.match(text, /pin at \(5, 6\)/);
  });

  it("defangs mentions and code fences from untrusted text", () => {
    const text = formatItem(
      item({
        text: "ping @octocat",
        consoleEntries: [{ level: "error", time: 1500, message: "```boom" }],
      }),
    );
    assert.ok(!text.includes("@octocat"));
    assert.ok(!text.includes("```boom"));
    assert.match(text, /Console \(1, 1 errors\)/);
  });
});

describe("parseItems", () => {
  it("reads a thread back, with its author, place and replies", () => {
    const [first] = parseItems(body());
    assert.equal(first!.id, "one");
    assert.equal(first!.author, "Ada Lovelace");
    assert.equal(first!.authorId, "u1");
    assert.equal(first!.avatar, null);
    assert.equal(first!.selector, "body > button.buy");
    assert.deepEqual(first!.rect, { x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
    assert.deepEqual(first!.pageRect, { x: 40, y: 300, w: 200, h: 80 });
    assert.equal(first!.text, "First\nwith two lines");
    assert.equal(first!.resolved, false);
    assert.deepEqual(
      first!.replies.map((r) => [r.id, r.author, r.text]),
      [["r1", "Grace Hopper", "On it"]],
    );
  });

  it("reads every thread in order", () => {
    assert.deepEqual(ids(body()), ["one", "two", "three"]);
  });

  it("skips a line someone mangled", () => {
    const items = parseItems(
      "- [ ] <!-- review-item:!!! -->**x**\n- [ ] <!-- review-item:e30 -->",
    );
    assert.equal(items.length, 1);
  });
});

describe("appendItem", () => {
  it("starts a comment with the marker", () => {
    assert.ok(appendItem(null, item())!.startsWith(COMMENT_MARKER));
  });

  it("asks for a new comment when the existing one is full", () => {
    assert.equal(appendItem("x".repeat(MAX_COMMENT_LENGTH), item()), null);
  });
});

describe("setResolved", () => {
  it("ticks a thread off and back, leaving the others alone", () => {
    const ticked = setResolved(body(), "two", true)!;
    assert.deepEqual(
      parseItems(ticked).map((i) => i.resolved),
      [false, true, false],
    );
    const unticked = setResolved(ticked, "two", false)!;
    assert.equal(unticked, body());
  });

  it("is null for an unknown thread", () => {
    assert.equal(setResolved(body(), "nope", true), null);
  });
});

describe("addReply", () => {
  it("adds replies at the end of the right thread, in order", () => {
    const next = addReply(
      body(),
      "one",
      reply({ id: "r2", text: "Done\nin abc123" }),
    )!;
    const [first, second] = parseItems(next);
    assert.deepEqual(
      first!.replies.map((r) => r.id),
      ["r1", "r2"],
    );
    assert.equal(first!.replies[1]!.text, "Done\nin abc123");
    assert.equal(second!.replies.length, 0);
    assert.deepEqual(ids(next), ["one", "two", "three"]);
  });

  it("is null for an unknown thread, and throws when the comment is full", () => {
    assert.equal(addReply(body(), "nope", reply()), null);
    assert.throws(
      () =>
        addReply(
          body() + "\n" + "x".repeat(MAX_COMMENT_LENGTH),
          "one",
          reply(),
        ),
      /full/,
    );
  });
});

describe("removeItem", () => {
  it("removes the whole thread, replies included, keeping the others", () => {
    const next = removeItem(body(), "one")!;
    assert.deepEqual(ids(next), ["two", "three"]);
    for (const gone of ["First", "[log] hi", "1.jpg", "On it"]) {
      assert.ok(!next.includes(gone), gone);
    }
    assert.ok(next.includes("Second") && next.includes("Third"));
    assert.ok(next.startsWith(COMMENT_MARKER));
  });

  it("removes the last thread", () => {
    assert.deepEqual(ids(removeItem(body(), "three")!), ["one", "two"]);
  });

  it("keeps another thread's ticked-off state", () => {
    const next = removeItem(setResolved(body(), "three", true)!, "two")!;
    assert.deepEqual(
      parseItems(next).map((i) => i.resolved),
      [false, true],
    );
  });

  it("is null for an unknown thread, or when the check refuses", () => {
    assert.equal(removeItem(body(), "nope"), null);
    assert.equal(
      removeItem(body(), "one", (i) => i.authorId === "x"),
      null,
    );
    assert.ok(removeItem(body(), "one", (i) => i.authorId === "u1"));
  });
});

describe("removeReply", () => {
  it("removes just that reply", () => {
    const two = addReply(body(), "one", reply({ id: "r2", text: "a\nb" }))!;
    const next = removeReply(two, "one", "r2")!;
    assert.deepEqual(
      parseItems(next)[0]!.replies.map((r) => r.id),
      ["r1"],
    );
    assert.ok(!next.includes("a\n"));
    assert.deepEqual(ids(next), ["one", "two", "three"]);
  });

  it("is null for another thread's reply, or when the check refuses", () => {
    assert.equal(removeReply(body(), "two", "r1"), null);
    assert.equal(
      removeReply(body(), "one", "r1", (r) => r.authorId === "u1"),
      null,
    );
  });
});

describe("editItemText", () => {
  const edit = (id: string, text: string) =>
    editItemText(body(), id, text, () => true, "2026-10-19T14:00:00.000Z")!;

  it("changes the text and notes when, keeping everything else on the thread", () => {
    const next = edit("one", "Now one line");
    const [first] = parseItems(next);
    assert.equal(first!.text, "Now one line");
    assert.equal(first!.editedAt, "2026-10-19T14:00:00.000Z");
    assert.equal(first!.replies.length, 1);
    assert.ok(next.includes("1.jpg") && next.includes("[log] hi"));
    assert.ok(!next.includes("with two lines"));
    assert.deepEqual(ids(next), ["one", "two", "three"]);
  });

  it("can make a one-line thread longer, and keeps a ticked-off box ticked", () => {
    const ticked = setResolved(body(), "two", true)!;
    const next = editItemText(ticked, "two", "A\nB\nC", () => true, "t")!;
    const [, second] = parseItems(next);
    assert.equal(second!.text, "A\nB\nC");
    assert.equal(second!.resolved, true);
  });

  it("is null when the check refuses", () => {
    assert.equal(
      editItemText(body(), "one", "x", (i) => i.authorId === "x", "t"),
      null,
    );
  });
});

describe("editReplyText", () => {
  it("changes just that reply", () => {
    const next = editReplyText(
      body(),
      "one",
      "r1",
      "Fixed\nfor real",
      () => true,
      "t2",
    )!;
    const reply1 = parseItems(next)[0]!.replies[0]!;
    assert.equal(reply1.text, "Fixed\nfor real");
    assert.equal(reply1.editedAt, "t2");
    assert.deepEqual(ids(next), ["one", "two", "three"]);
  });

  it("is null when the check refuses", () => {
    assert.equal(
      editReplyText(body(), "one", "r1", "x", (r) => r.authorId === "x", "t"),
      null,
    );
  });
});
