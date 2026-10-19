import { useEffect, useRef, useState } from "preact/hooks";
import { AutoTextarea } from "./auto-textarea";
import { Avatar } from "./avatar";
import { CheckCircleIcon, MoreIcon, SendIcon } from "./icons";
import { THREAD_WIDTH } from "./styles";
import { formatTime } from "./time";
import type { Rect, ShownItem, StoredReply } from "./types";

export type ThreadActions = {
  resolve: (item: ShownItem, resolved: boolean) => void;
  reply: (item: ShownItem, text: string) => void;
  editItem: (item: ShownItem, text: string) => void;
  editReply: (item: ShownItem, reply: StoredReply, text: string) => void;
  deleteItem: (item: ShownItem) => void;
  deleteReply: (item: ShownItem, reply: StoredReply) => void;
};

/** Under the pin if there's room, else above it, always on screen. */
function place(at: Rect) {
  const left = Math.max(8, Math.min(at.x, innerWidth - THREAD_WIDTH - 8));
  const below = at.y + 36;
  if (innerHeight - below >= 320) {
    return { left, top: below, maxHeight: innerHeight - below - 8 };
  }
  return {
    left,
    bottom: Math.max(8, innerHeight - at.y + 8),
    maxHeight: Math.max(160, at.y - 16),
  };
}

/** Enter sends, Shift+Enter makes a new line (and Enter while composing text with an IME is the IME's). */
const onEnter = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    action();
  }
};

type Message = {
  /** "item" for the thread's first comment, else the reply's id */
  key: string;
  author: string;
  avatar: string | null;
  authorId: string;
  text: string;
  createdAt: string;
  editedAt?: string;
};

/** A thread, open next to its pin: the comments, replying, ticking it off, and editing or deleting your own. */
export function Thread({
  item,
  rect,
  userId,
  actions,
  replyText,
  onReplyText,
  onClose,
}: {
  item: ShownItem;
  rect: Rect;
  userId: string;
  actions: ThreadActions;
  /** the reply being typed, kept by the app so it survives the thread being re-keyed when a new comment finishes sending */
  replyText: string;
  onReplyText: (text: string) => void;
  onClose: () => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const replyField = useRef<HTMLTextAreaElement>(null);

  // ready to reply as soon as it opens (once: not on every render)
  useEffect(() => {
    replyField.current?.focus();
  }, []);

  useEffect(() => {
    // Bubble phase, so what's inside the thread gets first say: it stops the
    // events it handles (Escape out of an edit, a click on the thread itself).
    // Not `composedPath()`: it leaves out what's inside our closed shadow root.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const messages: Message[] = [
    { ...item, key: "item" },
    ...item.replies.map((reply) => ({ ...reply, key: reply.id })),
  ];

  const startEdit = (message: Message) => {
    setMenuFor(null);
    setDraft(message.text);
    setEditing(message.key);
  };
  const saveEdit = (message: Message) => {
    const text = draft.trim();
    setEditing(null);
    if (!text || text === message.text) return;
    if (message.key === "item") return actions.editItem(item, text);
    const reply = item.replies.find((r) => r.id === message.key);
    if (reply) actions.editReply(item, reply, text);
  };
  const remove = (message: Message) => {
    setMenuFor(null);
    if (message.key === "item") return actions.deleteItem(item);
    const reply = item.replies.find((r) => r.id === message.key);
    if (reply) actions.deleteReply(item, reply);
  };
  const sendReply = () => {
    const text = replyText.trim();
    if (!text) return;
    onReplyText("");
    actions.reply(item, text);
    // ready for the next one
    replyField.current?.focus();
  };

  return (
    <div
      class="thread card"
      style={place(rect)}
      // a click inside is not a click outside (see the window listeners above)
      onPointerDown={(event) => {
        event.stopPropagation();
        const target = event.target as Element;
        if (!target.closest(".menu-wrap")) setMenuFor(null);
      }}
      // the page's own shortcuts shouldn't fire while typing here; Escape is
      // let through to close the thread, unless it closes a menu first
      onKeyDown={(event) => {
        if (event.key !== "Escape") return event.stopPropagation();
        if (menuFor) {
          setMenuFor(null);
          event.stopPropagation();
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyPress={(event) => event.stopPropagation()}
    >
      {messages.map((message) => {
        const mine = message.authorId === userId && !item.pending;
        const isItem = message.key === "item";
        return (
          <div class="msg" key={message.key}>
            <div class="msg-head">
              <Avatar name={message.author} src={message.avatar} size={28} />
              <span class="who">{message.author}</span>
              <span class="muted">
                {formatTime(message.createdAt)}
                {message.editedAt ? " (edited)" : ""}
              </span>
              <span class="spacer" />
              {isItem && (
                <button
                  type="button"
                  class={`icon-button${item.resolved ? " on" : ""}`}
                  title={item.resolved ? "Reopen" : "Resolve"}
                  aria-pressed={item.resolved}
                  disabled={item.pending}
                  onClick={() => actions.resolve(item, !item.resolved)}
                >
                  <CheckCircleIcon />
                </button>
              )}
              {mine && (
                <span class="menu-wrap">
                  <button
                    type="button"
                    class="icon-button"
                    title="More"
                    onClick={() =>
                      setMenuFor(menuFor === message.key ? null : message.key)
                    }
                  >
                    <MoreIcon />
                  </button>
                  {menuFor === message.key && (
                    <div class="menu">
                      <button type="button" onClick={() => startEdit(message)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        class="danger"
                        onClick={() => remove(message)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </span>
              )}
            </div>
            {editing === message.key ? (
              <div class="edit">
                <AutoTextarea
                  class="field"
                  value={draft}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      // cancels the edit, not the thread
                      event.stopPropagation();
                      setEditing(null);
                    }
                    onEnter(() => saveEdit(message))(event);
                  }}
                  focusOnMount
                />
                <div class="row">
                  <button
                    type="button"
                    class="secondary"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="primary"
                    disabled={!draft.trim()}
                    onClick={() => saveEdit(message)}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div class="text">{message.text}</div>
            )}
          </div>
        );
      })}
      <div class="reply-box">
        <AutoTextarea
          inputRef={replyField}
          class="field"
          rows={1}
          value={replyText}
          placeholder="Reply…"
          onInput={(event) => onReplyText(event.currentTarget.value)}
          onKeyDown={onEnter(sendReply)}
        />
        <button
          type="button"
          class="icon-button"
          title="Send reply"
          disabled={!replyText.trim()}
          // keep the cursor in the box
          onMouseDown={(event) => event.preventDefault()}
          onClick={sendReply}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
