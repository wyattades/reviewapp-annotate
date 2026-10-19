import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, listenForToken, openSignIn, send, tokenStore } from "./api";
import { popoverStyle, useBarPosition } from "./bar-position";
import { Composer } from "./composer";
import { getConsoleEntries } from "./console-capture";
import { describeTarget, findElement, locateItem, pageKey } from "./geometry";
import { CommentIcon } from "./icons";
import { Panel } from "./panel";
import { Pins } from "./pins";
import { SelectOverlay } from "./select-overlay";
import { PANEL_WIDTH, STYLES, TOASTS_WIDTH } from "./styles";
import { Thread, type ThreadActions } from "./thread";
import type { Context, Draft, Rect, ShownItem, Target } from "./types";

const POLL_MS = 10_000;
const TOAST_MS = 6_000;
/** Dispatched by `index.tsx` when a single-page app changes the URL without a page load. */
export const NAVIGATE_EVENT = "reviewapp-annotate-navigate";

type Mode =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "composing"; target: Target };

type Toast = {
  id: number;
  kind: "sending" | "ok" | "error";
  text: string;
  url?: string;
  retry?: () => void;
};

type Payload = Record<string, unknown>;

let nextId = 0;
const enc = encodeURIComponent;

export function App({ host }: { host: HTMLElement }) {
  const [token, setToken] = useState(tokenStore.get());
  const [context, setContext] = useState<Context | null>(null);
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<ShownItem[]>([]);
  const [pending, setPending] = useState<ShownItem[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [panelOpen, setPanelOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** the reply being typed in each thread, by thread id */
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [, setLayoutTick] = useState(0);
  const queued = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  /** replies written to a comment that's still sending, to go out once it has an id */
  const queuedReplies = useRef(new Map<string, string[]>());
  const { pos, handlers: dragHandlers } = useBarPosition();

  // --- sign-in ---

  useEffect(() => listenForToken(setToken), []);

  // --- who's signed in, the PR, and everyone's comments: one request, repeated every few seconds ---

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await api();
      if (res.status === 401) {
        tokenStore.set(null);
        setToken(null);
      } else if (res.ok) {
        const { items: fetched, ...rest } = (await res.json()) as Context & {
          items: ShownItem[];
        };
        setContext(rest);
        setItems(fetched);
      } else {
        setStatus(
          res.status === 404
            ? "No PR found for this app"
            : "Comments unavailable",
        );
      }
    } catch {
      // offline or the server is down: keep what we have
      setStatus("Comments unavailable");
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setContext(null);
      setItems([]);
      return;
    }
    setStatus("…");
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, load]);

  // --- keep pins on their elements as the page changes ---

  useEffect(() => {
    const queue = () => {
      if (queued.current) return;
      queued.current = true;
      requestAnimationFrame(() => {
        queued.current = false;
        setLayoutTick((n) => n + 1);
      });
    };
    const observer = new MutationObserver(queue);
    // anything but our own host: single-page apps swap the DOM around
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    const events = [
      "scroll",
      "resize",
      NAVIGATE_EVENT,
      "popstate",
      "hashchange",
    ];
    for (const name of events) window.addEventListener(name, queue, true);
    return () => {
      observer.disconnect();
      for (const name of events) window.removeEventListener(name, queue, true);
    };
  }, []);

  // --- hovering a pin or a list row: the preview stays while the pointer is on it or its preview ---

  const hover = (id: string) => {
    clearTimeout(hoverTimer.current);
    setHoverId(id);
  };
  /** A beat of grace, for the pointer to cross from the pin to its preview. */
  const unhover = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverId(null), 150);
  };

  // Safety nets, since `pointerleave` is lost when what's hovered goes away
  // (a list that closes, a pin that moves): the preview must never be stuck.
  useEffect(() => {
    if (!hoverId) return;
    // events from inside our closed shadow root arrive with the host as target
    const onMove = (event: PointerEvent) => {
      if (event.target !== host) setHoverId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHoverId(null);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [hoverId, host]);

  useEffect(() => {
    if (!panelOpen) setHoverId(null);
  }, [panelOpen]);

  /** Opens a thread (or closes it with null); nothing is hovered once it's open. */
  const openThread = useCallback((id: string | null) => {
    setOpenId(id);
    setHoverId(null);
  }, []);
  // stable, so the open thread doesn't redo its setup on every render
  const closeThread = useCallback(() => openThread(null), [openThread]);

  // --- toasts ---

  const showToast = (toast: Omit<Toast, "id">, id = nextId++) => {
    setToasts((current) => [
      ...current.filter((t) => t.id !== id),
      { ...toast, id },
    ]);
    if (toast.kind === "ok") {
      setTimeout(
        () => setToasts((current) => current.filter((t) => t.id !== id)),
        TOAST_MS,
      );
    }
    return id;
  };
  const dismissToast = (id: number) =>
    setToasts((current) => current.filter((t) => t.id !== id));

  /** Throws unless the server said yes. An expired sign-in signs the widget out. */
  const check = async (res: Response) => {
    if (res.status === 401) {
      tokenStore.set(null);
      setToken(null);
      throw new Error("Session expired: sign in again");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Couldn't save that");
    }
    return res;
  };

  // --- commenting ---

  const post = async (payload: Payload, pendingId: string) => {
    const toastId = showToast({ kind: "sending", text: "Sending comment…" });
    let created: { url?: string; itemId?: string };
    try {
      const res = await check(await send("POST", "", payload));
      created = (await res.json()) as { url?: string; itemId?: string };
    } catch (error) {
      showToast(
        {
          kind: "error",
          text: (error as Error).message,
          retry: () => void post(payload, pendingId),
        },
        toastId,
      );
      return;
    }

    // replies written while it was sending, now that it has an id
    const queuedTexts = queuedReplies.current.get(pendingId) ?? [];
    queuedReplies.current.delete(pendingId);
    try {
      for (const text of queuedTexts) {
        const id = enc(created.itemId ?? "");
        await check(await send("POST", `?reply_to=${id}`, { text }));
      }
    } catch (error) {
      showToast({
        kind: "error",
        text: `A reply didn't send: ${(error as Error).message}`,
      });
    }

    await load();
    setPending((current) => current.filter((p) => p.id !== pendingId));
    const realId = created.itemId;
    if (realId) {
      // keep the thread the commenter is in open, and what they were typing in it
      setOpenId((current) => (current === pendingId ? realId : current));
      setReplyDrafts((drafts) => {
        const { [pendingId]: draft, ...rest } = drafts;
        return draft ? { ...rest, [realId]: draft } : rest;
      });
    }
    showToast(
      { kind: "ok", text: "Comment added to the PR", url: created.url },
      toastId,
    );
  };

  /**
   * Closes the composer at once and sends in the background. The new thread
   * opens with its reply box focused, ready to carry on the conversation.
   */
  const submit = (draft: Draft, target: Target) => {
    if (!context) return;
    setMode({ kind: "idle" });

    const pendingId = `pending-${nextId++}`;
    const pageUrl = location.href;
    setPending((current) => [
      ...current,
      {
        id: pendingId,
        pending: true,
        author: context.user,
        avatar: context.image,
        authorId: context.userId,
        text: draft.text,
        pageUrl,
        selector: target.selector,
        rect: target.relativeRect,
        pageRect: target.pageRect,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      },
    ]);
    openThread(pendingId);
    void post(
      {
        text: draft.text,
        pageUrl,
        selector: target.selector,
        rect: target.relativeRect,
        pageRect: target.pageRect,
        elementText: target.elementText,
        viewport: { width: innerWidth, height: innerHeight },
        userAgent: navigator.userAgent,
        screenshots: draft.attachments,
        console: draft.includeConsole ? getConsoleEntries() : [],
      },
      pendingId,
    );
  };

  // --- changing a thread: shown at once, undone (and reported) if the server says no ---

  const change = async (
    optimistic: (current: ShownItem[]) => ShownItem[],
    request: () => Promise<Response>,
  ) => {
    setItems(optimistic);
    try {
      await check(await request());
      await load();
    } catch (error) {
      showToast({ kind: "error", text: (error as Error).message });
      void load();
    }
  };

  const patchItem =
    (id: string, patch: Partial<ShownItem>) => (current: ShownItem[]) =>
      current.map((i) => (i.id === id ? { ...i, ...patch } : i));

  const actions: ThreadActions = {
    resolve: (item, resolved) =>
      void change(patchItem(item.id, { resolved }), () =>
        send("PATCH", `?id=${enc(item.id)}`, { resolved }),
      ),
    reply: (item, text) => {
      if (item.pending) {
        // no id to reply to yet: show it now, send it when the comment lands
        queuedReplies.current.set(item.id, [
          ...(queuedReplies.current.get(item.id) ?? []),
          text,
        ]);
        setPending((current) =>
          current.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  replies: [
                    ...p.replies,
                    {
                      id: `pending-reply-${nextId++}`,
                      author: context?.user ?? "",
                      avatar: context?.image ?? null,
                      authorId: context?.userId ?? "",
                      text,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : p,
          ),
        );
        return;
      }
      void change(
        patchItem(item.id, {
          replies: [
            ...item.replies,
            {
              id: `pending-reply-${nextId++}`,
              author: context?.user ?? "",
              avatar: context?.image ?? null,
              authorId: context?.userId ?? "",
              text,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
        () => send("POST", `?reply_to=${enc(item.id)}`, { text }),
      );
    },
    editItem: (item, text) =>
      void change(
        patchItem(item.id, { text, editedAt: new Date().toISOString() }),
        () => send("PATCH", `?id=${enc(item.id)}`, { text }),
      ),
    editReply: (item, reply, text) =>
      void change(
        patchItem(item.id, {
          replies: item.replies.map((r) =>
            r.id === reply.id
              ? { ...r, text, editedAt: new Date().toISOString() }
              : r,
          ),
        }),
        () =>
          send("PATCH", `?id=${enc(item.id)}&reply=${enc(reply.id)}`, { text }),
      ),
    deleteItem: (item) => {
      openThread(null);
      void change(
        (current) => current.filter((i) => i.id !== item.id),
        () => send("DELETE", `?id=${enc(item.id)}`),
      );
    },
    deleteReply: (item, reply) =>
      void change(
        patchItem(item.id, {
          replies: item.replies.filter((r) => r.id !== reply.id),
        }),
        () => send("DELETE", `?id=${enc(item.id)}&reply=${enc(reply.id)}`),
      ),
  };

  /** A dragged pin: the thread now points at whatever is under its rectangle there. */
  const moveItem = (item: ShownItem, rect: Rect) => {
    const target = describeTarget(rect, host);
    const location = {
      selector: target.selector,
      rect: target.relativeRect,
      pageRect: target.pageRect,
    };
    void change(patchItem(item.id, location), () =>
      send("PATCH", `?id=${enc(item.id)}`, {
        ...location,
        elementText: target.elementText,
      }),
    );
  };

  const pickItem = (item: ShownItem) => {
    if (pageKey(item.pageUrl) !== pageKey(location.href)) {
      location.href = item.pageUrl;
      return;
    }
    findElement(item.selector)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    setPanelOpen(false);
    openThread(item.id);
  };

  const shown = [...items, ...pending];
  const count = shown.filter((i) => !i.pending).length;
  const selecting = mode.kind === "selecting";
  const open = shown.find((i) => i.id === openId);
  const onThisPage = open && pageKey(open.pageUrl) === pageKey(location.href);

  return (
    <>
      <style>{STYLES}</style>

      {context && (
        <Pins
          items={shown}
          openId={openId}
          hoverId={hoverId}
          onHover={hover}
          onUnhover={unhover}
          onOpen={(id) => openThread(openId === id ? null : id)}
          onResolve={actions.resolve}
          onMove={moveItem}
        />
      )}
      {context && open && onThisPage && (
        <Thread
          key={open.id}
          item={open}
          rect={locateItem(open)}
          userId={context.userId}
          actions={actions}
          replyText={replyDrafts[open.id] ?? ""}
          onReplyText={(text) =>
            setReplyDrafts((drafts) => ({ ...drafts, [open.id]: text }))
          }
          onClose={closeThread}
        />
      )}
      {selecting && (
        <SelectOverlay
          onSelect={(rect) =>
            setMode({ kind: "composing", target: describeTarget(rect, host) })
          }
          onCancel={() => setMode({ kind: "idle" })}
        />
      )}
      {mode.kind === "composing" && (
        <Composer
          rect={mode.target.rect}
          host={host}
          onSubmit={(draft) => submit(draft, mode.target)}
          onCancel={() => setMode({ kind: "idle" })}
        />
      )}
      {panelOpen && context && (
        <Panel
          style={popoverStyle(pos, PANEL_WIDTH)}
          commentUrl={context.commentUrl}
          items={shown}
          onHover={hover}
          onUnhover={unhover}
          onPick={pickItem}
        />
      )}

      <div class="toasts" style={popoverStyle(pos, TOASTS_WIDTH)}>
        {toasts.map((toast) => (
          <div key={toast.id} class={`toast ${toast.kind}`}>
            <span>{toast.text}</span>
            {toast.url && (
              <a href={toast.url} target="_blank" rel="noreferrer">
                View
              </a>
            )}
            {toast.retry && (
              <button
                type="button"
                onClick={() => {
                  dismissToast(toast.id);
                  toast.retry?.();
                }}
              >
                Retry
              </button>
            )}
            {toast.kind === "error" && (
              <button type="button" onClick={() => dismissToast(toast.id)}>
                Dismiss
              </button>
            )}
          </div>
        ))}
      </div>

      <div
        class="bar"
        style={{ right: pos.right, bottom: pos.bottom }}
        {...dragHandlers}
      >
        <button
          type="button"
          class={`seg icon${selecting ? " active" : ""}`}
          title={
            !token
              ? "Sign in to comment"
              : selecting
                ? "Cancel (Esc)"
                : "Add a comment"
          }
          aria-label={!token ? "Sign in to comment" : "Add a comment"}
          disabled={!!token && !context}
          onClick={() => {
            if (!token) return openSignIn();
            setPanelOpen(false);
            openThread(null);
            setMode(selecting ? { kind: "idle" } : { kind: "selecting" });
          }}
        >
          <CommentIcon />
        </button>
        <button
          type="button"
          class={`seg meta${panelOpen ? " active" : ""}`}
          aria-pressed={panelOpen}
          disabled={!!token && !context}
          title={
            context
              ? panelOpen
                ? "Hide the comments"
                : "Show the comments on this PR"
              : undefined
          }
          onClick={() => {
            if (!token) return openSignIn();
            setPanelOpen((isOpen) => !isOpen);
          }}
        >
          <span class="label">
            {!token
              ? "Sign in"
              : !context
                ? status || "…"
                : `${count} ${count === 1 ? "Comment" : "Comments"}`}
          </span>
          <span class="sub">
            {!token ? "to comment" : context ? `PR #${context.prNumber}` : ""}
          </span>
        </button>
      </div>
    </>
  );
}
