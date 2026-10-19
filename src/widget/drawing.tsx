import { useState } from "preact/hooks";
import type { Rect } from "./types";

/** A freehand line, in pixels from the rectangle's top-left corner. */
export type Stroke = { x: number; y: number }[];

/** Annotation red: it stands out on almost any page. */
const COLOR = "#ef4444";
/** On screen, in CSS pixels; scaled up with the screenshot. */
const WIDTH = 3;

const points = (stroke: Stroke) =>
  stroke.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/**
 * The selected rectangle, drawable: drag inside it to mark it up. The strokes
 * aren't stored anywhere; they're drawn onto the screenshot (`bakeStrokes`).
 */
export function DrawingLayer({
  rect,
  strokes,
  onStroke,
}: {
  rect: Rect;
  strokes: Stroke[];
  /** a finished stroke */
  onStroke: (stroke: Stroke) => void;
}) {
  const [current, setCurrent] = useState<Stroke | null>(null);
  const at = (event: PointerEvent) => ({
    x: Math.max(0, Math.min(rect.w, event.clientX - rect.x)),
    y: Math.max(0, Math.min(rect.h, event.clientY - rect.y)),
  });
  const finish = () => {
    // a click with no movement is a dot: still a mark
    if (current?.length) onStroke(current);
    setCurrent(null);
  };

  return (
    <div
      class="region drawing"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      title="Draw to mark it up"
      onPointerDown={(event) => {
        // a press on our own UI is not a click outside the composer
        event.stopPropagation();
        event.preventDefault();
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setCurrent([at(event)]);
      }}
      onPointerMove={(event) => {
        if (current) setCurrent([...current, at(event)]);
      }}
      onPointerUp={finish}
      onLostPointerCapture={finish}
    >
      <svg width={rect.w} height={rect.h} aria-hidden="true">
        {[...strokes, ...(current ? [current] : [])].map((stroke, i) =>
          stroke.length === 1 ? (
            <circle
              key={i}
              cx={stroke[0]!.x}
              cy={stroke[0]!.y}
              r={WIDTH / 2 + 0.5}
              fill={COLOR}
            />
          ) : (
            <polyline
              key={i}
              points={points(stroke)}
              fill="none"
              stroke={COLOR}
              stroke-width={WIDTH}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          ),
        )}
      </svg>
    </div>
  );
}

/** The screenshot (of `rect`) with the strokes drawn on, as a JPEG data URL. */
export async function bakeStrokes(
  screenshot: string,
  strokes: Stroke[],
  rect: Rect,
): Promise<string> {
  if (!strokes.length) return screenshot;
  const image = new Image();
  image.src = screenshot;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return screenshot;
  ctx.drawImage(image, 0, 0);

  // the screenshot is the rectangle at some scale (device pixels, or smaller to fit)
  const scale = canvas.width / Math.max(rect.w, 1);
  ctx.strokeStyle = COLOR;
  ctx.fillStyle = COLOR;
  ctx.lineWidth = WIDTH * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      const { x, y } = stroke[0]!;
      ctx.beginPath();
      ctx.arc(x * scale, y * scale, (WIDTH / 2 + 0.5) * scale, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    stroke.forEach(({ x, y }, i) =>
      i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale),
    );
    ctx.stroke();
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}
