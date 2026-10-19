import type { GitHubAppCredentials, GitHubPort } from "./github";
import type { Lock } from "./lock";
import type { Provider } from "./providers";
import type { SharedCache } from "./shared-cache";

/** The signed-in person, as your app knows them. */
export type ReviewUser = {
  /** stable: it's what lets someone edit and delete their own comments */
  id: string;
  name: string;
  image?: string | null;
};

export type ErrorContext = { what: string; [key: string]: unknown };

/**
 * Everything the server needs, passed in: it reads no environment variables
 * and imports nothing from your app.
 */
export type ReviewAnnotateConfig = {
  /**
   * The GitHub App that reads the PRs and writes the review comment (it needs
   * to read and write issues/PRs and repository contents, and be installed on
   * `repos`): its id and private key. Or any `GitHubPort`, e.g. a test fake.
   */
  github: GitHubAppCredentials | GitHubPort;

  /** `owner/name` of the repos whose PRs have review apps */
  repos: string[];

  /** Signs the widget's sign-in tokens (16+ characters). Rotating it signs everyone out. */
  tokenSecret: string;

  /**
   * Who is making this request, from your own session: they're asked to sign
   * in through a popup on a review app. Return `null` when signed out, or a
   * `Response` to answer with instead (e.g. a 403 page for someone who has no business here).
   */
  authenticate: (request: Request) => Promise<ReviewUser | Response | null>;

  /** Where to send someone who's signed out; `returnTo` is the path to come back to once they have. */
  signInUrl: (returnTo: string) => string;

  /**
   * Runs one writer at a time per PR (see `Lock`). Defaults to a lock made from
   * a git ref in the PR's repo, so nothing else is needed; pass a Redis lock
   * or similar to save the API calls.
   */
  lock?: Lock;

  /**
   * Remembers what the server learns (which PR a review app belongs to) for all
   * your instances, not just the one that learned it: pass Redis or similar.
   * Serverless instances start cold often, and without this each looks the
   * PR up from scratch, which takes a few seconds. Optional; see `SharedCache`.
   */
  sharedCache?: SharedCache;

  /** Hosts to find review apps on besides the built-in Vercel, Cloudflare and Netlify: whose PR comments announce a preview, and how to read them. */
  additionalProviders?: Provider[];

  /** Where the routes are mounted. Default `/api/reviewapp-annotate`. */
  basePath?: string;

  /** How long a sign-in lasts. Default 12 hours. */
  tokenTtlSeconds?: number;

  /** The branch screenshots are committed to. Default `reviewapp-annotate-assets`. */
  assetsBranch?: string;

  /** Called with anything that goes wrong, to log or report. */
  onError?: (error: unknown, context: ErrorContext) => void;
};
