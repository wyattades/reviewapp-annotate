// The playground's PR comment preview: the review comment the server would
// write for the fake API's threads, built with the server's own formatter
// (src/server/comment.ts) and rendered like GitHub. It redraws as threads
// change; ticking a box resolves the thread, as on GitHub, and the Markdown
// tab can be edited and saved, as an agent with the gh CLI would.
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
  `https://github.com/acme/web/blob/reviewapp-annotate-assets/pr-128/1792442899085-${String(n).padStart(8, "0")}.jpg?raw=true`;

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

const panel = document.getElementById("pr-comment")!;
const rendered = panel.querySelector<HTMLElement>(".rendered")!;
const editor = panel.querySelector<HTMLTextAreaElement>(".source textarea")!;
const save = panel.querySelector<HTMLButtonElement>(".source .save")!;
/** the comment as last drawn, to tell whether the editor has unsaved changes */
let lastMarkdown = "";
const updated = panel.querySelector<HTMLElement>(".updated")!;

function render() {
  const threads = window.playground.threads();
  const { markdown, images } = markdownFor(threads);
  if (!markdown) {
    rendered.innerHTML = `<p class="empty">No review comment yet: the first thread starts it.</p>`;
    editor.value = lastMarkdown = "";
  } else {
    // the real server's links point at the repo; show the playground's own images
    let shown = markdown;
    for (const [link, dataUrl] of images) shown = shown.replace(link, dataUrl);
    rendered.innerHTML = marked.parse(shown, { gfm: true }) as string;
    // don't throw away what's being typed
    if (editor.value === lastMarkdown) editor.value = markdown;
    lastMarkdown = markdown;
    // GitHub's task-list boxes: one per thread, in order
    rendered
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((box, i) => {
        const thread = threads[i];
        if (!thread) return;
        box.disabled = false;
        box.title = box.checked ? "Reopen" : "Resolve";
        box.addEventListener("change", () =>
          window.playground.setResolved(thread.id, box.checked),
        );
      });
  }
  // as GitHub would count it: with real links, not the playground's data URLs
  const length = markdown?.length ?? 0;
  updated.textContent = `${threads.length} ${threads.length === 1 ? "thread" : "threads"} · ${length.toLocaleString()} characters: new threads start a new comment past ${MAX_THREADS_LENGTH.toLocaleString()}, replies fit up to ${MAX_COMMENT_LENGTH.toLocaleString()}`;
}

for (const tab of panel.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  tab.addEventListener("click", () => {
    panel.dataset.view = tab.dataset.view;
  });
}

// "saving on GitHub": what the server would read back from the edited comment
save.addEventListener("click", () => {
  window.playground.applyEdit(parseItems(editor.value));
  lastMarkdown = editor.value;
  render();
});

window.addEventListener("playground-change", render);
render();
