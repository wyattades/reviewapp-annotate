import type { StoredItem, StoredReply } from "../shared";
import {
  addReply,
  appendItem,
  COMMENT_MARKER,
  editItemText,
  editReplyText,
  moveItem,
  type ItemLocation,
  parseItems,
  removeItem,
  removeReply,
  setResolved,
  type ReviewItem,
} from "./comment";
import type { UploadedImage } from "./config";
import type { GitHubPort } from "./github";
import type { Lock } from "./lock";
import type { ReviewTarget } from "./review-app-pr-finder";
import type { SharedCache } from "./shared-cache";

export type NewReview = Omit<
  ReviewItem,
  "id" | "createdAt" | "screenshotUrls"
> & {
  /** base64, no data-URL prefix */
  screenshotsJpegBase64?: string[];
};

type CachedComment = { etag: string; items: StoredItem[] };
type PrState = {
  /** our comment ids, in order */
  ids: number[];
  foundAt: number;
  /** a comment we were told about has gone: look at GitHub itself next time */
  skipSharedIds: boolean;
  comments: Map<number, CachedComment>;
};

/** How often to look again for review comments we haven't seen (e.g. a second one another instance started). */
const REDISCOVER_MS = 60_000;

/** The shared list of a PR's review comment ids: short, so a second comment is soon noticed. */
const IDS_TTL_S = 60;

const prKey = ({ repo, prNumber }: ReviewTarget) => `${repo}#${prNumber}`;
const idsKey = (target: ReviewTarget) =>
  `reviewapp-annotate:comment-ids:${prKey(target)}`;
const now = () => new Date().toISOString();
const shortId = () => crypto.randomUUID().slice(0, 8);

