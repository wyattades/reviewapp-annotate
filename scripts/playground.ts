import { context } from "esbuild";
import { widgetOptions } from "./widget-options.ts";

/**
 * Serves the playground (playground/): the review app (index.html) and its PR
 * (pr.html), with the widget and the PR page's script built into it and
 * rebuilt on every save. Used by `pnpm dev` and `pnpm screenshots`.
 */
export async function servePlayground(port: number) {
  const ctx = await context({
    ...widgetOptions,
    entryPoints: {
      widget: "src/widget/index.tsx",
      // the PR page, built with the server's own comment formatter
      pr: "playground/pr.ts",
    },
    outdir: "playground",
    sourcemap: true,
  });
  await ctx.watch();
  // the pages reload after each rebuild (they listen on /esbuild)
  const { port: actualPort } = await ctx.serve({
    servedir: "playground",
    port,
  });
  return { url: `http://localhost:${actualPort}`, stop: () => ctx.dispose() };
}
