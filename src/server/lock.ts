import type { GitRefs } from "./github";

/**
 * Runs `run` while holding the lock for `key`, one holder at a time. The key
 * is `owner/name#123` for a PR's review comment: GitHub can't compare-and-swap
 * an edit to a comment, so two people commenting at once would otherwise both
 * read the comment and write back over each other.
 *
 * Bring your own (Redis, a database advisory lock...) or use `githubRefLock`.
 */
export type Lock = <T>(key: string, run: () => Promise<T>) => Promise<T>;

type RefLockOptions = {
  /** a holder older than this is taken to have died, and is pushed aside */
  ttlMs?: number;
  /** how long to wait for a turn before giving up */
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A lock made from GitHub itself, so there's nothing else to run: creating a
 * ref that already exists fails, which makes `refs/reviewapp-annotate/lock-<pr>`
 * a mutex. The ref points at a commit whose message says when it was taken.
 *
 * Taking it is exclusive. Pushing aside a holder that died is best effort
 * (GitHub can't update a ref conditionally), so after a crash two waiters
 * could briefly overlap. It costs a few API calls per write: with Redis at
 * hand, a Redis lock is cheaper.
 */
export function githubRefLock(
  refs: GitRefs,
  {
    ttlMs = 60_000,
    waitMs = 25_000,
    pollMs = 250,
    now = Date.now,
  }: RefLockOptions = {},
): Lock {
  return async (key, run) => {
    const at = key.lastIndexOf("#");
    const repo = key.slice(0, at);
    const ref = `refs/reviewapp-annotate/lock-${key.slice(at + 1)}`;
    const holder = crypto.randomUUID();
    const giveUpAt = now() + waitMs;

    for (;;) {
      const commit = await refs.createCommit(repo, `lock ${now()} ${holder}`);
      if (await refs.createRef(repo, ref, commit)) break;

      const current = await refs.getRef(repo, ref);
      if (current) {
        const heldAt = await refs
          .getCommitMessage(repo, current)
          .then((message) => Number(/^lock (\d+)/.exec(message)?.[1]))
          .catch(() => NaN);
        if (now() - heldAt > ttlMs) {
          // whoever took it never let go: only remove the one we saw
          if ((await refs.getRef(repo, ref)) === current) {
            await refs.deleteRef(repo, ref);
          }
          continue;
        }
      }
      if (now() > giveUpAt) {
        throw new Error(
          `Timed out waiting for the review comment lock on ${key}`,
        );
      }
      await sleep(pollMs + Math.random() * pollMs);
    }

    try {
      return await run();
    } finally {
      await refs.deleteRef(repo, ref);
    }
  };
}