/** The PR's review comments: reading everyone's threads, and adding to or changing them. */
export function createThreadStore({
  github,
  lock,
  assetsBranch,
  uploadImage,
  sharedCache,
  onError,
}: {
  github: GitHubPort;
  lock: Lock;
  /** an orphan branch that holds screenshots, since a comment can't take an upload */
  assetsBranch: string;
  /** stores images somewhere else instead (see `ReviewAnnotateConfig.uploadImage`) */
  uploadImage?: (image: UploadedImage) => Promise<string>;
  /** where instances share which comments are the review comments, so a cold one needn't list them all */
  sharedCache?: SharedCache;
  onError?: (
    error: unknown,
    context: { what: string; [key: string]: unknown },
  ) => void;
}) {
  const prStates = new Map<string, PrState>();

  /** The shared cache is a speed-up: if it fails, carry on without it. */
  async function viaCache<T>(
    what: string,
    run: (cache: SharedCache) => Promise<T>,
  ) {
    if (!sharedCache) return undefined;
    try {
      return await run(sharedCache);
    } catch (error) {
      onError?.(error, { what });
      return undefined;
    }
  }

  async function sharedIds(target: ReviewTarget) {
    const value = await viaCache("readSharedCommentIds", (cache) =>
      cache.get(idsKey(target)),
    );
    if (!value) return undefined;
    try {
      const ids = JSON.parse(value) as unknown;
      return Array.isArray(ids) && ids.length > 0 && ids.every(Number.isInteger)
        ? (ids as number[])
        : undefined;
    } catch {
      return undefined;
    }
  }

  const shareIds = (target: ReviewTarget, ids: number[]) =>
    viaCache("shareCommentIds", (cache) =>
      cache.set(idsKey(target), JSON.stringify(ids), IDS_TTL_S),
    );

  /**
   * Our review comments on a PR: the marker alone isn't enough, since anyone
   * can paste it into a comment we then couldn't edit. Other things our GitHub
   * app posts (it may be shared) have no marker, so they're left alone.
   */
  async function findReviewAnnotate(target: ReviewTarget) {
    const [login, comments] = await Promise.all([
      github.botLogin(),
      github.listComments(target.repo, target.prNumber),
    ]);
    return comments.filter(
      (c) => c.body.startsWith(COMMENT_MARKER) && c.authorLogin === login,
    );
  }

  /** A comment, or its cached copy when GitHub says it's unchanged. */
  async function readComment(
    target: ReviewTarget,
    id: number,
    cached?: CachedComment,
  ): Promise<CachedComment | null> {
    const res = await github.getComment(
      target.repo,
      id,
      cached?.etag || undefined,
    );
    if (res.kind === "gone") return null;
    if (res.kind === "not-modified" && cached) return cached;
    if (res.kind === "not-modified") return null;
    return { etag: res.etag, items: parseItems(res.body) };
  }

  /**
   * Everyone's threads on the PR's review app. Every open page polls this, so
   * after finding our comment once it only re-reads that comment, conditionally.
   */
  async function list(target: ReviewTarget) {
    const key = prKey(target);
    const state = prStates.get(key) ?? {
      ids: [],
      foundAt: 0,
      skipSharedIds: false,
      comments: new Map<number, CachedComment>(),
    };
    prStates.set(key, state);

    if (Date.now() - state.foundAt > REDISCOVER_MS) {
      // another instance may have found them already: then there's no need to
      // list every comment on the PR
      const ids = state.skipSharedIds ? undefined : await sharedIds(target);
      if (ids) {
        state.ids = ids;
        state.foundAt = Date.now();
      } else {
        const found = await findReviewAnnotate(target);
        state.ids = found.map((c) => c.id);
        state.foundAt = Date.now();
        state.skipSharedIds = false;
        for (const c of found) {
          // the list has no per-comment ETag: the next read fetches it in full
          state.comments.set(c.id, { etag: "", items: parseItems(c.body) });
        }
        if (state.ids.length) await shareIds(target, state.ids);
      }
    }

    const comments = await Promise.all(
      state.ids.map((id) => readComment(target, id, state.comments.get(id))),
    );
    const items = comments.flatMap((comment, i) => {
      if (!comment) return [];
      state.comments.set(state.ids[i]!, comment);
      return comment.items;
    });
    if (comments.includes(null)) {
      // one has gone (deleted): look at the PR itself, not the shared list, next time
      state.foundAt = 0;
      state.skipSharedIds = true;
    }
    return { items, firstCommentId: state.ids[0] ?? null };
  }

  /** Adds a new thread to the PR's review comment, starting one if needed. */
  async function post(target: ReviewTarget, review: NewReview) {
    const { screenshotsJpegBase64 = [], ...rest } = review;

    // images in storage of the host's own don't conflict with each other: they
    // go up before taking the lock, at the same time
    const uploaded = uploadImage
      ? await Promise.all(
          screenshotsJpegBase64.map((jpegBase64) =>
            uploadImage({
              bytes: Uint8Array.from(atob(jpegBase64), (c) => c.charCodeAt(0)),
              contentType: "image/jpeg",
              name: `${Date.now()}-${shortId()}.jpg`,
              repo: target.repo,
              prNumber: target.prNumber,
            }),
          ),
        )
      : null;

    // one at a time per PR: two posts at once would otherwise both append to
    // the same body (the second write drops the first) and both commit
    // screenshots to the same branch (the second commit conflicts)
    const itemId = await lock(prKey(target), async () => {
      const screenshotUrls: string[] = uploaded ?? [];
      for (const jpegBase64 of uploaded ? [] : screenshotsJpegBase64) {
        screenshotUrls.push(
          await github.uploadAsset(target.repo, {
            branch: assetsBranch,
            path: `pr-${target.prNumber}/${Date.now()}-${shortId()}.jpg`,
            jpegBase64,
            message: `Screenshot for PR #${target.prNumber}`,
          }),
        );
      }
      const item: ReviewItem = {
        ...rest,
        id: shortId(),
        createdAt: new Date(),
        screenshotUrls,
      };

      const existing = await findReviewAnnotate(target);
      const latest = existing.at(-1);
      const appended = appendItem(latest?.body ?? null, item);
      if (latest && appended) {
        await github.updateComment(target.repo, latest.id, appended);
      } else {
        // the first comment, or the last one is full
        const created = await github.createComment(
          target.repo,
          target.prNumber,
          appendItem(null, item)!,
        );
        await shareIds(target, [...existing.map((c) => c.id), created.id]);
      }
      return item.id;
    });

    // read it again, and look for a new comment, on the next poll
    prStates.delete(prKey(target));
    return {
      url: `https://github.com/${target.repo}/pull/${target.prNumber}`,
      itemId,
    };
  }

  /**
   * Changes one thread in whichever of the PR's review comments holds it.
   * `transform` gets a comment's body and returns the new one, or null when
   * the thread isn't in it (or the caller may not change it). False if no
   * comment took it.
   */
  async function updateThread(
    target: ReviewTarget,
    transform: (body: string) => string | null,
  ) {
    // read-change-write, one at a time per PR: a second editor would overwrite the first
    const changed = await lock(prKey(target), async () => {
      for (const comment of await findReviewAnnotate(target)) {
        const body = transform(comment.body);
        if (body === null) continue;
        await github.updateComment(target.repo, comment.id, body);
        return true;
      }
      return false;
    });
    prStates.delete(prKey(target));
    return changed;
  }

  return {
    list,
    post,

    /** Anyone can tick a thread off; only its author can edit or delete it. */
    resolve: (target: ReviewTarget, id: string, resolved: boolean) =>
      updateThread(target, (body) => setResolved(body, id, resolved)),

    /** Anyone can point a thread somewhere else, like ticking it off. */
    move: (target: ReviewTarget, id: string, location: ItemLocation) =>
      updateThread(target, (body) => moveItem(body, id, location)),

    remove: (target: ReviewTarget, id: string, userId: string) =>
      updateThread(target, (body) =>
        removeItem(body, id, (item) => item.authorId === userId),
      ),

    edit: (target: ReviewTarget, id: string, userId: string, text: string) =>
      updateThread(target, (body) =>
        editItemText(body, id, text, (item) => item.authorId === userId, now()),
      ),

    reply: (
      target: ReviewTarget,
      id: string,
      reply: Pick<StoredReply, "author" | "avatar" | "authorId" | "text">,
    ) =>
      updateThread(target, (body) =>
        addReply(body, id, { ...reply, id: shortId(), createdAt: new Date() }),
      ),

    removeReply: (
      target: ReviewTarget,
      id: string,
      replyId: string,
      userId: string,
    ) =>
      updateThread(target, (body) =>
        removeReply(body, id, replyId, (reply) => reply.authorId === userId),
      ),

    editReply: (
      target: ReviewTarget,
      id: string,
      replyId: string,
      userId: string,
      text: string,
    ) =>
      updateThread(target, (body) =>
        editReplyText(
          body,
          id,
          replyId,
          text,
          (reply) => reply.authorId === userId,
          now(),
        ),
      ),
  };
}

export type ThreadStore = ReturnType<typeof createThreadStore>;
