import type { Rect, ReviewContext, StoredItem, StoredReply } from "../shared";

export type { Rect, StoredItem, StoredReply };

/** A thread, or one still being sent. */
export type ShownItem = StoredItem & { pending?: boolean };

/** Who's signed in and which PR this is, as the API says. */
export type Context = ReviewContext;

/** An image on a comment: a screenshot of the region, or one pasted in. `dataUrl` is null while it's being captured. */
export type Attachment = {
  id: string;
  kind: "screenshot" | "pasted";
  dataUrl: string | null;
};

/** What the composer hands back to be sent. */
export type Draft = {
  text: string;
  attachments: string[];
  includeConsole: boolean;
};

/** Where a comment points, worked out when the rectangle is dragged. */
export type Target = {
  /** the dragged rectangle, in viewport pixels */
  rect: Rect;
  selector: string;
  elementText: string | null;
  /** the rectangle as fractions of the selector element's box */
  relativeRect: Rect;
  /** the rectangle in page pixels */
  pageRect: Rect;
};
