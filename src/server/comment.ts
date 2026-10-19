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
/** GitHub caps a comment at 65,536 characters; leave room for edits. */
export const MAX_COMMENT_LENGTH = 60_000;

const HEADER = `${COMMENT_MARKER}
## 💬 Review-app comments

Left on the review app with reviewapp-annotate. Tick an item once it's addressed.
`;

import type { Rect, StoredItem, StoredReply } from "../shared";
import { decodeBase64Url, encodeBase64Url } from "./base64url";

export type { Rect, StoredItem, StoredReply };

type ItemData = Omit<StoredItem, "resolved" | "replies">;

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
    for (const line of lines.slice(start + 1, end)) {
      const reply = REPLY_LINE.exec(line);
      const replyData = reply && decode<StoredReply>(reply[1]!);
      if (replyData) replies.push(replyData);
    }
    yield {
      start,
      end,
      item: { ...data, resolved: match[1] !== " ", replies },
    };
  }
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
    rect: item.rect,
    pageRect: item.pageRect,
    createdAt: createdAt.toISOString(),
  };

  const { x, y, w, h } = item.pageRect;
  const where =
    w || h
      ? `${Math.round(w)}×${Math.round(h)} at (${Math.round(x)}, ${Math.round(y)})`
      : `pin at (${Math.round(x)}, ${Math.round(y)})`;
  const element = elementText ? ` "${oneLine(elementText, 60)}"` : "";
  const meta = [
    defang(item.author),
    `[${pagePath(item.pageUrl)}](${item.pageUrl})`,
    utc(createdAt),
    `📍 ${inlineCode(item.selector)}${element}`,
    where,
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
  const base = existingBody ?? HEADER;
  const next = `${base.trimEnd()}\n\n${formatItem(item)}\n`;
  return next.length > MAX_COMMENT_LENGTH && existingBody ? null : next;
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
  if (next.length > MAX_COMMENT_LENGTH) {
    throw new Error("The review comment is full");
  }
  return next;
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
  return splice(
    lines,
    found.start,
    end,
    headLines({ ...itemData(found.item), text, editedAt }, check),
  );
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
  return splice(
    lines,
    at.start,
    at.end,
    replyLines({ ...at.reply, text, editedAt }),
  );
}
