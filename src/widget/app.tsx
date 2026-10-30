import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, listenForToken, openSignIn, send, tokenStore } from "./api";
import { popoverStyle, useBarPosition } from "./bar-position";
import { Composer } from "./composer";
import { getConsoleEntries } from "./console-capture";
import { describeTarget, findElement, locateItem, pageKey } from "./geometry";
import { ArrowUpRightIcon, CommentIcon, PlusIcon } from "./icons";
import { Panel } from "./panel";
import { Pins } from "./pins";
import { SelectOverlay } from "./select-overlay";
import { PANEL_WIDTH, STYLES } from "./styles";
import { Thread, type ThreadActions } from "./thread";
import type { Context, Draft, Rect, ShownItem, Target } from "./types";

const POLL_MS = 10_000;
/** How long a problem that can't be retried stays in the pill. */
const PROBLEM_MS = 8_000;
/** Dispatched by `index.tsx` when a single-page app changes the URL without a page load. */
export const NAVIGATE_EVENT = "reviewapp-annotate-navigate";

type Mode =
  | { kind: "idle" }
  /** `touch`: started by a tap, so the hints talk about tapping, not Esc and clicks */
  | { kind: "selecting"; touch: boolean }
  | { kind: "composing"; target: Target };

/** Something that didn't save, shown in the pill. */
type Problem = { id: number; text: string; retry?: () => void };

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
  /** requests in flight: the pill spins while there are any */
  const [savingCount, setSavingCount] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** the reply being typed in each thread, by thread id */
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [, setLayoutTick] = useState(0);
  const queued = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  /** replies written to a comment that's still sending, to go out once it has an id */
  const queuedReplies = useRef(new Map<string, string[]>());
  /** whether the round button was last pressed by a finger */
  const touchRef = useRef(false);
  const {
    pos,
    grabbing,
    dragging,
    handlers: dragHandlers,
  } = useBarPosition(() => showList());

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

  // --- what the pill shows: a spinner while saving, and what went wrong ---

  /** Runs `request` with the pill's spinner showing. */
  const saving = async <T,>(request: () => Promise<T>) => {
    setSavingCount((n) => n + 1);
    try {
      return await request();
    } finally {
      setSavingCount((n) => n - 1);
    }
  };

  /** Shows a problem in the pill: one that can be retried stays until it is, others clear themselves. */
  const report = (text: string, retry?: () => void) => {
    const id = nextId++;
    setProblem({ id, text, retry });
    if (!retry) {
      setTimeout(
        () => setProblem((current) => (current?.id === id ? null : current)),
        PROBLEM_MS,
      );
    }
  };

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
    let created: { url?: string; itemId?: string };
    try {
      const res = await saving(async () =>
        check(await send("POST", "", payload)),
      );
      created = (await res.json()) as { url?: string; itemId?: string };
      setProblem(null);
    } catch (error) {
      console.error("[reviewapp-annotate] comment not sent:", error);
      report(`Not sent: ${(error as Error).message}`, () => {
        setProblem(null);
        void post(payload, pendingId);
      });
      return;
    }

    // replies written while it was sending, now that it has an id
    const queuedTexts = queuedReplies.current.get(pendingId) ?? [];
    queuedReplies.current.delete(pendingId);
    try {
      for (const text of queuedTexts) {
        const id = enc(created.itemId ?? "");
        await saving(async () =>
          check(await send("POST", `?reply_to=${id}`, { text })),
        );
      }
    } catch (error) {
      report(`A reply didn't send: ${(error as Error).message}`);
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
        // not uploaded yet: the thread shows them once it's on the PR
        imageUrls: [],
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
      await saving(async () => check(await request()));
      await load();
    } catch (error) {
      report((error as Error).message);
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

  const startSelecting = () => {
    setPanelOpen(false);
    openThread(null);
    setMode({ kind: "selecting", touch: touchRef.current });
  };
  /** A long press or double-click on the round button: everyone's comments. */
  const showList = () => {
    if (!token || !context) return;
    setMode({ kind: "idle" });
    openThread(null);
    setPanelOpen((isOpen) => !isOpen);
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
          touch={mode.touch}
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
          style={popoverStyle(pos, Math.min(PANEL_WIDTH, innerWidth - 16))}
          commentUrl={context.commentUrl}
          prNumber={context.prNumber}
          items={shown}
          onHover={hover}
          onUnhover={unhover}
          onPick={pickItem}
        />
      )}

      <div
        class={`bar${grabbing ? " grabbing" : ""}${dragging ? " dragging" : ""}`}
        style={{ right: pos.right, bottom: pos.bottom }}
        {...dragHandlers}
      >
        <button
          type="button"
          class={`seg round${selecting || panelOpen ? " active" : ""}`}
          aria-pressed={panelOpen}
          title={
            !token
              ? "Sign in to comment"
              : selecting
                ? "Cancel the comment"
                : "Add a comment · double-click or long-press for all comments"
          }
          aria-label={
            !token
              ? "Sign in to comment"
              : selecting
                ? "Cancel the comment"
                : context
                  ? `Add a comment (${count} on PR #${context.prNumber})`
                  : status || "Loading comments"
          }
          disabled={!!token && !context}
          onPointerDown={(event) => {
            touchRef.current = event.pointerType === "touch";
          }}
          onClick={(event) => {
            if (!token) return openSignIn();
            // the second click of a double-click: the list, not another comment
            if (event.detail >= 2) return showList();
            if (selecting) return setMode({ kind: "idle" });
            startSelecting();
          }}
        >
          <CommentIcon />
          {!token && (
            <span class="count" aria-hidden="true">
              <ArrowUpRightIcon />
            </span>
          )}
          {token && context && (
            <span
              class={`count${!savingCount && count > 9 ? " wide" : ""}`}
              aria-hidden="true"
            >
              {savingCount > 0 ? (
                <span class="spinner" />
              ) : count > 0 ? (
                count > 99 ? (
                  "99+"
                ) : (
                  count
                )
              ) : (
                <PlusIcon />
              )}
            </span>
          )}
        </button>
        {problem && (
          <button
            type="button"
            class="seg problem"
            title={problem.text}
            onClick={() => (problem.retry ? problem.retry() : setProblem(null))}
          >
            <span class="label">
              {problem.retry ? "Not sent" : "Couldn't save"}
            </span>
            <span class="sub">{problem.retry ? "Retry" : "Dismiss"}</span>
          </button>
        )}
      </div>
    </>
  );
}
