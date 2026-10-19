import type { GitHubPort, PullSummary } from "./github";
import { normalizeOrigin } from "./origin";
import type { Provider } from "./providers";
import type { SharedCache } from "./shared-cache";

/** The PR a review app belongs to. */
export type ReviewTarget = {
  /** `owner/name` */
  repo: string;
  prNumber: number;
};

/** Open PRs to match branch names against: listing is cheap, so all of them. */
const OPEN_LIMIT = 300;
/** Then, the most recently updated PRs (closed ones too: a preview outlives its PR) to read blind. */
const RECENT_LIMIT = 30;
/** PRs whose comments are read at once. */
const BATCH = 10;
const HIT_TTL_S = 60 * 60;
const MISS_TTL_S = 30;

const slug = (branch: string) =>
  branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type Known = {
  target: ReviewTarget;
  state: PullSummary["state"];
  /** when we learned it, ms */
  at: number;
};

const cacheKey = (kind: "pr" | "miss", hostname: string) =>
  `reviewapp-annotate:${kind}:${hostname}`;

/**
 * Finds a review app's PR from its origin, without asking the hosting
 * providers anything: their bots announce each preview in a comment on the
 * PR, so it reads PR comments (from the providers' own accounts only) and
 * remembers every hostname it sees. Branch names in the hostname say which
 * PRs to read first; a custom domain with no branch in it takes a wider look.
 *
 * What it learns is kept in memory, and in `sharedCache` if there is one, so a
 * cold instance doesn't start over.
 */
export function createReviewAppPrFinder({
  github,
  repos,
  providers,
  sharedCache,
  onError,
  now = Date.now,
}: {
  github: GitHubPort;
  repos: string[];
  providers: Provider[];
  sharedCache?: SharedCache;
  onError?: (
    error: unknown,
    context: { what: string; [key: string]: unknown },
  ) => void;
  now?: () => number;
}) {
  /** hostname → its PR, as far as we've read */
  const known = new Map<string, Known>();
  /** `repo#pr` → the `updatedAt` we last read its comments at */
  const read = new Map<string, string>();
  const misses = new Map<string, number>();

  /** The shared cache is a speed-up: if it fails, carry on without it. */
  async function cached<T>(
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

  function remember(
    host: string,
    repo: string,
    pull: PullSummary,
    learned: Set<string>,
  ) {
    const existing = known.get(host);
    // the same preview named on an open and a closed PR: the open one
    if (existing?.state === "open" && pull.state === "closed") return;
    known.set(host, {
      target: { repo, prNumber: pull.number },
      state: pull.state,
      at: now(),
    });
    learned.add(host);
  }

  async function readPull(
    repo: string,
    pull: PullSummary,
    learned: Set<string>,
  ) {
    const key = `${repo}#${pull.number}`;
    if (read.get(key) === pull.updatedAt) return;
    try {
      for (const comment of await github.listComments(repo, pull.number)) {
        for (const provider of providers) {
          if (!provider.botLogins.includes(comment.authorLogin)) continue;
          for (const host of provider.parseComment(comment.body)) {
            remember(host, repo, pull, learned);
          }
        }
      }
      read.set(key, pull.updatedAt);
    } catch (error) {
      // one PR we can't read shouldn't stop the search
      onError?.(error, { what: "readPullComments", repo, pr: pull.number });
    }
  }

  const fresh = (host: string) => {
    const hit = known.get(host);
    return hit && now() - hit.at < HIT_TTL_S * 1000 ? hit.target : null;
  };

  /** Writes what a search learned to the shared cache: every hostname it came across, not just the one asked for. */
  async function share(learned: Set<string>) {
    const writes = [...learned].flatMap((host) => {
      const entry = known.get(host);
      if (!entry) return [];
      const value = JSON.stringify({ ...entry.target, state: entry.state });
      return [
        cached("sharePr", (cache) =>
          cache.set(cacheKey("pr", host), value, HIT_TTL_S),
        ),
      ];
    });
    await Promise.all(writes);
  }

  async function fromSharedCache(
    hostname: string,
  ): Promise<ReviewTarget | null | undefined> {
    const hit = await cached("readSharedPr", (cache) =>
      cache.get(cacheKey("pr", hostname)),
    );
    if (hit) {
      try {
        const { repo, prNumber, state } = JSON.parse(hit) as ReviewTarget & {
          state: PullSummary["state"];
        };
        known.set(hostname, { target: { repo, prNumber }, state, at: now() });
        return { repo, prNumber };
      } catch {
        // garbled: look it up afresh
      }
    }
    const miss = await cached("readSharedMiss", (cache) =>
      cache.get(cacheKey("miss", hostname)),
    );
    return miss ? null : undefined;
  }

  /** The PR whose provider comment names this origin, or null. */
  async function find(origin: string): Promise<ReviewTarget | null> {
    const parsed = normalizeOrigin(origin);
    if (!parsed) return null;
    const { hostname } = parsed;

    const hit = fresh(hostname);
    if (hit) return hit;
    const missedAt = misses.get(hostname);
    if (missedAt && now() - missedAt < MISS_TTL_S * 1000) return null;

    // another instance may already have found it
    const shared = await fromSharedCache(hostname);
    if (shared) return shared;
    if (shared === null) {
      misses.set(hostname, now());
      return null;
    }

    const learned = new Set<string>();
    try {
      const found = await search(hostname, learned);
      if (found) return found;
    } finally {
      await share(learned);
    }

    misses.set(hostname, now());
    await cached("shareMiss", (cache) =>
      cache.set(cacheKey("miss", hostname), "1", MISS_TTL_S),
    );
    return null;
  }

  type Candidate = { repo: string; pull: PullSummary };

  async function candidates(
    state: "open" | "all",
    limit: number,
    keep: (pull: PullSummary) => boolean = () => true,
  ): Promise<Candidate[]> {
    return (
      await Promise.all(
        repos.map(async (repo) =>
          (await github.listPulls(repo, { limit, state }))
            .filter(keep)
            .map((pull) => ({ repo, pull })),
        ),
      )
    ).flat();
  }

  /** Reads these PRs' comments, ten at a time, until the hostname turns up. */
  async function readUntilFound(
    list: Candidate[],
    hostname: string,
    learned: Set<string>,
  ) {
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(
        list.slice(i, i + BATCH).map((c) => readPull(c.repo, c.pull, learned)),
      );
      const found = fresh(hostname);
      if (found) return found;
    }
    return null;
  }

  async function search(hostname: string, learned: Set<string>) {
    // Hostnames usually carry the branch name (cut short, sometimes), so most
    // review apps are found by reading the one or two open PRs it names.
    const named = (pull: PullSummary) => {
      const start = slug(pull.headRef).slice(0, 10);
      return start.length >= 4 && hostname.includes(start);
    };
    const byName = await readUntilFound(
      await candidates("open", OPEN_LIMIT, named),
      hostname,
      learned,
    );
    if (byName) return byName;

    // Otherwise (a custom domain, a deployment's own URL), read the recent PRs blind.
    return readUntilFound(
      await candidates("all", RECENT_LIMIT),
      hostname,
      learned,
    );
  }

  return { find };
}

export type ReviewAppPrFinder = ReturnType<typeof createReviewAppPrFinder>;
