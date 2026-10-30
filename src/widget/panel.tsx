import { Avatar } from "./avatar";
import { pageKey } from "./geometry";
import { CheckCircleIcon } from "./icons";
import { formatTime } from "./time";
import type { ShownItem } from "./types";

/** Everyone's threads on the PR, across pages. */
export function Panel({
  style,
  commentUrl,
  prNumber,
  items,
  onHover,
  onUnhover,
  onPick,
}: {
  style: Record<string, string | number>;
  /** the PR comment the threads are collected in */
  commentUrl: string;
  prNumber: number;
  items: ShownItem[];
  onHover: (id: string) => void;
  onUnhover: () => void;
  onPick: (item: ShownItem) => void;
}) {
  const open = items.filter((item) => !item.resolved);
  const resolved = items.filter((item) => item.resolved);
  const header = (
    <div class="head">
      <span class="muted">
        {open.length} open
        {resolved.length > 0 && ` · ${resolved.length} resolved`}
      </span>
      <a href={commentUrl} target="_blank" rel="noreferrer">
        PR #{prNumber} on GitHub ↗
      </a>
    </div>
  );

  if (!items.length) {
    return (
      <div class="panel card" style={style}>
        {header}
        <div class="empty">No comments yet.</div>
      </div>
    );
  }

  const row = (item: ShownItem) => {
    const replies = item.replies.length;
    return (
      <button
        key={item.id}
        type="button"
        class={`item${item.resolved ? " resolved" : ""}`}
        onPointerEnter={() => onHover(item.id)}
        onPointerLeave={onUnhover}
        onClick={() => onPick(item)}
      >
        <Avatar name={item.author} src={item.avatar} size={24} />
        <div>
          <div class="body">{item.text}</div>
          <div class="muted">
            {item.resolved && (
              <span class="badge" title="Resolved">
                <CheckCircleIcon />
              </span>
            )}
            {item.author} · {formatTime(item.createdAt)}
            {replies > 0 && ` · ${replies} repl${replies === 1 ? "y" : "ies"}`}
            {pageKey(item.pageUrl) === pageKey(location.href)
              ? ""
              : ` · ${new URL(item.pageUrl, location.href).pathname}`}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div class="panel card" style={style}>
      {header}
      {open.map(row)}
      {resolved.length > 0 && <div class="section">Resolved</div>}
      {resolved.map(row)}
    </div>
  );
}
