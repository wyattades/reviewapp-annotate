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

/** An image to store (see `ReviewAnnotateConfig.uploadImage`). */
export type UploadedImage = {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg";
  /** a unique file name, `1792442899085-1a2b3c4d.jpg` */
  name: string;
  /** the PR it's for: `owner/name` and its number, e.g. to keep them in a folder */
  repo: string;
  prNumber: number;
};

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

  /** The branch screenshots are committed to, unless `uploadImage` stores them. Default `reviewapp-annotate-assets`. */
  assetsBranch?: string;

  /**
   * Where screenshots and pasted images go instead of that branch: your own
   * storage (Vercel Blob, S3, R2...). Return the image's public https URL:
   * it's linked from the PR comment, and GitHub's image proxy (which can't
   * sign in) has to be able to fetch it. Use an unguessable name, like the
   * `name` given.
   */
  uploadImage?: (image: UploadedImage) => Promise<string>;

  /** Called with anything that goes wrong, to log or report. */
  onError?: (error: unknown, context: ErrorContext) => void;
};
