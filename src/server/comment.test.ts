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
  MAX_THREADS_LENGTH,
  moveItem,
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

  it("reads each thread's images, and keeps them out of its data", () => {
    const [first, second] = parseItems(body());
    assert.deepEqual(first!.imageUrls, ["https://x/1.jpg"]);
    assert.deepEqual(second!.imageUrls, []);
    // editing re-encodes the thread: the images are still read from their own lines
    const edited = editItemText(body(), "one", "New", () => true, "t")!;
    assert.deepEqual(parseItems(edited)[0]!.imageUrls, ["https://x/1.jpg"]);
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

  it("keeps the footer last, however the threads change", () => {
    const footer =
      /\n\n<sub>Made by \[reviewapp-annotate\]\(https:\/\/github\.com\/wyattades\/reviewapp-annotate\)<\/sub>\n$/;
    const full = body();
    assert.match(full, footer);
    assert.equal(full.match(/Made by/g)!.length, 1);
    // a reply to the last thread goes above it, and the thread still reads back
    const replied = addReply(full, "three", reply({ id: "r9" }))!;
    assert.match(replied, footer);
    assert.deepEqual(
      parseItems(replied)
        .at(-1)!
        .replies.map((r) => r.id),
      ["r9"],
    );
    // removing the last thread leaves it
    assert.match(removeItem(full, "three")!, footer);
    // a comment from before there was a footer gets one
    const old = full.replace(footer, "\n");
    assert.match(appendItem(old, item({ id: "four" }))!, footer);
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

describe("written on GitHub", () => {
  /** inserts lines at the end of thread `id`, as someone editing the comment would */
  const writeUnder = (text: string, id: string, ...lines: string[]) => {
    const all = text.split("\n");
    const at = all.findIndex(
      (l) => l.includes(`review-item:`) && parseItems(l).at(0)?.id === id,
    );
    let end = at + 1;
    while (all[end]?.startsWith("  ")) end++;
    all.splice(end, 0, ...lines);
    return all.join("\n");
  };

  it("tells agents how to resolve and reply, out of sight", () => {
    const fresh = appendItem(null, item())!;
    const notes = fresh.slice(
      fresh.indexOf("<!--\n"),
      fresh.indexOf("-->", fresh.indexOf("<!--\n")) + 3,
    );
    assert.match(notes, /change its "- \[ \]" to "- \[x\]"/);
    assert.match(notes, /  - ↩ \*\*Your name\*\* · Your reply/);
    assert.match(notes, /gh api -X PATCH/);
    // nothing in it ends the HTML comment early
    assert.equal(notes.indexOf("-->"), notes.length - 3);
    // and it isn't mistaken for a thread
    assert.deepEqual(ids(fresh), ["abc"]);
  });

  it("reads a reply someone wrote by hand, after the ones from the widget", () => {
    const text = writeUnder(
      body(),
      "one",
      "  - ↩ **Claude** · Fixed in abc123",
      "    > and added a test",
    );
    const [first, second] = parseItems(text);
    assert.deepEqual(
      first!.replies.map((r) => [r.author, r.text, r.createdAt]),
      [
        ["Grace Hopper", "On it", "2026-10-19T13:00:00.000Z"],
        ["Claude", "Fixed in abc123\nand added a test", ""],
      ],
    );
    assert.equal(first!.replies[1]!.authorId, "github:Claude");
    assert.deepEqual(second!.replies, []);
  });

  it("takes a reply with no name, and gives each a stable id", () => {
    const text = writeUnder(body(), "two", "  - ↩ Done", "  - ↩ Done");
    const replies = parseItems(text)[1]!.replies;
    assert.deepEqual(
      replies.map((r) => [r.author, r.text]),
      [
        ["GitHub", "Done"],
        ["GitHub", "Done"],
      ],
    );
    assert.notEqual(replies[0]!.id, replies[1]!.id);
    assert.deepEqual(
      parseItems(text)[1]!.replies.map((r) => r.id),
      replies.map((r) => r.id),
    );
  });

  it("keeps a hand-written reply when the widget replies after it", () => {
    const text = writeUnder(body(), "two", "  - ↩ **Claude** · Fixed");
    const next = addReply(text, "two", reply({ id: "r2", text: "Thanks" }))!;
    assert.deepEqual(
      parseItems(next)[1]!.replies.map((r) => r.text),
      ["Fixed", "Thanks"],
    );
  });

  it("reads a box ticked on GitHub as resolved", () => {
    const ticked = body().replace(
      "- [ ] <!-- review-item:",
      "- [x] <!-- review-item:",
    );
    assert.equal(parseItems(ticked)[0]!.resolved, true);
  });
});

describe("room to grow", () => {
  it("starts a new comment for a thread well before GitHub's limit, keeping room for replies", () => {
    assert.ok(MAX_THREADS_LENGTH + 15_000 <= MAX_COMMENT_LENGTH);
    assert.ok(MAX_COMMENT_LENGTH < 65_536);
    const busy =
      appendItem(null, item({ id: "one" }))! + "x".repeat(MAX_THREADS_LENGTH);
    assert.equal(appendItem(busy, item({ id: "two" })), null);
    // ...while its threads can still get replies
    assert.ok(addReply(busy, "one", reply()));
  });
});

describe("rounded rectangles", () => {
  const long = {
    rect: {
      x: 0.09597475165562915,
      y: 0.6225702962823174,
      w: 0.29974648178807944,
      h: 0.2143800717116437,
    },
    pageRect: { x: 100.984375, y: 215.8671875, w: 90.5234375, h: 35.5 },
  };

  it("keeps a thread's numbers short: 4 places for a fraction, whole pixels for the page", () => {
    const [stored] = parseItems(appendItem(null, item(long))!);
    assert.deepEqual(stored!.rect, {
      x: 0.096,
      y: 0.6226,
      w: 0.2997,
      h: 0.2144,
    });
    assert.deepEqual(stored!.pageRect, { x: 101, y: 216, w: 91, h: 36 });
  });

  it("keeps a pin a pin, and a region a region", () => {
    const pin = parseItems(
      appendItem(
        null,
        item({
          rect: { x: 0.5, y: 0.5, w: 0, h: 0 },
          pageRect: { x: 10.4, y: 20.6, w: 0, h: 0 },
        }),
      )!,
    )[0]!;
    assert.deepEqual(pin.pageRect, { x: 10, y: 21, w: 0, h: 0 });
    // the smallest drag the widget takes for a region is 8 pixels
    const small = parseItems(
      appendItem(null, item({ pageRect: { x: 0, y: 0, w: 8.2, h: 3 } }))!,
    )[0]!;
    assert.ok(small.pageRect.w >= 8);
  });

  it("rounds a moved thread too, and leaves older threads' numbers alone", () => {
    const before = body();
    const moved = moveItem(before, "two", { selector: "main", ...long })!;
    const [first, second] = parseItems(moved);
    assert.deepEqual(second!.pageRect, { x: 101, y: 216, w: 91, h: 36 });
    assert.deepEqual(second!.rect, {
      x: 0.096,
      y: 0.6226,
      w: 0.2997,
      h: 0.2144,
    });
    assert.deepEqual(first, parseItems(before)[0]);
  });

  it("leaves no long numbers in the hidden data", () => {
    const text = appendItem(null, item(long))!;
    const marker = /review-item:([A-Za-z0-9_-]+)/.exec(text)![1]!;
    const json = Buffer.from(marker, "base64url").toString();
    assert.ok(json.includes('"x":0.096'), json);
    assert.ok(!/\d\.\d{5,}/.test(json), json);
  });
});

describe("moveItem", () => {
  const to = {
    selector: "main > div.card",
    rect: { x: 0, y: 0.5, w: 1, h: 0.25 },
    pageRect: { x: 10, y: 640, w: 320, h: 60 },
    elementText: "Card title",
  };

  it("points the thread elsewhere: its data and its meta line, nothing else", () => {
    const before = body();
    const next = moveItem(before, "one", to)!;
    const [first] = parseItems(next);
    assert.equal(first!.selector, "main > div.card");
    assert.deepEqual(first!.rect, to.rect);
    assert.deepEqual(first!.pageRect, to.pageRect);
    assert.equal(first!.text, "First\nwith two lines");
    assert.equal(first!.replies.length, 1);
    assert.ok(next.includes('📍 `main > div.card` "Card title"'));
    assert.ok(next.includes("320×60 at (10, 640)"));
    // the screenshot and console log stay
    assert.ok(next.includes("1.jpg") && next.includes("[log] hi"));
    // the other threads are untouched
    assert.equal(next.split("\n").length, before.split("\n").length);
    assert.deepEqual(parseItems(next).slice(1), parseItems(before).slice(1));
  });

  it("keeps a ticked-off box ticked, and turns a region into a pin", () => {
    const ticked = setResolved(body(), "two", true)!;
    const next = moveItem(ticked, "two", {
      ...to,
      pageRect: { x: 5, y: 6, w: 0, h: 0 },
      elementText: null,
    })!;
    const [, second] = parseItems(next);
    assert.equal(second!.resolved, true);
    assert.ok(next.includes("📍 `main > div.card` · pin at (5, 6)"));
  });

  it("is null for an unknown thread", () => {
    assert.equal(moveItem(body(), "nope", to), null);
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
