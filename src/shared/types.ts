/**
 * What the widget and its server agree on: the shape of a comment thread, as
 * it's stored in the PR comment and sent over the API. Type-only, so the
 * server can import it without bundling anything.
 */

/** A rectangle: `x`/`y` is its top-left corner. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A reply in a thread. */
export type StoredReply = {
  id: string;
  author: string;
  /** the author's avatar, if they have one */
  avatar: string | null;
  /** the author's user id, which is what lets them edit or delete it */
  authorId: string;
  text: string;
  /** ISO time */
  createdAt: string;
  /** ISO time, once edited */
  editedAt?: string;
};

/** A thread: the first comment, with its place on the page, and the replies. */
export type StoredItem = {
  id: string;
  author: string;
  avatar: string | null;
  authorId: string;
  text: string;
  pageUrl: string;
  /** the smallest element that holds the rectangle */
  selector: string;
  /** the rectangle as fractions of that element's box, so it follows layout changes */
  rect: Rect;
  /** the rectangle in page pixels, for when the element can't be found */
  pageRect: Rect;
  /** ISO time */
  createdAt: string;
  /** ISO time, once edited */
  editedAt?: string;
  /** ticked off in the PR comment */
  resolved: boolean;
  replies: StoredReply[];
};

/** Who's signed in and which PR the review app belongs to: the start of the API's `GET` response. */
export type ReviewContext = {
  user: string;
  /** the signed-in user's id, to tell which comments are theirs */
  userId: string;
  image: string | null;
  repo: string;
  prNumber: number;
  /** the PR comment the threads are collected in */
  commentUrl: string;
};

/** The API's `GET` response. */
export type ReviewState = ReviewContext & { items: StoredItem[] };
