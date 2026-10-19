import { describeElement } from "./selector";
import type { Rect, StoredItem, Target } from "./types";

const TOLERANCE = 2;

/** A drag at least this big (in either direction) is a region to screenshot; less is a click that just drops a pin. */
export const MIN_REGION = 8;
export const hasRegion = (rect: Rect) =>
  rect.w >= MIN_REGION || rect.h >= MIN_REGION;

/** Same page for our purposes: path and query, so it holds across SPA routes. */
export const pageKey = (url: string) => {
  try {
    const parsed = new URL(url, location.href);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
};

export const findElement = (selector: string) => {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
};

export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export const elementAt = (x: number, y: number, host: Element) =>
  document.elementsFromPoint(x, y).find((node) => node !== host) ?? null;

export function elementRect(element: Element): Rect {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The smallest element that holds the whole rectangle, starting from the one under its centre. */
export function inferElement(rect: Rect, host: Element): Element {
  let element =
    elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2, host) ?? document.body;
  const holds = (candidate: Element) => {
    const r = candidate.getBoundingClientRect();
    return (
      r.left <= rect.x + TOLERANCE &&
      r.top <= rect.y + TOLERANCE &&
      r.right >= rect.x + rect.w - TOLERANCE &&
      r.bottom >= rect.y + rect.h - TOLERANCE
    );
  };
  while (element.parentElement && !holds(element)) {
    element = element.parentElement;
  }
  return element;
}

/** What to remember about a dragged rectangle, so the comment can point at it again. */
export function describeTarget(rect: Rect, host: Element): Target {
  const element = inferElement(rect, host);
  const box = elementRect(element);
  return {
    rect,
    selector: describeElement(element),
    elementText: (element as HTMLElement).innerText?.slice(0, 200) ?? null,
    relativeRect: {
      x: box.w ? (rect.x - box.x) / box.w : 0,
      y: box.h ? (rect.y - box.y) / box.h : 0,
      w: box.w ? rect.w / box.w : 1,
      h: box.h ? rect.h / box.h : 1,
    },
    pageRect: {
      x: rect.x + scrollX,
      y: rect.y + scrollY,
      w: rect.w,
      h: rect.h,
    },
  };
}

/** Where a comment's rectangle is now, in viewport pixels, or null when it can't be placed. */
export function locateItem(
  item: Pick<StoredItem, "selector" | "rect" | "pageRect">,
): Rect {
  const element = findElement(item.selector);
  if (element) {
    const box = elementRect(element);
    if (box.w > 0 && box.h > 0) {
      return {
        x: box.x + item.rect.x * box.w,
        y: box.y + item.rect.y * box.h,
        w: item.rect.w * box.w,
        h: item.rect.h * box.h,
      };
    }
  }
  // the element is gone (or hidden): fall back to where the rectangle was on the page
  const page = item.pageRect;
  return { x: page.x - scrollX, y: page.y - scrollY, w: page.w, h: page.h };
}
