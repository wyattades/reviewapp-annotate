import { z } from "zod";
import type { ReviewState } from "../shared";
import type { ErrorContext, ReviewAnnotateConfig } from "./config";
import { connectPage, htmlResponse } from "./connect";
import { corsHeaders } from "./cors";
import { createOctokitGitHub } from "./github";
import { githubRefLock } from "./lock";
import { normalizeOrigin } from "./origin";
import { defaultProviders } from "./providers";
import {
  createReviewAppPrFinder,
  type ReviewTarget,
} from "./review-app-pr-finder";
import { createThreadStore } from "./threads";
import { createTokens, type TokenClaims } from "./tokens";
import { widgetSource } from "./widget-source.generated";

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

const textSchema = z.object({ text: z.string().trim().min(1).max(4000) });

const patchSchema = z.union([z.object({ resolved: z.boolean() }), textSchema]);

const commentSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  pageUrl: z.string().url().max(2000),
  selector: z.string().min(1).max(500),
  rect: rectSchema,
  pageRect: rectSchema,
  elementText: z.string().max(500).nullish(),
  viewport: z
    .object({ width: z.number().int(), height: z.number().int() })
    .nullish(),
  userAgent: z.string().max(500).nullish(),
  /** `data:image/jpeg;base64,` URLs: a host's request body limit is the ceiling (Vercel's is 4.5MB) */
  screenshots: z
    .array(z.string().max(1_200_000).regex(JPEG_DATA_URL))
    .max(3)
    .default([]),
  console: z
    .array(
      z.object({
        level: z.string().max(10),
        time: z.number(),
        message: z.string().max(2000),
      }),
    )
    .max(100)
    .default([]),
});

type Authorized =
  | { ok: true; claims: TokenClaims; target: ReviewTarget }
  | { ok: false; status: number; error: string };

/**
 * The reviewapp-annotate server: a function from a web-standard `Request` to a
 * `Response`, so it runs on anything that speaks them. (`./nextjs` wraps it as
 * Next.js route handlers.)
 *
 * - `GET {basePath}`: who's signed in, the PR, and every thread
 * - `POST {basePath}`: add a thread, or with `?reply_to=<id>` a reply
 * - `PATCH {basePath}?id=` (and `&reply=`): `{ resolved }`, or `{ text }` to edit your own
 * - `DELETE {basePath}?id=` (and `&reply=`): remove your own
 * - `GET {basePath}/connect?origin=`: the sign-in popup
 * - `GET {basePath}/widget.js`: the browser widget, for review apps to load
 */
