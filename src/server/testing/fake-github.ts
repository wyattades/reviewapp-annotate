import type { GitHubPort, PullSummary } from "../github";

type FakeComment = {
  id: number;
  issue: number;
  body: string;
  authorLogin: string;
  /** bumps on every change, standing in for the ETag */
  version: number;
};

/**
 * GitHub in memory, for tests: PRs with comments, git refs that can't be
 * created twice, and uploaded assets. `calls` counts what was asked of it.
 */
export function createFakeGitHub({
  botLogin = "review-app[bot]",
  /** each call takes this long, so concurrent callers really interleave */
  latencyMs = 0,
} = {}) {
  const pulls = new Map<string, PullSummary[]>();
  const comments = new Map<string, Map<number, FakeComment>>();
  const refs = new Map<string, string>();
  const commits = new Map<string, string>();
  const assets: { repo: string; path: string; branch: string }[] = [];
  const assetBytes = new Map<string, Uint8Array<ArrayBuffer>>();
  const calls: Record<string, number> = {};
  let nextId = 1;
  let nextSha = 1;

  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  const wait = () =>
    latencyMs
      ? new Promise((resolve) => setTimeout(resolve, latencyMs))
      : undefined;
  const repoComments = (repo: string) => {
    let all = comments.get(repo);
    if (!all) comments.set(repo, (all = new Map<number, FakeComment>()));
    return all;
  };

  const port: GitHubPort = {
    async botLogin() {
      return botLogin;
    },

    async listPulls(repo, { limit, state }) {
      count("listPulls");
      await wait();
      return [...(pulls.get(repo) ?? [])]
        .filter((pull) => state === "all" || pull.state === "open")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
    },

    async listComments(repo, issue) {
      count("listComments");
      await wait();
      return [...repoComments(repo).values()]
        .filter((c) => c.issue === issue)
        .sort((a, b) => a.id - b.id)
        .map(({ id, body, authorLogin }) => ({ id, body, authorLogin }));
    },

    async getComment(repo, id, etag) {
      count("getComment");
      await wait();
      const comment = repoComments(repo).get(id);
      if (!comment) return { kind: "gone" };
      const current = String(comment.version);
      if (etag === current) return { kind: "not-modified" };
      return { kind: "ok", body: comment.body, etag: current };
    },

    async createComment(repo, issue, body) {
      count("createComment");
      await wait();
      const id = nextId++;
      repoComments(repo).set(id, {
        id,
        issue,
        body,
        authorLogin: botLogin,
        version: 1,
      });
      return { id };
    },

    async updateComment(repo, id, body) {
      count("updateComment");
      await wait();
      const comment = repoComments(repo).get(id);
      if (!comment) throw new Error("no such comment");
      comment.body = body;
      comment.version++;
    },

    async uploadAsset(repo, { branch, path, jpegBase64 }) {
      count("uploadAsset");
      assets.push({ repo, branch, path });
      const url = `https://assets.test/${repo}/${branch}/${path}`;
      assetBytes.set(
        url,
        Uint8Array.from(atob(jpegBase64), (c) => c.charCodeAt(0)),
      );
      return url;
    },

    async readAsset(repo, branch, url) {
      count("readAsset");
      if (!url.startsWith(`https://assets.test/${repo}/${branch}/`))
        return null;
      return assetBytes.get(url) ?? null;
    },

    refs: {
      async createCommit(_repo, message) {
        const sha = `sha${nextSha++}`;
        commits.set(sha, message);
        return sha;
      },
      async createRef(repo, ref, sha) {
        count("createRef");
        const key = `${repo}|${ref}`;
        if (refs.has(key)) return false;
        refs.set(key, sha);
        return true;
      },
      async getRef(repo, ref) {
        return refs.get(`${repo}|${ref}`) ?? null;
      },
      async getCommitMessage(_repo, sha) {
        const message = commits.get(sha);
        if (message === undefined) throw new Error("no such commit");
        return message;
      },
      async deleteRef(repo, ref) {
        count("deleteRef");
        refs.delete(`${repo}|${ref}`);
      },
    },
  };

  return {
    port,
    calls,
    assets,
    refs,
    commits,
    addPull(repo: string, pull: Partial<PullSummary> & { number: number }) {
      const all = pulls.get(repo) ?? [];
      all.push({
        state: "open",
        headRef: `branch-${pull.number}`,
        updatedAt: new Date(2026, 9, 19, 12, pull.number).toISOString(),
        ...pull,
      });
      pulls.set(repo, all);
    },
    /** a comment someone (a provider's bot, a person) left on a PR */
    addComment(
      repo: string,
      issue: number,
      comment: { authorLogin: string; body: string },
    ) {
      const id = nextId++;
      repoComments(repo).set(id, { id, issue, version: 1, ...comment });
      return id;
    },
    removeComment(repo: string, id: number) {
      repoComments(repo).delete(id);
    },
    /** the review comments (ours) on a PR, as text */
    reviewBodies(repo: string, issue: number) {
      return [...repoComments(repo).values()]
        .filter((c) => c.issue === issue && c.authorLogin === botLogin)
        .map((c) => c.body);
    },
  };
}

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
