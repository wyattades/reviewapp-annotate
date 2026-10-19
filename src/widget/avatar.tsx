import { useState } from "preact/hooks";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** The same name always gets the same colour, so people without an avatar are still told apart. */
export function colorFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 38%)`;
}

/** An avatar, or the person's initials when there's none or it won't load (e.g. blocked by the page's CSP). */
export function Avatar({
  name,
  src,
  size,
  zIndex,
}: {
  name: string;
  src: string | null;
  size: number;
  /** for avatars that overlap: the one with the higher number is on top */
  zIndex?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = {
    width: size,
    height: size,
    ...(zIndex !== undefined && { zIndex }),
  };
  return src && !failed ? (
    <img
      class="avatar"
      style={style}
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      class="avatar"
      style={{ ...style, background: colorFor(name) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
