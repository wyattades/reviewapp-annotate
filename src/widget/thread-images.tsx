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

/** In the repo's assets branch, which needs the server (and its sign-in) to read; any other URL is public. */
const isInRepo = (url: string) =>
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(url);

function ThreadImage({
  itemId,
  n,
  url: source,
}: {
  itemId: string;
  n: number;
  url: string;
}) {
  const direct = !isInRepo(source);
  const [loadedUrl, setLoadedUrl] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (direct) return;
    let cancelled = false;
    void loadImage(itemId, n).then((url) => {
      if (!cancelled) setLoadedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [direct, itemId, n]);

  const url = direct ? source : loadedUrl;
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
  urls,
}: {
  itemId: string;
  urls: string[];
}) {
  if (!urls.length) return null;
  return (
    <div class="attachments">
      {urls.map((url, n) => (
        <ThreadImage key={n} itemId={itemId} n={n} url={url} />
      ))}
    </div>
  );
}
