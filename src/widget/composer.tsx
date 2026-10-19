import { useEffect, useRef, useState } from "preact/hooks";
import { captureRegion, imageToJpeg } from "./capture";
import { hasRegion } from "./geometry";
import { CloseIcon } from "./icons";
import type { Attachment, Draft, Rect } from "./types";

/** The server takes up to this many images per comment. */
const MAX_ATTACHMENTS = 3;

let nextId = 0;
const newId = () => `attachment-${nextId++}`;

/** Where the composer goes: under the rectangle if there's room, else above, always on screen. */
function place(rect: Rect) {
  const width = 320;
  const height = 250;
  const left = Math.max(8, Math.min(rect.x, innerWidth - width - 8));
  const below = rect.y + rect.h + 8;
  const top =
    below + height <= innerHeight
      ? below
      : Math.max(8, Math.min(rect.y - height - 8, innerHeight - height - 8));
  return { left, top };
}

export function Composer({
  rect,
  host,
  onSubmit,
  onCancel,
}: {
  rect: Rect;
  host: Element;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [includeConsole, setIncludeConsole] = useState(false);
  // dragging a region screenshots it; a click just drops a pin, with no screenshot
  const region = hasRegion(rect);
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    region ? [{ id: newId(), kind: "screenshot", dataUrl: null }] : [],
  );
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    if (!region) return;
    let cancelled = false;
    void captureRegion(rect, host).then((dataUrl) => {
      if (cancelled) return;
      // a region that couldn't be rendered just has no screenshot
      setAttachments((current) =>
        dataUrl
          ? current.map((a) =>
              a.kind === "screenshot" ? { ...a, dataUrl } : a,
            )
          : current.filter((a) => a.kind !== "screenshot"),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [rect, host, region]);

  const remove = (id: string) =>
    setAttachments((current) => current.filter((a) => a.id !== id));

  const handlePaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return; // plain text: let it paste
    event.preventDefault();

    const room = MAX_ATTACHMENTS - attachments.length;
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = newId();
      setAttachments((current) => [
        ...current,
        { id, kind: "pasted", dataUrl: null },
      ]);
      void imageToJpeg(file).then((dataUrl) =>
        setAttachments((current) =>
          dataUrl
            ? current.map((a) => (a.id === id ? { ...a, dataUrl } : a))
            : current.filter((a) => a.id !== id),
        ),
      );
    }
  };

  const ready = attachments.every((a) => a.dataUrl);
  const canSend = text.trim().length > 0 && ready;
  const send = () => {
    if (!canSend) return;
    onSubmit({
      text,
      includeConsole,
      attachments: attachments.flatMap((a) => (a.dataUrl ? [a.dataUrl] : [])),
    });
  };

  const { left, top } = place(rect);
  return (
    <>
      {region && (
        <div
          class="region"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        />
      )}
      <div
        class="composer card"
        style={{ left, top }}
        // the page's own shortcuts shouldn't fire while typing here
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onKeyPress={(event) => event.stopPropagation()}
      >
        <textarea
          class="field"
          ref={area}
          value={text}
          placeholder="What should change here? (Enter to send, paste images too)"
          onInput={(event) => setText(event.currentTarget.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
            // Enter sends; Shift+Enter makes a new line
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        {attachments.length > 0 && (
          <div class="attachments">
            {attachments.map((a) => (
              <div class="attachment" key={a.id}>
                {a.dataUrl ? (
                  <img src={a.dataUrl} alt="attachment" />
                ) : (
                  "Capturing…"
                )}
                <button
                  class="remove"
                  type="button"
                  title="Remove"
                  onClick={() => remove(a.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        <label>
          <input
            type="checkbox"
            checked={includeConsole}
            onChange={(event) => setIncludeConsole(event.currentTarget.checked)}
          />{" "}
          Attach console log
        </label>
        <div class="row">
          <button type="button" class="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            disabled={!canSend}
            onClick={send}
          >
            Comment
          </button>
        </div>
      </div>
    </>
  );
}
