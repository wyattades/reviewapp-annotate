/**
 * For a page that puts the comment controls in its own toolbar: with
 * `data-launcher="external"` on the script tag the widget draws no bar of its
 * own, and `window.reviewappAnnotate` says what the bar would show and does
 * what its buttons would do. Pins, threads, the composer and the list still
 * come from the widget.
 */

/** A rectangle on screen, in viewport pixels, like `getBoundingClientRect()`. */
export type AnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type EmbedState = {
  /** false until the reader signs in: `signIn()` opens the sign-in popup */
  signedIn: boolean;
  /** signed in, but the PR and its comments haven't loaded (or can't: see `status`) */
  loading: boolean;
  /** why there are no comments to show, e.g. "No PR found for this app" */
  status: string;
  prNumber: number | null;
  commentUrl: string | null;
  /** threads on the PR, across pages */
  count: number;
  /** picking a spot on the page for a new comment */
  selecting: boolean;
  listOpen: boolean;
  /** requests in flight */
  saving: boolean;
  /** something didn't save: `retry()` sends it again when `canRetry`, `dismiss()` clears it */
  problem: { text: string; canRetry: boolean } | null;
};

export type EmbedApi = {
  version: 1;
  getState: () => EmbedState;
  /** Calls `listener` with every new state; returns the unsubscribe. */
  subscribe: (listener: (state: EmbedState) => void) => () => void;
  signIn: () => void;
  /** Starts picking a spot for a comment, or cancels when already picking. */
  toggleComment: () => void;
  /**
   * Opens or closes the list of comments beside `anchor`, the toolbar's
   * button. It's measured on every layout, so the list follows the button
   * when the toolbar moves.
   */
  toggleList: (anchor: Element) => void;
  retry: () => void;
  dismiss: () => void;
};

/** What the toolbar's buttons do: set by the widget's app once it's running. */
export type EmbedCommands = Omit<
  EmbedApi,
  "version" | "getState" | "subscribe"
>;

/** Presses inside an element with this attribute don't count as "outside the widget". */
export const LAUNCHER_ATTRIBUTE = "data-reviewapp-annotate-launcher";
/** Fired on `window` once `window.reviewappAnnotate` is there. */
export const READY_EVENT = "reviewapp-annotate:ready";

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    reviewappAnnotate?: EmbedApi;
  }
}

export const INITIAL_STATE: EmbedState = {
  signedIn: false,
  loading: false,
  status: "",
  prNumber: null,
  commentUrl: null,
  count: 0,
  selecting: false,
  listOpen: false,
  saving: false,
  problem: null,
};

/** Puts `window.reviewappAnnotate` on the page. `commands` is read on every call, so it can change. */
export function installEmbedApi(commands: () => EmbedCommands) {
  let state = INITIAL_STATE;
  const listeners = new Set<(state: EmbedState) => void>();

  window.reviewappAnnotate = {
    version: 1,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    signIn: () => commands().signIn(),
    toggleComment: () => commands().toggleComment(),
    toggleList: (anchor) => commands().toggleList(anchor),
    retry: () => commands().retry(),
    dismiss: () => commands().dismiss(),
  };
  window.dispatchEvent(new Event(READY_EVENT));

  return (next: EmbedState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
}

/** True when the press was on the page's own toolbar, which opens and closes the widget's popovers itself. */
export const onLauncher = (event: Event) =>
  event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element && node.hasAttribute(LAUNCHER_ATTRIBUTE),
    );
