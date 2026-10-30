// The playground's PR page (pr.html): the review comment the server would
// write for the fake API's threads, built with the server's own formatter
// (src/server/comment.ts) and rendered like GitHub. It redraws as threads
// change, here or in the app; ticking a box resolves the thread, as on GitHub,
// and the comment can be edited and saved, as an agent with the gh CLI would.
import { marked } from "marked";
import {
  addReply,
  appendItem,
  MAX_COMMENT_LENGTH,
  MAX_THREADS_LENGTH,
  parseItems,
  setResolved,
  type ConsoleEntry,
  type StoredItem,
  type StoredReply,
} from "../src/server/comment";

/** A thread as the fake API keeps it: what the widget sees, plus what only the PR comment shows. */
type Thread = StoredItem & {
  elementText?: string | null;
  viewport?: { width: number; height: number } | null;
  consoleEntries?: ConsoleEntry[];
};

declare global {
  interface Window {
    playground: {
      threads: () => Thread[];
      setResolved: (id: string, resolved: boolean) => void;
      applyEdit: (threads: StoredItem[]) => void;
    };
  }
}

/**
 * What screenshot `n` links to in a real comment: a file on the assets branch.
 * Each is unique, and as long as the real server's links.
 */
const realLink = (n: number) =>
  `https://github.com/lumen/web/blob/reviewapp-annotate-assets/pr-128/1792442899085-${String(n).padStart(8, "0")}.jpg?raw=true`;

/**
 * The review comment's markdown as the server would write it (null before the
 * first thread), and the playground's images by the links standing in for them.
 */
function markdownFor(threads: Thread[]) {
  const images = new Map<string, string>();
  let body: string | null = null;
  for (const thread of threads) {
    const screenshotUrls = thread.imageUrls.map((dataUrl) => {
      const link = realLink(images.size);
      images.set(link, dataUrl);
      return link;
    });
    body =
      appendItem(body, {
        ...thread,
        createdAt: new Date(thread.createdAt),
        screenshotUrls,
      }) ?? body;
    for (const reply of thread.replies) {
      body = reply.createdAt
        ? (addReply(body!, thread.id, {
            ...reply,
            createdAt: new Date(reply.createdAt),
          }) ?? body)
        : writtenOnGitHub(body!, thread.id, reply);
    }
    if (thread.resolved) body = setResolved(body!, thread.id, true) ?? body;
  }
  return { markdown: body, images };
}

/** A reply someone wrote on GitHub goes back as the plain line it was written as. */
function writtenOnGitHub(body: string, threadId: string, reply: StoredReply) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => parseItems(line)[0]?.id === threadId);
  if (start < 0) return body;
  let end = start + 1;
  while (lines[end]?.startsWith("  ")) end++;
  const [first, ...rest] = reply.text.split("\n");
  lines.splice(
    end,
    0,
    `  - ↩ **${reply.author}** · ${first}`,
    ...rest.map((line) => `    > ${line}`),
  );
  return lines.join("\n");
}

const item = document.getElementById("review-comment")!;
const body = item.querySelector<HTMLElement>(".comment-body")!;
const when = item.querySelector<HTMLElement>(".when")!;
const editButton = item.querySelector<HTMLButtonElement>(".kebab")!;
/** the markdown being edited, or null when the comment is showing */
let editing: string | null = null;

/** "5 minutes ago", as GitHub puts it */
function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

/** Markdown as GitHub shows it, with the playground's images in place of the links that stand in for them. */
function toHtml(markdown: string, images: Map<string, string>) {
  let shown = markdown;
  for (const [link, dataUrl] of images) shown = shown.replace(link, dataUrl);
  return marked.parse(shown, { gfm: true }) as string;
}

