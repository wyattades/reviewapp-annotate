import type { JSX, Ref } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** A textarea that grows with its text (up to its CSS `max-height`), so a Shift+Enter new line shows. */
export function AutoTextarea({
  value,
  inputRef,
  focusOnMount,
  ...rest
}: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  focusOnMount?: boolean;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;

  useLayoutEffect(() => {
    const el = typeof ref === "function" ? null : ref.current;
    if (el) grow(el);
  }, [ref, value]);

  useLayoutEffect(() => {
    if (focusOnMount && typeof ref !== "function") ref.current?.focus();
  }, [ref, focusOnMount]);

  return <textarea ref={ref} value={value} {...rest} />;
}
