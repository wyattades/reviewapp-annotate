/**
 * The PR comment that collects review-app feedback. One comment per PR (a
 * second one when the first fills up), with each thread a checklist item:
 *
 *     - [ ] <!-- review-item:DATA -->**What the commenter said**
 *       - Author · [/page](url) · when · 📍 `selector` · region · viewport
 *       - ![screenshot](url)
 *       - <details>console log</details>
 *       - ↩ <!-- reply:DATA -->**Someone** · when: a reply
 *
 * People and agents read it as markdown, and tick the box to resolve. The
 * widget reads the same lines back through the `DATA` (base64 JSON) markers.
 */

export const COMMENT_MARKER = "<!-- reviewapp-annotate -->";
/**
 * GitHub caps a comment at 65,536 characters. Replies and edits can grow a
 * comment up to this, leaving the rest for edits made on GitHub by hand.
 */
export const MAX_COMMENT_LENGTH = 64_000;
/**
 * Past this, a new thread starts a new comment: the rest is room for the
 * replies and edits the comment's threads still get.
 */
export const MAX_THREADS_LENGTH = 45_000;

/**
 * How agents and scripts can resolve and reply, hidden on GitHub. (An HTML
 * comment can't hold "-->", nor safely "--", so the commands use short flags.)
 */
const AGENT_NOTES = `<!--
Notes for agents and scripts (hidden on GitHub):
Each "- [ ]" item below is a thread someone left on this PR's review app with reviewapp-annotate. They see your changes there too.
To resolve a thread, change its "- [ ]" to "- [x]".
To reply, add a line at the end of the thread, indented two spaces:
  - ↩ **Your name** · Your reply
Edit this comment with the gh CLI:
  gh api repos/OWNER/REPO/issues/PR_NUMBER/comments -q '.[] | select(.body | startswith("<!-- reviewapp-annotate")) | .id'
  gh api repos/OWNER/REPO/issues/comments/COMMENT_ID -q .body > body.md
  gh api -X PATCH repos/OWNER/REPO/issues/comments/COMMENT_ID -F body=@body.md
Keep the hidden review-item and reply markers exactly as they are, and change nothing else.
-->`;

const HEADER = `${COMMENT_MARKER}
${AGENT_NOTES}
## 💬 Review-app comments

Tick an item once it's addressed.
`;

/** The comment's last line, after the threads. */
const FOOTER =
  "<sub>Made by [reviewapp-annotate](https://github.com/wyattades/reviewapp-annotate)</sub>";

/** A body without its footer (or as it was, from before there was one). */
const withoutFooter = (body: string) => {
  const trimmed = body.trimEnd();
  return trimmed.endsWith(FOOTER) ? trimmed.slice(0, -FOOTER.length) : trimmed;
};

import type { Rect, StoredItem, StoredReply } from "../shared";
import { decodeBase64Url, encodeBase64Url } from "./base64url";

export type { Rect, StoredItem, StoredReply };

/** What a thread line encodes: the rest is read from the comment itself. */
type ItemData = Omit<StoredItem, "resolved" | "replies" | "imageUrls">;

export type ConsoleEntry = {
  level: string;
  /** ms since the page loaded */
  time: number;
  message: string;
};

/** A new thread, with the extra context that goes in the markdown only. */
export type ReviewItem = Omit<ItemData, "createdAt" | "avatar"> & {
  avatar?: string | null;
  createdAt: Date;
  elementText?: string | null;
  viewport?: { width: number; height: number } | null;
  screenshotUrls?: string[];
  consoleEntries?: ConsoleEntry[];
};

export type ReviewReply = Omit<StoredReply, "createdAt"> & { createdAt: Date };

// --- encoding ---

const ITEM_LINE = /^- \[( |x|X)\] <!-- review-item:([A-Za-z0-9_-]+) -->/;
const REPLY_LINE = /^ {2}- ↩ <!-- reply:([A-Za-z0-9_-]+) -->/;
/** A reply written on GitHub, by hand or by an agent: `  - ↩ **Name** · text`. */
const PLAIN_REPLY_LINE = /^ {2}- ↩ (?!<!--)(.+)$/;
const PLAIN_REPLY = /^\*\*(.+?)\*\*\s*(?:[·:–—-]\s*)?([\s\S]*)$/;
const IMAGE_LINE = /^ {2}- !\[screenshot\]\((\S+)\)$/;
/** Further lines of a thread's text, and of a reply's. */
const ITEM_CONTINUATION = "  > ";
const REPLY_CONTINUATION = "    > ";

