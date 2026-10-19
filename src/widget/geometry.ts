import { describeElement } from "./selector";
import type { Rect, StoredItem, Target } from "./types";

const TOLERANCE = 2;

/** An element "covers" a dragged rectangle when it holds at least this much of it. */
const COVERS = 0.8;
/** An element this many times bigger than the rectangle is too broad to describe it. */
const BROAD = 10;
/** The smallest an element inside a rectangle can be to stand for it. */
const MIN_ELEMENT = 8;
/** How much text a comment keeps from inside its rectangle. */
const TEXT_LIMIT = 200;

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

const area = (r: Rect) => Math.max(r.w * r.h, 1);

/** The area two rectangles share. */
export function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Whether `inner` lies within `outer`, give or take a couple of pixels. */
export const isInside = (inner: Rect, outer: Rect, tolerance = TOLERANCE) =>
  inner.x >= outer.x - tolerance &&
  inner.y >= outer.y - tolerance &&
  inner.x + inner.w <= outer.x + outer.w + tolerance &&
  inner.y + inner.h <= outer.y + outer.h + tolerance;

/** Whether a point is within a rectangle. */
const hasPoint = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export const elementAt = (x: number, y: number, host: Element) =>
  document.elementsFromPoint(x, y).find((node) => node !== host) ?? null;

export function elementRect(element: Element): Rect {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The smallest element that holds the whole rectangle, starting from `start`. */
function containing(rect: Rect, start: Element) {
  let element = start;
  while (element.parentElement && !isInside(rect, elementRect(element))) {
    element = element.parentElement;
  }
  return element;
}

/** The first element, in page order, that lies inside the rectangle (and is big enough to be one). */
function firstInside(rect: Rect, root: Element, host: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    if (element === host) continue;
    const box = elementRect(element);
    if (box.w >= MIN_ELEMENT && box.h >= MIN_ELEMENT && isInside(box, rect)) {
      return element;
    }
  }
  return null;
}

/**
 * The element a rectangle is about, so the comment can find it again:
 *
 * - a click: the element under it;
 * - a drag: the smallest element, from the one under the rectangle's centre
 *   up, that covers most of it. That's usually the one it was drawn around,
 *   even when the drag strays a few pixels past its edge;
 * - if that is far bigger than the rectangle (a drag across the header and the
 *   top of the page finds only `body`), the first element inside the
 *   rectangle, which stays put when the rest of the page changes.
 */
export function inferElement(rect: Rect, host: Element): Element {
  const start =
    elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2, host) ?? document.body;
  if (!hasRegion(rect)) return start;

  let element = start;
  while (
    element.parentElement &&
    overlap(elementRect(element), rect) < COVERS * area(rect)
  ) {
    element = element.parentElement;
  }

  const broad =
    element === document.body ||
    element === document.documentElement ||
    area(elementRect(element)) >= BROAD * area(rect);
  return (broad && firstInside(rect, element, host)) || element;
}

/**
 * The text inside the rectangle: what's written within it, not the text of the
 * element it was anchored to (which may be the whole page). Whole text nodes,
 * so a paragraph the rectangle only reaches into counts in full.
 */
export function textWithin(rect: Rect, element: Element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(
        node.parentElement?.tagName ?? "",
      )
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  const parts: string[] = [];
  let length = 0;
  for (
    let node = walker.nextNode();
    node && length < TEXT_LIMIT;
    node = walker.nextNode()
  ) {
    const text = node.nodeValue?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    range.selectNodeContents(node);
    const shown = [...range.getClientRects()].some((line) =>
      hasPoint(rect, line.left + line.width / 2, line.top + line.height / 2),
    );
    if (!shown) continue;
    parts.push(text);
    length += text.length + 1;
  }
  return parts.join(" ").slice(0, TEXT_LIMIT) || null;
}

/** What to remember about a dragged rectangle, so the comment can point at it again. */
export function describeTarget(rect: Rect, host: Element): Target {
  const element = inferElement(rect, host);
  const box = elementRect(element);
  return {
    rect,
    selector: describeElement(element),
    // a click has no inside: the element under it, say a button's label
    elementText: hasRegion(rect)
      ? textWithin(rect, containing(rect, element))
      : ((element as HTMLElement).innerText?.slice(0, TEXT_LIMIT) ?? null),
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
