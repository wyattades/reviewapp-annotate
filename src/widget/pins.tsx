import { Avatar } from "./avatar";
import { hasRegion, locateItem, pageKey } from "./geometry";
import { CheckCircleIcon } from "./icons";
import { formatTime } from "./time";
import type { Rect, ShownItem } from "./types";

/** Who has commented in a thread, first to last, once each. */
function participants(item: ShownItem) {
  const seen = new Set<string>();
  return [item, ...item.replies].filter((person) => {
    if (seen.has(person.authorId)) return false;
    seen.add(person.authorId);
    return true;
  });
}

const MAX_AVATARS = 3;
const PIN_HEIGHT = 28;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 150;

/** Right against the pin (so the pointer can move from one to the other), on screen. */
function previewPosition(at: Rect) {
  const left = Math.max(8, Math.min(at.x, innerWidth - PREVIEW_WIDTH - 8));
  const below = at.y + PIN_HEIGHT;
  return below + PREVIEW_HEIGHT <= innerHeight
    ? { left, top: below }
    : { left, bottom: Math.max(8, innerHeight - at.y) };
}

/**
 * The page's threads: at each one's rectangle, a pin with a comment count and
 * the avatars of who's in it. Hovering a pin outlines its rectangle and
 * previews the thread, with a Resolve button you can move onto; clicking the
 * pin or the preview opens the thread (see `thread.tsx`).
 * Positions are read fresh on every render; the app re-renders as layout changes.
 */
export function Pins({
  items,
  openId,
  hoverId,
  onHover,
  onUnhover,
  onOpen,
  onResolve,
}: {
  items: ShownItem[];
  openId: string | null;
  hoverId: string | null;
  onHover: (id: string) => void;
  onUnhover: () => void;
  /** opens the thread, or closes it if it's the open one */
  onOpen: (id: string) => void;
  onResolve: (item: ShownItem, resolved: boolean) => void;
}) {
  const here = pageKey(location.href);
  const placed = items
    .filter((item) => pageKey(item.pageUrl) === here)
    .map((item) => ({ item, rect: locateItem(item) }));
  const outlined = placed.find((p) => p.item.id === (openId ?? hoverId));
  const previewed = placed.find(
    (p) => p.item.id === hoverId && p.item.id !== openId,
  );

  return (
    <>
      {outlined && hasRegion(outlined.rect) && (
        <div
          class="region hover"
          style={{
            left: outlined.rect.x,
            top: outlined.rect.y,
            width: outlined.rect.w,
            height: outlined.rect.h,
          }}
        />
      )}
      {placed.map(({ item, rect }) => (
        <button
          key={item.id}
          type="button"
          class={`pin${item.resolved ? " resolved" : ""}${item.pending ? " pending" : ""}${item.id === openId ? " open" : ""}`}
          style={{ left: rect.x, top: rect.y }}
          aria-label={`Thread by ${item.author}, ${item.replies.length + 1} comments`}
          // a click on our own UI is not a click outside an open thread
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => onHover(item.id)}
          onPointerLeave={onUnhover}
          onClick={() => onOpen(item.id)}
        >
          <span class="count">
            {item.resolved ? "✓" : item.replies.length + 1}
          </span>
          <span class="stack">
            {participants(item)
              .slice(0, MAX_AVATARS)
              .map((person, index) => (
                <Avatar
                  key={person.authorId}
                  name={person.author}
                  src={person.avatar}
                  size={24}
                  // the first commenter is on top, each next one tucked under it
                  zIndex={MAX_AVATARS - index}
                />
              ))}
          </span>
        </button>
      ))}
      {previewed && (
        <div
          class="preview card"
          style={previewPosition(previewed.rect)}
          title="Open the thread"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => onHover(previewed.item.id)}
          onPointerLeave={onUnhover}
          onClick={() => onOpen(previewed.item.id)}
        >
          <div class="head">
            <Avatar
              name={previewed.item.author}
              src={previewed.item.avatar}
              size={24}
            />
            <div>
              <div class="who">{previewed.item.author}</div>
              <div class="muted">
                {previewed.item.pending
                  ? "Sending…"
                  : formatTime(previewed.item.createdAt)}
              </div>
            </div>
          </div>
          <div class="text">{previewed.item.text}</div>
          <div class="actions">
            <span class="muted">
              {previewed.item.replies.length > 0
                ? `${previewed.item.replies.length} repl${previewed.item.replies.length === 1 ? "y" : "ies"}`
                : "Click to reply"}
            </span>
            {!previewed.item.pending && (
              <button
                type="button"
                class={`resolve${previewed.item.resolved ? " on" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onResolve(previewed.item, !previewed.item.resolved);
                }}
              >
                <CheckCircleIcon />
                {previewed.item.resolved ? "Reopen" : "Resolve"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
