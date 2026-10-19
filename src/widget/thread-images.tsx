import { useEffect, useState } from "preact/hooks";
import { api } from "./api";

/**
 * Images, loaded once and kept for the page's life: by thread id and index.
 * They come through the server (`/asset`), with the sign-in token, since the
 * repo they're stored in may be private.
 */
const loaded = new Map<string, Promise<string | null>>();

function loadImage(itemId: string, n: number) {
  const key = `${itemId}:${n}`;
  let image = loaded.get(key);
  if (!image) {
    image = api(`/asset?id=${encodeURIComponent(itemId)}&n=${n}`)
      .then(async (res) =>
        res.ok ? URL.createObjectURL(await res.blob()) : null,
      )
      .catch(() => null);
    // a failure is tried again next time the thread opens
    void image.then((url) => url ?? loaded.delete(key));
    loaded.set(key, image);
  }
  return image;
}

function ThreadImage({ itemId, n }: { itemId: string; n: number }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadImage(itemId, n).then((loadedUrl) => {
      if (!cancelled) setUrl(loadedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, n]);

  if (url === null) return <div class="attachment">Unavailable</div>;
  if (!url) return <div class="attachment">Loading…</div>;
  return (
    <a
      class="attachment"
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open full size"
    >
      <img src={url} alt={`Image ${n + 1}`} />
    </a>
  );
}

/** A thread's screenshots and pasted images, as thumbnails that open full size. */
export function ThreadImages({
  itemId,
  count,
}: {
  itemId: string;
  count: number;
}) {
  if (!count) return null;
  return (
    <div class="attachments">
      {Array.from({ length: count }, (_, n) => (
        <ThreadImage key={n} itemId={itemId} n={n} />
      ))}
    </div>
  );
}