const encode = (data: object) => encodeBase64Url(JSON.stringify(data));

function decode<T>(data: string): T | null {
  try {
    return JSON.parse(decodeBase64Url(data)) as T;
  } catch {
    return null;
  }
}

/** No pings, mentions or links GitHub would auto-expand from untrusted text. */
const defang = (text: string) => text.replace(/@/g, "@​");

const oneLine = (text: string, max: number) => {
  const flat = defang(text.replace(/\s+/g, " ").trim());
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const inlineCode = (text: string) => `\`${text.replace(/`/g, "'")}\``;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Oct 19, 15:04 UTC": the markdown is static, so it can't say "5 minutes ago". */
const utc = (iso: string | Date) => {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};

const pagePath = (url: string) => {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
};

// --- reading ---

type Located = {
  /** index of the thread's first line */
  start: number;
  /** index after its last line */
  end: number;
  item: StoredItem;
};

/** The threads in a comment's lines, in order. A line someone mangled is skipped. */
function* scan(lines: string[]): Generator<Located> {
  for (let start = 0; start < lines.length; start++) {
    const match = ITEM_LINE.exec(lines[start]!);
    if (!match) continue;
    const data = decode<ItemData>(match[2]!);
    if (!data) continue;

    // a thread's other lines are indented two spaces (blank ones included)
    let end = start + 1;
    while (end < lines.length && lines[end]!.startsWith("  ")) end++;

    const replies: StoredReply[] = [];
    const imageUrls: string[] = [];
    /** a reply written on GitHub, whose text may go on over more lines */
    let plain: StoredReply | null = null;
    for (const line of lines.slice(start + 1, end)) {
      if (plain && line.startsWith(REPLY_CONTINUATION)) {
        plain.text += `\n${line.slice(REPLY_CONTINUATION.length)}`;
        continue;
      }
      plain = null;
      const reply = REPLY_LINE.exec(line);
      const replyData = reply && decode<StoredReply>(reply[1]!);
      if (replyData) replies.push(replyData);
      const written = !reply && PLAIN_REPLY_LINE.exec(line);
      if (written) {
        plain = plainReply(written[1]!);
        replies.push(plain);
      }
      const image = IMAGE_LINE.exec(line);
      if (image) imageUrls.push(image[1]!);
    }
    // a reply written on GitHub is known by what it says and where it is
    replies.forEach((reply, i) => {
      if (!reply.id)
        reply.id = `gh-${hash(`${reply.author}\n${reply.text}`)}-${i}`;
    });
    yield {
      start,
      end,
      item: { ...data, resolved: match[1] !== " ", replies, imageUrls },
    };
  }
}

/** A short, stable hash, for ids of replies written on GitHub. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A reply someone wrote on GitHub (`**Name** · text`, or just text). It has no
 * time; its id is given once its text is complete (see `scan`).
 */
function plainReply(content: string): StoredReply {
  const match = PLAIN_REPLY.exec(content.trim());
  const author = match?.[1]!.trim() || "GitHub";
  const text = (match ? match[2]! : content).trim();
  return {
    id: "",
    author,
    avatar: null,
    authorId: `github:${author}`,
    text,
    createdAt: "",
  };
}

const locate = (lines: string[], id: string) => {
  for (const found of scan(lines)) if (found.item.id === id) return found;
  return null;
};

/** The threads in a review comment, with whether each has been ticked off. */
export const parseItems = (body: string) =>
  [...scan(body.split("\n"))].map((found) => found.item);

// --- writing ---

const itemData = ({
  resolved: _resolved,
  replies: _replies,
  imageUrls: _imageUrls,
  ...data
}: StoredItem): ItemData => data;

/** The thread's first line, plus any further lines of its text. */
function headLines(data: ItemData, check = " ") {
  const [first, ...rest] = defang(data.text.trim()).split(/\n+/);
  return [
    `- [${check}] <!-- review-item:${encode(data)} -->**${first}**`,
    ...rest.map((line) => `${ITEM_CONTINUATION}${line}`),
  ];
}