function render() {
  const threads = window.playground.threads();
  const { markdown, images } = markdownFor(threads);
  // no threads, no review comment
  item.hidden = !markdown;
  if (!markdown) return;
  const first = threads.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
  when.textContent = `commented ${ago(first.createdAt)} · edited`;

  if (editing === null) {
    body.className = "comment-body markdown-body";
    body.innerHTML = toHtml(markdown, images);
    // GitHub's task-list boxes: one per thread, in order
    body
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((box, i) => {
        const thread = threads[i];
        if (!thread) return;
        box.disabled = false;
        box.addEventListener("change", () =>
          window.playground.setResolved(thread.id, box.checked),
        );
      });
  } else if (!body.querySelector(".editor")) {
    // as GitHub edits a comment: Write and Preview, then Update
    body.className = "comment-body editor";
    body.innerHTML = `
      <div class="tabs"><button class="on" data-tab="write">Write</button><button data-tab="preview">Preview</button></div>
      <textarea spellcheck="false"></textarea>
      <div class="preview markdown-body" hidden></div>
      <div class="row"><button class="btn" data-do="cancel">Cancel</button><button class="btn primary" data-do="update">Update comment</button></div>`;
    const field = body.querySelector("textarea")!;
    const preview = body.querySelector<HTMLElement>(".preview")!;
    field.value = editing;
    field.addEventListener("input", () => (editing = field.value));
    for (const tab of body.querySelectorAll<HTMLButtonElement>("[data-tab]"))
      tab.addEventListener("click", () => {
        const write = tab.dataset.tab === "write";
        body
          .querySelectorAll("[data-tab]")
          .forEach((t) => t.classList.toggle("on", t === tab));
        field.hidden = !write;
        preview.hidden = write;
        if (!write) preview.innerHTML = toHtml(field.value, images);
      });
    body.querySelector<HTMLButtonElement>('[data-do="cancel"]')!.onclick =
      () => {
        editing = null;
        render();
      };
    // "saving on GitHub": what the server would read back from the edited comment
    body.querySelector<HTMLButtonElement>('[data-do="update"]')!.onclick =
      () => {
        window.playground.applyEdit(parseItems(field.value));
        editing = null;
        render();
      };
  }

  // the comment's size, for the playground's toolbar: as GitHub would count
  // it, with real links rather than the playground's data URLs
  const note = document.getElementById("playground-note");
  if (note)
    note.textContent = `${threads.length} ${threads.length === 1 ? "thread" : "threads"} · ${markdown.length.toLocaleString()} / ${MAX_THREADS_LENGTH.toLocaleString()} chars (replies to ${MAX_COMMENT_LENGTH.toLocaleString()})`;
}

editButton.addEventListener("click", () => {
  if (editing !== null) return;
  editing = markdownFor(window.playground.threads()).markdown ?? "";
  render();
});

/** GitHub's default avatar: a 5×5 pattern, mirrored, in one color from the login. */
function identicon(login: string) {
  let hash = 2166136261;
  for (const char of login)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const color = `hsl(${hash % 360} 55% 58%)`;
  let cells = "";
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      if (!((hash >>> (y * 3 + x)) & 1)) continue;
      for (const at of new Set([x, 4 - x]))
        cells += `<rect x="${at + 1}" y="${y + 1}" width="1.02" height="1.02"/>`;
    }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7"><rect width="7" height="7" fill="#f0f0f0"/><g fill="${color}">${cells}</g></svg>`)}`;
}

const bots: Record<string, string> = {
  vercel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#000"/><path d="M20 11 30 28H10z" fill="#fff"/></svg>`,
  // the GitHub App the server runs as: the widget's own colors and comment icon
  review: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1c1917"/><path d="M29 24a2 2 0 0 1-2 2H15l-4 4V12a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="#d4a83a" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
};
for (const img of document.querySelectorAll<HTMLImageElement>("[data-avatar]"))
  img.src = identicon(img.dataset.avatar!);
for (const img of document.querySelectorAll<HTMLImageElement>("[data-bot]"))
  img.src = `data:image/svg+xml,${encodeURIComponent(bots[img.dataset.bot!]!)}`;

window.addEventListener("playground-change", render);
render();
// the toolbar's note: it's added after this script
addEventListener("DOMContentLoaded", render);
