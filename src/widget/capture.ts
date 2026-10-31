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
    return toJpeg(await createImageBitmap(file), [1, 0.7, 0.5, 0.3], 0.85);
  } catch {
    // not an image the browser can decode
    return null;
  }
}

/** `bitmap` as a JPEG data URL under the size cap, shrinking by each of `factors` until it fits. */
function toJpeg(
  bitmap: ImageBitmap,
  factors: number[],
  quality: number,
): string | null {
  for (const factor of factors) {
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
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_DATA_URL_CHARS) return url;
  }
  return null;
}

// --- tab capture ---
//
// html2canvas redraws the page from its DOM and CSS, so it gets some things
// wrong (cross-origin images, filters, some fonts, canvas and video). Chromium
// on desktop can instead capture the tab itself (getDisplayMedia, the Screen
// Capture API), which is exactly what's on screen, but it asks the reviewer's
// permission every time. So it's an extra, on a click: "Sharper screenshot".
//
// Region Capture (CropTarget, Chromium only) crops the stream to a placeholder
// element over the selection, so the browser does the coordinate math, and
// cropping fails if the reviewer shared something other than this tab.

/** Chromium's Region Capture, not yet in TypeScript's DOM types. */
declare const CropTarget: {
  fromElement(element: Element): Promise<unknown>;
};
type CroppableTrack = MediaStreamTrack & {
  cropTo(target: unknown): Promise<void>;
};

/** This browser can capture its own tab, cropped: Chromium on a desktop. */
export function canCaptureTab(): boolean {
  return (
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof CropTarget !== "undefined" &&
    !navigator.maxTouchPoints
  );
}

/**
 * A JPEG of the part of the tab inside `rect` (viewport pixels) as the browser
 * drew it, without the widget. Asks the reviewer to share the tab, so it must
 * run from a click. Null if they decline, share something else, or it fails.
 */
export async function captureTab(
  rect: Rect,
  host: HTMLElement,
): Promise<string | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", cursor: "never" },
      audio: false,
      // Chromium: offer this tab first, and only tabs
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude",
    } as DisplayMediaStreamOptions);
  } catch {
    return null; // declined
  }
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
  // a transparent box over the selection, in the page itself: what the stream is cropped to
  const box = document.createElement("div");
  box.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;pointer-events:none;z-index:-2147483648`;
  const display = host.style.display;
  const video = document.createElement("video");
  try {
    if (!track) return null;
    document.body.append(box);
    await track.cropTo(await CropTarget.fromElement(box));
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    host.style.display = "none";
    // a frame captured after the widget went away (painted, then captured)
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await frameAfter(video, performance.now(), 1000);
    if (!video.videoWidth) return null;
    return toJpeg(await createImageBitmap(video), [1, 0.6, 0.4], 0.85);
  } catch (error) {
    // cropTo fails when the shared surface isn't this tab
    console.warn("[review-widget] tab capture failed", error);
    return null;
  } finally {
    host.style.display = display;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    box.remove();
  }
}

/**
 * Waits for a frame of `video` captured after `time`, or for `timeout`. (The
 * tab only sends frames when it changes, so the newest frame by then is fine.)
 */
function frameAfter(video: HTMLVideoElement, time: number, timeout: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeout);
    const check: VideoFrameRequestCallback = (_now, frame) => {
      // captureTime is when the browser grabbed the frame, on performance.now's clock
      if ((frame.captureTime ?? 0) > time) {
        clearTimeout(timer);
        resolve();
      } else video.requestVideoFrameCallback(check);
    };
    video.requestVideoFrameCallback(check);
  });
}
