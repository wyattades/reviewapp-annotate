import { useEffect, useState } from "preact/hooks";
import { hasRegion, rectFromPoints } from "./geometry";
import type { Rect } from "./types";

type Point = { x: number; y: number };

/** Covers the page while the commenter drags out a region to comment on, or clicks to drop a pin. */
export function SelectOverlay({
  touch,
  onSelect,
  onCancel,
}: {
  /** started by a tap: no Esc key to mention */
  touch: boolean;
  onSelect: (rect: Rect) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const dragged = start && current ? rectFromPoints(start, current) : null;
  const shown = dragged && hasRegion(dragged) ? dragged : null;

  return (
    <>
      <div class="hint">
        {touch
          ? "Drag to select an area, or tap to drop a pin · Tap the button to cancel"
          : "Drag to select an area, or click to drop a pin · Esc to cancel"}
      </div>
      <div
        class="catcher"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setStart({ x: event.clientX, y: event.clientY });
          setCurrent({ x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => {
          if (start) setCurrent({ x: event.clientX, y: event.clientY });
        }}
        onPointerUp={(event) => {
          if (!start) return;
          const rect = rectFromPoints(start, {
            x: event.clientX,
            y: event.clientY,
          });
          setStart(null);
          setCurrent(null);
          // a click (or a tiny drag) just drops a pin where it landed
          onSelect(
            hasRegion(rect)
              ? rect
              : { x: event.clientX, y: event.clientY, w: 0, h: 0 },
          );
        }}
      />
      {shown && (
        <div
          class="region"
          style={{
            left: shown.x,
            top: shown.y,
            width: shown.w,
            height: shown.h,
          }}
        />
      )}
    </>
  );
}
