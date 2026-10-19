// The playground: playground/index.html with the widget, rebuilt on every
// save, against a fake API in the page (playground/fake-api.js), and beside it
// the PR comment that would be written (playground/pr-comment.ts). No GitHub,
// no sign-in: for working on the widget and the comment format.
//
//   pnpm dev   →   http://localhost:4321
import { context } from "esbuild";
import { widgetOptions } from "./widget-options.ts";

const port = Number(process.env.PORT ?? 4321);

const ctx = await context({
  ...widgetOptions,
  entryPoints: {
    widget: "src/widget/index.tsx",
    // the PR comment preview, built with the server's own comment formatter
    "pr-comment": "playground/pr-comment.ts",
  },
  outdir: "playground",
  sourcemap: true,
});
await ctx.watch();
// the page reloads after each rebuild (it listens on /esbuild)
await ctx.serve({ servedir: "playground", port });
console.log(`playground: http://localhost:${port}`);
