import { useEffect, useRef, useState } from "preact/hooks";
import { Avatar } from "./avatar";
import { hasRegion, locateItem, pageKey } from "./geometry";
import { CheckCircleIcon } from "./icons";
import { PIN_HEIGHT } from "./styles";
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
/** How far the pointer has to go before a press on a pin is a drag, not a click. */
const DRAG_THRESHOLD = 4;

type Drag = {
  id: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

const moved = (rect: Rect, drag: Drag | null, id: string): Rect =>
  drag?.id === id && drag.moved
    ? { ...rect, x: rect.x + drag.dx, y: rect.y + drag.dy }
    : rect;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 150;

/** Right against the pin (so the pointer can move from one to the other), on screen. `at` is the thread's rectangle. */
function previewPosition(at: Rect) {
  const left = Math.max(8, Math.min(at.x, innerWidth - PREVIEW_WIDTH - 8));
  const below = at.y;
  return below + PREVIEW_HEIGHT <= innerHeight
    ? { left, top: below }
    : { left, bottom: Math.max(8, innerHeight - (at.y - PIN_HEIGHT)) };
}

/**
 * The page's threads: at each one's rectangle, a pin with a comment count and
 * the avatars of who's in it. Hovering a pin outlines its rectangle and
 * previews the thread, with a Resolve button you can move onto; clicking the
 * pin or the preview opens the thread (see `thread.tsx`). Dragging a pin
 * moves the thread (its rectangle goes with it). Resolved threads have no pin
 * (they're in the list), unless open.
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
  onMove,
}: {
  items: ShownItem[];
  openId: string | null;
  hoverId: string | null;
  onHover: (id: string) => void;
  onUnhover: () => void;
  /** opens the thread, or closes it if it's the open one */
  onOpen: (id: string) => void;
  onResolve: (item: ShownItem, resolved: boolean) => void;
  /** the thread's rectangle, dragged to here (viewport pixels) */
  onMove: (item: ShownItem, rect: Rect) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  /** a drag ends in a click on the pin: that click isn't one */
  const justDragged = useRef(false);

  // however the press ends (even when the pin never hears it), the drag is over
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDrag(null);
    // bubbling, so the pin's own release (which saves the move) comes first
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
    };
  }, [dragging]);

  const here = pageKey(location.href);
  const placed = items
    .filter(
      (item) =>
        pageKey(item.pageUrl) === here &&
        (!item.resolved || item.id === openId),
    )
    .map((item) => ({ item, rect: moved(locateItem(item), drag, item.id) }));
  const outlined = placed.find(
    (p) => p.item.id === (drag?.moved ? drag.id : (openId ?? hoverId)),
  );
  const previewed = drag?.moved
    ? undefined
    : placed.find((p) => p.item.id === hoverId && p.item.id !== openId);

  const endDrag = (item: ShownItem, rect: Rect) => {
    if (drag?.id === item.id && drag.moved) {
      justDragged.current = true;
      onMove(item, rect);
    }
    setDrag(null);
  };

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
          class={`pin${item.resolved ? " resolved" : ""}${item.pending ? " pending" : ""}${item.id === openId ? " open" : ""}${drag?.id === item.id && drag.moved ? " dragging" : ""}`}
          style={{ left: rect.x, top: rect.y - PIN_HEIGHT }}
          aria-label={`Thread by ${item.author}, ${item.replies.length + 1} comments`}
          title={item.pending ? undefined : "Drag to move"}
          onPointerDown={(event) => {
            // a click on our own UI is not a click outside an open thread
            event.stopPropagation();
            if (item.pending || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const { clientX: x, clientY: y } = event;
            setDrag({
              id: item.id,
              startX: x,
              startY: y,
              dx: 0,
              dy: 0,
              moved: false,
            });
          }}
          onPointerMove={(event) => {
            if (drag?.id !== item.id) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            const isDrag = drag.moved || Math.hypot(dx, dy) >= DRAG_THRESHOLD;
            setDrag({ ...drag, dx, dy, moved: isDrag });
          }}
          onPointerUp={() => endDrag(item, rect)}
          onPointerCancel={() => setDrag(null)}
          // the browser's own drag-and-drop (an avatar image) or a long-press menu would cancel the touch
          onDragStart={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
          // the capture is lost (e.g. the window lost focus): leave it where it was.
          // Not for a child: touch captures to the child under the finger first, and
          // moving the capture to the pin fires (and bubbles) this for that child.
          onLostPointerCapture={(event) => {
            if (event.target === event.currentTarget) setDrag(null);
          }}
          onPointerEnter={() => onHover(item.id)}
          onPointerLeave={onUnhover}
          onClick={() => {
            if (justDragged.current) {
              justDragged.current = false;
              return;
            }
            onOpen(item.id);
          }}
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
