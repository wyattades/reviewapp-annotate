import { snapdom } from "@zumer/snapdom";
import { imageProxyPrefix } from "./api";
import type { Rect } from "./types";

/** Under the server's per-image cap (1.2M characters), with room to spare. */
const MAX_DATA_URL_CHARS = 1_100_000;
const MAX_DIMENSION = 1600;

/**
 * A JPEG of the part of the page inside `rect` (viewport pixels), without the
 * widget; null if it can't be rendered.
 *
 * snapdom copies the page into an SVG and lets the browser draw it, so it gets
 * what the browser would: web fonts, filters, transforms, form fields as
 * they've been filled in, canvas, video, same-origin iframes. Images from
 * other sites without CORS headers come through the server's image proxy.
 * It captures <body>, which leaves the widget out (it lives on <html>).
 */
export async function captureRegion(
  rect: Rect,
  host: Element,
): Promise<string | null> {
  try {
    const result = await snapdom(document.body, {
      clip: {
        x: scrollX + rect.x,
        y: scrollY + rect.y,
        width: rect.w,
        height: rect.h,
      },
      // device pixels, up to 2x, and no bigger than MAX_DIMENSION
      dpr: Math.min(
        Math.min(devicePixelRatio, 2),
        MAX_DIMENSION / Math.max(rect.w, rect.h, 1),
      ),
      // in case a page moves it into <body>; the default "hide" mode, since
      // "remove" leaves scrolled boxes unclipped (snapdom 3.7)
      exclude: (element) => element === host,
      backgroundColor: pageBackground(),
      useProxy: (await imageProxyPrefix()) ?? undefined,
    });
    return toJpeg(await result.toCanvas(), [1, 0.7, 0.5], 0.85);
  } catch (error) {
    console.warn("[review-widget] screenshot failed", error);
    return null;
  }
}

/** What's behind the page where nothing is drawn: <html>'s background, else <body>'s, else white. */
function pageBackground() {
  for (const element of [document.documentElement, document.body]) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color))
      return color;
  }
  return "#fff";
}

/** A pasted or dropped image as a JPEG data URL small enough to send; null if it isn't a readable image. */
export async function imageToJpeg(file: Blob): Promise<string | null> {
  try {
    return toJpeg(await createImageBitmap(file), [1, 0.7, 0.5, 0.3], 0.85);
  } catch {
    // not an image the browser can decode
    return null;
  }
}

/** `image` as a JPEG data URL under the size cap, shrunk by each of `factors` in turn until it fits. */
function toJpeg(
  image: HTMLCanvasElement | ImageBitmap,
  factors: number[],
  quality: number,
): string | null {
  for (const factor of factors) {
    const ratio =
      Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height)) * factor;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG has no transparency
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_DATA_URL_CHARS) return url;
  }
  return null;
}
