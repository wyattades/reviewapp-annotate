import { useEffect, useState } from "preact/hooks";
import { PILL_HEIGHT } from "./styles";

/** How far the widget's bar sits from the viewport's right and bottom edges. */
export type BarPosition = { right: number; bottom: number };

const KEY = "reviewapp-annotate-bar";
const DEFAULT: BarPosition = { right: 16, bottom: 16 };
/** Moving less than this is a click on a button, not a drag. */
const DRAG_THRESHOLD = 4;
/** Keeps at least this much of the bar on screen. */
const MIN_VISIBLE = { w: 140, h: PILL_HEIGHT };
const GAP = 8;

const clamp = (pos: BarPosition): BarPosition => ({
  right: Math.min(
    Math.max(0, pos.right),
    Math.max(0, innerWidth - MIN_VISIBLE.w),
  ),
  bottom: Math.min(
    Math.max(0, pos.bottom),
    Math.max(0, innerHeight - MIN_VISIBLE.h),
  ),
});

function load(): BarPosition {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return clamp(JSON.parse(saved) as BarPosition);
  } catch {
    // storage blocked or garbled: use the default spot
  }
  return DEFAULT;
}

function save(pos: BarPosition) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pos));
  } catch {
    // storage blocked: it just won't be remembered
  }
}

/**
 * The bar's position and the pointer handler that drags it. Buttons on the bar
 * still click: dragging only starts once the pointer has moved a few pixels,
 * and a drag doesn't also click whatever it ends over.
 */
export function useBarPosition() {
  const [pos, setPos] = useState(load);

  // keep it on screen when the window shrinks
  useEffect(() => {
    const onResize = () => setPos((current) => clamp(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      const start = { x: event.clientX, y: event.clientY };
      const bar = event.currentTarget as HTMLElement;
      const pointerId = event.pointerId;
      const from = pos;
      let last = from;
      let moving = false;

      // on window, not the bar: a fast drag leaves the bar before the first move
      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - start.x;
        const dy = move.clientY - start.y;
        if (!moving && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!moving) {
          // so the release is heard even over an iframe or outside the window
          try {
            bar.setPointerCapture(pointerId);
          } catch {
            // the pointer is already gone: the window listeners still end the drag
          }
        }
        moving = true;
        last = clamp({ right: from.right - dx, bottom: from.bottom - dy });
        setPos(last);
      };
      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("blur", onEnd);
        bar.removeEventListener("lostpointercapture", onLost);
        if (!moving) return;
        save(last);

        // the release would otherwise click a button the bar ended up under
        const swallow = (click: Event) => click.stopImmediatePropagation();
        window.addEventListener("click", swallow, {
          capture: true,
          once: true,
        });
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("blur", onEnd);
      // Touch already captures the pointer to the child under the finger, so
      // capturing it to the bar fires this (and bubbles) for that child: not the end.
      const onLost = (lost: Event) => {
        if (lost.target === bar) onEnd();
      };
      bar.addEventListener("lostpointercapture", onLost);
    },
    // the browser's own drag-and-drop would swallow the pointer events
    onDragStart: (event: DragEvent) => event.preventDefault(),
  };

  return { pos, handlers };
}

/**
 * Where a popover `width` wide goes so it stays next to the bar and on screen:
 * above the bar when it's in the lower half of the screen, below it otherwise,
 * lined up with the bar's right edge unless that would push it off the left.
 */
export function popoverStyle(pos: BarPosition, width: number) {
  const right = Math.max(8, Math.min(pos.right, innerWidth - width - 8));
  const barBottomEdge = innerHeight - pos.bottom;
  const inLowerHalf = barBottomEdge - PILL_HEIGHT / 2 > innerHeight / 2;
  return inLowerHalf
    ? { right, bottom: pos.bottom + PILL_HEIGHT + GAP, top: "auto" }
    : { right, top: barBottomEdge + GAP, bottom: "auto" };
}
