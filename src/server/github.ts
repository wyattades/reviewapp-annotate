import { App } from "octokit";
import type { SharedCache } from "./shared-cache";

/**
 * What the server needs from GitHub, as a port: `createOctokitGitHub` is the
 * real one (a GitHub App), and tests use an in-memory fake.
 */

export type PullSummary = {
  number: number;
  state: "open" | "closed";
  headRef: string;
  updatedAt: string;
};

export type IssueComment = { id: number; body: string; authorLogin: string };

export type GitRefs = {
  /** a commit with no files (on the empty tree), after `parent` if given: its sha */
  createCommit(repo: string, message: string, parent?: string): Promise<string>;
  /** creates `ref` at `sha`: false if it already exists (which is what makes it a lock) */
  createRef(repo: string, ref: string, sha: string): Promise<boolean>;
  getRef(repo: string, ref: string): Promise<string | null>;
  getCommitMessage(repo: string, sha: string): Promise<string>;
  deleteRef(repo: string, ref: string): Promise<void>;
};

export type GitHubPort = {
  /** our own account, e.g. `my-app[bot]`: the review comment is the one it wrote */
  botLogin(): Promise<string>;
  /** the repo's most recently updated PRs: just the open ones, or open and closed */
  listPulls(
    repo: string,
    options: { limit: number; state: "open" | "all" },
  ): Promise<PullSummary[]>;
  listComments(repo: string, issue: number): Promise<IssueComment[]>;
  /** One comment. Passing the `etag` from the last read makes an unchanged one cheap: it doesn't count against the rate limit. */
  getComment(
    repo: string,
    id: number,
    etag?: string,
  ): Promise<
    | { kind: "ok"; body: string; etag: string }
    | { kind: "not-modified" }
    | { kind: "gone" }
  >;
  createComment(
    repo: string,
    issue: number,
    body: string,
  ): Promise<{ id: number }>;
  updateComment(repo: string, id: number, body: string): Promise<void>;
  /** Stores a screenshot; returns a URL that renders in the PR for people with repo access. */
  uploadAsset(
    repo: string,
    asset: {
      branch: string;
      path: string;
      jpegBase64: string;
      message: string;
    },
  ): Promise<string>;
  refs: GitRefs;
};

export type GitHubAppCredentials = {
  appId: number | string;
  /** the app's private key, PEM */
  privateKey: string;
};

