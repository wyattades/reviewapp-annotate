import type { ReviewAnnotateConfig } from "./config";
import { createReviewAnnotate } from "./handler";

/**
 * The reviewapp-annotate routes as Next.js route handlers. Mount them on an
 * optional catch-all at the config's `basePath`:
 *
 *     // app/api/reviewapp-annotate/[[...path]]/route.ts
 *     export const maxDuration = 60; // screenshots take a moment to commit
 *     export const { GET, POST, PATCH, DELETE, OPTIONS } =
 *       createReviewAnnotateRoutes({ ... });
 */
export function createReviewAnnotateRoutes(config: ReviewAnnotateConfig) {
  const { handle } = createReviewAnnotate(config);
  const route = (request: Request) => handle(request);
  return {
    GET: route,
    POST: route,
    PATCH: route,
    DELETE: route,
    OPTIONS: route,
  };
}

export type { ReviewAnnotateConfig, ReviewUser } from "./config";