export function createReviewAnnotate(config: ReviewAnnotateConfig) {
  const github =
    "appId" in config.github
      ? createOctokitGitHub(config.github)
      : config.github;
  const providers = config.providers ?? defaultProviders();
  const tokens = createTokens({
    secret: config.tokenSecret,
    ttlSeconds: config.tokenTtlSeconds ?? 12 * 60 * 60,
  });
  const finder = createReviewAppPrFinder({
    github,
    repos: config.repos,
    providers,
    sharedCache: config.sharedCache,
    onError: config.onError,
  });
  const store = createThreadStore({
    github,
    lock: config.lock ?? githubRefLock(github.refs),
    assetsBranch: config.assetsBranch ?? "reviewapp-annotate-assets",
    sharedCache: config.sharedCache,
    onError: config.onError,
  });
  const base = (config.basePath ?? "/api/reviewapp-annotate").replace(
    /\/+$/,
    "",
  );

  const json = (request: Request, body: unknown, status = 200) =>
    Response.json(body, { status, headers: corsHeaders(request) });

  /**
   * Who's calling, and which PR their review app belongs to. The origin is the
   * one the token was signed for (the sign-in popup only issues it to the
   * opener's origin), and a request that says it's from another is refused.
   */
  async function authorize(request: Request): Promise<Authorized> {
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    const claims = token ? await tokens.verify(token) : null;
    if (!claims) return { ok: false, status: 401, error: "Sign in again" };

    const origin = normalizeOrigin(claims.origin);
    if (!origin) return { ok: false, status: 403, error: "Unsupported origin" };
    // a browser sends `Origin` on cross-origin and POST requests, but not on a
    // same-origin GET (an app calling its own server)
    const sent = request.headers.get("origin");
    if (sent && sent !== origin.origin) {
      return { ok: false, status: 403, error: "Token is for another app" };
    }

    const target = await finder.find(origin.origin);
    if (!target) {
      return {
        ok: false,
        status: 404,
        error: "No pull request found for this app",
      };
    }
    return { ok: true, claims, target };
  }

  /** Runs a change to a thread: 200 when made, 404 when there's no such thread of theirs. */
  async function change(
    request: Request,
    context: ErrorContext,
    run: () => Promise<boolean>,
  ) {
    try {
      return (await run())
        ? json(request, { ok: true })
        : json(request, { error: "Not found, or not yours to change" }, 404);
    } catch (error) {
      config.onError?.(error, context);
      return json(request, { error: "Couldn't save the change" }, 502);
    }
  }

  async function connect(request: Request) {
    const url = new URL(request.url);
    const origin = normalizeOrigin(url.searchParams.get("origin"));
    if (!origin) return htmlResponse("<p>Unsupported review app.</p>", 400);
    // The token goes to whoever opened the popup, and says who's signed in: so
    // only to a review app a provider has announced on a PR, not to any website.
    if (!(await finder.find(origin.origin))) {
      return htmlResponse(
        "<p>No pull request announces this review app.</p>",
        404,
      );
    }

    const user = await config.authenticate(request);
    if (user instanceof Response) return user;
    if (!user) {
      return Response.redirect(
        new URL(config.signInUrl(url.pathname + url.search), url),
        302,
      );
    }

    const token = await tokens.sign({
      origin: origin.origin,
      name: user.name,
      userId: user.id,
      ...(user.image && { image: user.image }),
    });
    return htmlResponse(connectPage(token, origin.origin));
  }

  async function get(
    request: Request,
    auth: Extract<Authorized, { ok: true }>,
  ) {
    try {
      const { items, firstCommentId } = await store.list(auth.target);
      const pullUrl = `https://github.com/${auth.target.repo}/pull/${auth.target.prNumber}`;
      const state: ReviewState = {
        user: auth.claims.name,
        userId: auth.claims.userId,
        image: auth.claims.image ?? null,
        repo: auth.target.repo,
        prNumber: auth.target.prNumber,
        // the PR comment the threads live in, or the PR before there is one
        commentUrl: firstCommentId
          ? `${pullUrl}#issuecomment-${firstCommentId}`
          : pullUrl,
        items,
      };
      return json(request, state);
    } catch (error) {
      config.onError?.(error, { what: "listThreads", target: auth.target });
      return json(request, { error: "Couldn't load comments" }, 502);
    }
  }

  async function post(
    request: Request,
    auth: Extract<Authorized, { ok: true }>,
  ) {
    const { claims, target } = auth;
    const replyTo = new URL(request.url).searchParams.get("reply_to");
    const body: unknown = await request.json().catch(() => null);

    if (replyTo) {
      const parsed = textSchema.safeParse(body);
      if (!parsed.success)
        return json(request, { error: "Invalid reply" }, 400);
      return change(request, { what: "reply", target }, () =>
        store.reply(target, replyTo, {
          author: claims.name,
          avatar: claims.image ?? null,
          authorId: claims.userId,
          text: parsed.data.text,
        }),
      );
    }

    const parsed = commentSchema.safeParse(body);
    if (!parsed.success)
      return json(request, { error: "Invalid comment" }, 400);
    const { screenshots, console: consoleEntries, ...rest } = parsed.data;
    try {
      const result = await store.post(target, {
        ...rest,
        author: claims.name,
        avatar: claims.image ?? null,
        authorId: claims.userId,
        consoleEntries,
        screenshotsJpegBase64: screenshots.map((url) =>
          url.replace(/^data:image\/jpeg;base64,/, ""),
        ),
      });
      return json(request, result);
    } catch (error) {
      config.onError?.(error, { what: "postComment", target });
      return json(request, { error: "Couldn't post the comment" }, 502);
    }
  }

  async function patch(
    request: Request,
    auth: Extract<Authorized, { ok: true }>,
  ) {
    const { claims, target } = auth;
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const replyId = params.get("reply");
    if (!id) return json(request, { error: "Missing id" }, 400);

    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return json(request, { error: "Invalid change" }, 400);
    const edit = parsed.data;

    return change(request, { what: "updateThread", target }, async () => {
      if ("resolved" in edit) {
        // a reply has no checkbox of its own
        return replyId ? false : store.resolve(target, id, edit.resolved);
      }
      return replyId
        ? store.editReply(target, id, replyId, claims.userId, edit.text)
        : store.edit(target, id, claims.userId, edit.text);
    });
  }

  async function remove(
    request: Request,
    auth: Extract<Authorized, { ok: true }>,
  ) {
    const { claims, target } = auth;
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const replyId = params.get("reply");
    if (!id) return json(request, { error: "Missing id" }, 400);

    return change(request, { what: "deleteThread", target }, () =>
      replyId
        ? store.removeReply(target, id, replyId, claims.userId)
        : store.remove(target, id, claims.userId),
    );
  }

  return {
    /** Answers a request to any of the routes; a path that isn't one gets a 404. */
    handle: async (request: Request): Promise<Response> => {
      const path = new URL(request.url).pathname.replace(/\/+$/, "");

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request),
        });
      }
      if (path === `${base}/connect` && request.method === "GET") {
        return connect(request);
      }
      if (path === `${base}/widget.js` && request.method === "GET") {
        return new Response(widgetSource, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=3600",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (path !== base) return json(request, { error: "Not found" }, 404);

      const handlers = { GET: get, POST: post, PATCH: patch, DELETE: remove };
      const handler = handlers[request.method as keyof typeof handlers];
      if (!handler) return json(request, { error: "Method not allowed" }, 405);

      const auth = await authorize(request);
      if (!auth.ok) return json(request, { error: auth.error }, auth.status);
      return handler(request, auth);
    },
  };
}

export type ReviewAnnotate = ReturnType<typeof createReviewAnnotate>;
