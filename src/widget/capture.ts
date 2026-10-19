import html2canvas from "html2canvas-pro";
import type { Rect } from "./types";

/** Under the server's per-image cap (1.2M characters), with room to spare. */
const MAX_DATA_URL_CHARS = 1_100_000;
const MAX_DIMENSION = 1600;

/** A JPEG of the part of the page inside `rect` (viewport pixels), without the widget; null if it can't be rendered. */
export async function captureRegion(
  rect: Rect,
  host: Element,
): Promise<string | null> {
  try {
    for (const factor of [1, 0.6, 0.4]) {
      const scale = Math.min(
        Math.min(devicePixelRatio, 2) * factor,
        MAX_DIMENSION / Math.max(rect.w, rect.h, 1),
      );
      const canvas = await html2canvas(document.documentElement, {
        x: scrollX + rect.x,
        y: scrollY + rect.y,
        width: rect.w,
        height: rect.h,
        scale,
        useCORS: true,
        logging: false,
        ignoreElements: (element) => element === host,
      });
      const url = canvas.toDataURL("image/jpeg", 0.8);
      if (url.length <= MAX_DATA_URL_CHARS) return url;
    }
  } catch (error) {
    console.warn("[review-widget] screenshot failed", error);
  }
  return null;
}

/** A pasted or dropped image as a JPEG data URL small enough to send; null if it isn't a readable image. */
export async function imageToJpeg(file: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    for (const factor of [1, 0.7, 0.5, 0.3]) {
      const ratio =
        Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)) *
        factor;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // JPEG has no transparency
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.85);
      if (url.length <= MAX_DATA_URL_CHARS) return url;
    }
  } catch {
    // not an image the browser can decode
  }
  return null;
}