function replyLines(reply: StoredReply) {
  const [first, ...rest] = defang(reply.text.trim()).split(/\n+/);
  return [
    `  - ↩ <!-- reply:${encode(reply)} -->**${defang(reply.author)}** · ${utc(reply.createdAt)}: ${first}`,
    ...rest.map((line) => `${REPLY_CONTINUATION}${line}`),
  ];
}

const MAX_CONSOLE_CHARS = 8_000;

function consoleDetails(entries: ConsoleEntry[]) {
  let body = entries
    .map((e) => `+${(e.time / 1000).toFixed(1)}s [${e.level}] ${e.message}`)
    .join("\n")
    .replace(/```/g, "`​``");
  if (body.length > MAX_CONSOLE_CHARS) {
    body = `…${body.slice(-MAX_CONSOLE_CHARS)}`;
  }
  const errors = entries.filter((e) => e.level === "error").length;
  return `<details><summary>Console (${entries.length}${errors ? `, ${errors} errors` : ""})</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>`;
}

/**
 * A rectangle's numbers to `decimals` places. The widget measures to 17 digits,
 * and a thread's data carries eight numbers: that's room in a comment for
 * nothing a person (or the page) could tell apart. A fraction of an element
 * needs 4 places (a pixel in 10,000); a position on the page needs none.
 */
function compactRect(rect: Rect, decimals: number): Rect {
  const scale = 10 ** decimals;
  const round = (n: number) => Math.round(n * scale) / scale;
  return {
    x: round(rect.x),
    y: round(rect.y),
    w: round(rect.w),
    h: round(rect.h),
  };
}

/** "W×H at (x, y)" for a region, "pin at (x, y)" for a click. */
function where({ x, y, w, h }: Rect) {
  return w || h
    ? `${Math.round(w)}×${Math.round(h)} at (${Math.round(x)}, ${Math.round(y)})`
    : `pin at (${Math.round(x)}, ${Math.round(y)})`;
}

export function formatItem(item: ReviewItem) {
  const { createdAt, elementText, viewport, screenshotUrls, consoleEntries } =
    item;
  const data: ItemData = {
    id: item.id,
    author: item.author,
    avatar: item.avatar ?? null,
    authorId: item.authorId,
    text: item.text,
    pageUrl: item.pageUrl,
    selector: item.selector,
    rect: compactRect(item.rect, 4),
    pageRect: compactRect(item.pageRect, 0),
    createdAt: createdAt.toISOString(),
  };

  const element = elementText ? ` "${oneLine(elementText, 60)}"` : "";
  const meta = [
    defang(item.author),
    `[${pagePath(item.pageUrl)}](${item.pageUrl})`,
    utc(createdAt),
    `📍 ${inlineCode(item.selector)}${element}`,
    where(item.pageRect),
    viewport && `${viewport.width}×${viewport.height}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines = [...headLines(data), `  - ${meta}`];
  for (const url of screenshotUrls ?? []) {
    lines.push(`  - ![screenshot](${url})`);
  }
  if (consoleEntries?.length) {
    const [first, ...rest] = consoleDetails(consoleEntries).split("\n");
    lines.push(`  - ${first}`, ...rest.map((line) => `    ${line}`));
  }
  return lines.join("\n");
}

/** The comment's new body, or null when the item doesn't fit and needs a new comment. */
export function appendItem(existingBody: string | null, item: ReviewItem) {
  const base = withoutFooter(existingBody ?? HEADER);
  // the footer stays last, after the newest thread
  const next = `${base.trimEnd()}\n\n${formatItem(item)}\n\n${FOOTER}\n`;
  return next.length > MAX_THREADS_LENGTH && existingBody ? null : next;
}

/** A changed body, unless it's grown too long for GitHub. */
function withinLimit(body: string) {
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new Error("The review comment is full");
  }
  return body;
}

/** Splices new lines over `lines[from, to)`, returning the body. */
const splice = (lines: string[], from: number, to: number, add: string[]) =>
  [...lines.slice(0, from), ...add, ...lines.slice(to)].join("\n");

// --- changing one thread: each returns the new body, or null when it can't ---

/** Adds a reply at the end of the thread. */
export function addReply(
  body: string,
  itemId: string,
  reply: ReviewReply,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  if (!found) return null;

  const next = splice(
    lines,
    found.end,
    found.end,
    replyLines({ ...reply, createdAt: reply.createdAt.toISOString() }),
  );
  return withinLimit(next);
}

/** Ticks or unticks the thread's checkbox. */
export function setResolved(
  body: string,
  itemId: string,
  resolved: boolean,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  if (!found) return null;
  lines[found.start] = lines[found.start]!.replace(
    /^- \[.\]/,
    `- [${resolved ? "x" : " "}]`,
  );
  return lines.join("\n");
}

/**
 * Removes a thread: its lines, and the blank line that separated it from the
 * next. `canRemove` sees it and can refuse, e.g. when it isn't the caller's.
 */
export function removeItem(
  body: string,
  itemId: string,
  canRemove: (item: StoredItem) => boolean = () => true,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  if (!found || !canRemove(found.item)) return null;
  const end = lines[found.end] === "" ? found.end + 1 : found.end;
  return splice(lines, found.start, end, []);
}

/** Changes the thread's text. */
export function editItemText(
  body: string,
  itemId: string,
  text: string,
  canEdit: (item: StoredItem) => boolean,
  editedAt: string,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  if (!found || !canEdit(found.item)) return null;

  let end = found.start + 1;
  while (lines[end]?.startsWith(ITEM_CONTINUATION)) end++;
  const check = found.item.resolved ? "x" : " ";
  return withinLimit(
    splice(
      lines,
      found.start,
      end,
      headLines({ ...itemData(found.item), text, editedAt }, check),
    ),
  );
}

/** Where a thread points on the page. */
export type ItemLocation = Pick<
  StoredItem,
  "selector" | "rect" | "pageRect"
> & {
  elementText?: string | null;
};

/** The meta line's "📍 `selector` "text"" and "W×H at (x, y)" parts. */
const META_ELEMENT = /📍 `[^`]*`(?: "[^"]*")?/;
const META_WHERE = /\d+×\d+ at \(-?\d+, -?\d+\)|pin at \(-?\d+, -?\d+\)/;

/**
 * Points the thread somewhere else on the page: its data, and the element and
 * region in its meta line. Screenshots stay as they were.
 */
export function moveItem(
  body: string,
  itemId: string,
  location: ItemLocation,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  if (!found) return null;

  let end = found.start + 1;
  while (lines[end]?.startsWith(ITEM_CONTINUATION)) end++;
  const check = found.item.resolved ? "x" : " ";
  const { selector, rect, pageRect, elementText } = location;
  const head = headLines(
    {
      ...itemData(found.item),
      selector,
      rect: compactRect(rect, 4),
      pageRect: compactRect(pageRect, 0),
    },
    check,
  );

  const meta = lines[end];
  const add = [...head];
  if (meta?.startsWith("  - ") && META_ELEMENT.test(meta)) {
    const element = elementText ? ` "${oneLine(elementText, 60)}"` : "";
    add.push(
      meta
        .replace(META_ELEMENT, `📍 ${inlineCode(selector)}${element}`)
        .replace(META_WHERE, where(pageRect)),
    );
    end++;
  }
  return withinLimit(splice(lines, found.start, end, add));
}

/** Where a reply's lines are within the comment's lines. */
function locateReply(lines: string[], found: Located, replyId: string) {
  for (let i = found.start + 1; i < found.end; i++) {
    const match = REPLY_LINE.exec(lines[i]!);
    const reply = match && decode<StoredReply>(match[1]!);
    if (reply?.id !== replyId) continue;
    let end = i + 1;
    while (lines[end]?.startsWith(REPLY_CONTINUATION)) end++;
    return { start: i, end, reply };
  }
  return null;
}

export function removeReply(
  body: string,
  itemId: string,
  replyId: string,
  canRemove: (reply: StoredReply) => boolean = () => true,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  const at = found && locateReply(lines, found, replyId);
  if (!at || !canRemove(at.reply)) return null;
  return splice(lines, at.start, at.end, []);
}

export function editReplyText(
  body: string,
  itemId: string,
  replyId: string,
  text: string,
  canEdit: (reply: StoredReply) => boolean,
  editedAt: string,
): string | null {
  const lines = body.split("\n");
  const found = locate(lines, itemId);
  const at = found && locateReply(lines, found, replyId);
  if (!at || !canEdit(at.reply)) return null;
  return withinLimit(
    splice(
      lines,
      at.start,
      at.end,
      replyLines({ ...at.reply, text, editedAt }),
    ),
  );
}