/** The empty tree exists in every repo, so a commit can use it without creating anything. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const split = (repo: string) => repo.split("/") as [string, string];
const statusOf = (error: unknown) => (error as { status?: number }).status;

/** GitHub through an App: it finds the app's installation for each repo itself. */
export function createOctokitGitHub(
  credentials: GitHubAppCredentials,
  { sharedCache }: { sharedCache?: SharedCache } = {},
): GitHubPort {
  const app = new App({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
  });
  const installations = new Map<string, Promise<number>>();

  /** What never changes for long (the app's installation on a repo, its own login) is worth one lookup for all instances. */
  const remembered = async (key: string, look: () => Promise<string>) => {
    const cached = await sharedCache?.get(key).catch(() => null);
    if (cached) return cached;
    const value = await look();
    await sharedCache?.set(key, value, 6 * 60 * 60).catch(() => undefined);
    return value;
  };

  const octokitFor = async (repo: string) => {
    let installation = installations.get(repo);
    if (!installation) {
      const [owner, name] = split(repo);
      installation = remembered(`reviewapp-annotate:installation:${repo}`, () =>
        app.octokit.rest.apps
          .getRepoInstallation({ owner, repo: name })
          .then((res) => String(res.data.id)),
      ).then(Number);
      installations.set(repo, installation);
      installation.catch(() => installations.delete(repo));
    }
    return app.getInstallationOctokit(await installation);
  };

  let bot: Promise<string> | undefined;

  async function ensureBranch(repo: string, branch: string) {
    const octokit = await octokitFor(repo);
    const [owner, name] = split(repo);
    try {
      await octokit.rest.git.getRef({
        owner,
        repo: name,
        ref: `heads/${branch}`,
      });
      return;
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
    }

    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo: name,
      tree: [
        {
          path: "README.md",
          mode: "100644",
          type: "blob",
          content:
            "Screenshots attached to PR review comments. Safe to delete.\n",
        },
      ],
    });
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo: name,
      message: "Start review comment assets",
      tree: tree.sha,
      parents: [],
    });
    try {
      await octokit.rest.git.createRef({
        owner,
        repo: name,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
    } catch (error) {
      // lost a race with another first screenshot: the branch exists now
      if (statusOf(error) !== 422) throw error;
    }
  }

  const refs: GitRefs = {
    async createCommit(repo, message, parent) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      const { data } = await octokit.rest.git.createCommit({
        owner,
        repo: name,
        message,
        tree: EMPTY_TREE,
        parents: parent ? [parent] : [],
      });
      return data.sha;
    },
    async createRef(repo, ref, sha) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      try {
        await octokit.rest.git.createRef({ owner, repo: name, ref, sha });
        return true;
      } catch (error) {
        if (statusOf(error) === 422) return false;
        throw error;
      }
    },
    async getRef(repo, ref) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      try {
        const { data } = await octokit.rest.git.getRef({
          owner,
          repo: name,
          ref: ref.replace(/^refs\//, ""),
        });
        return data.object.sha;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },
    async getCommitMessage(repo, sha) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      const { data } = await octokit.rest.git.getCommit({
        owner,
        repo: name,
        commit_sha: sha,
      });
      return data.message;
    },
    async deleteRef(repo, ref) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      try {
        await octokit.rest.git.deleteRef({
          owner,
          repo: name,
          ref: ref.replace(/^refs\//, ""),
        });
      } catch (error) {
        // already gone
        if (statusOf(error) !== 404 && statusOf(error) !== 422) throw error;
      }
    },
  };

  return {
    botLogin: () =>
      (bot ??= remembered(
        `reviewapp-annotate:bot-login:${credentials.appId}`,
        () =>
          app.octokit
            .request("GET /app")
            .then((res) => `${(res.data as { slug: string }).slug}[bot]`),
      )),

    async listPulls(repo, { limit, state }) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      const pulls: PullSummary[] = [];
      for (let page = 1; pulls.length < limit; page++) {
        const { data } = await octokit.rest.pulls.list({
          owner,
          repo: name,
          state,
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page,
        });
        for (const pull of data) {
          pulls.push({
            number: pull.number,
            state: pull.state === "open" ? "open" : "closed",
            headRef: pull.head.ref,
            updatedAt: pull.updated_at,
          });
        }
        if (data.length < 100) break;
      }
      return pulls.slice(0, limit);
    },

    async listComments(repo, issue) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      const comments = await octokit.paginate(
        octokit.rest.issues.listComments,
        {
          owner,
          repo: name,
          issue_number: issue,
          per_page: 100,
        },
      );
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? "",
        authorLogin: comment.user?.login ?? "",
      }));
    },

    async getComment(repo, id, etag) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      try {
        const res = await octokit.request(
          "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
          {
            owner,
            repo: name,
            comment_id: id,
            headers: etag ? { "if-none-match": etag } : {},
          },
        );
        return {
          kind: "ok",
          body: res.data.body ?? "",
          etag: res.headers.etag ?? "",
        };
      } catch (error) {
        if (statusOf(error) === 304) return { kind: "not-modified" };
        if (statusOf(error) === 404) return { kind: "gone" };
        throw error;
      }
    },

    async createComment(repo, issue, body) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo: name,
        issue_number: issue,
        body,
      });
      return { id: data.id };
    },

    async updateComment(repo, id, body) {
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      await octokit.rest.issues.updateComment({
        owner,
        repo: name,
        comment_id: id,
        body,
      });
    },

    async uploadAsset(repo, { branch, path, jpegBase64, message }) {
      await ensureBranch(repo, branch);
      const octokit = await octokitFor(repo);
      const [owner, name] = split(repo);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: name,
        path,
        branch,
        message,
        content: jpegBase64,
      });
      return `https://github.com/${repo}/blob/${branch}/${path}?raw=true`;
    },

    refs,
  };
}
