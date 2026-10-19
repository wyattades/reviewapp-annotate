// The playground: playground/index.html with the widget, rebuilt on every
// save, against a fake API in the page (playground/fake-api.js). No GitHub, no
// sign-in: for working on the widget itself.
//
//   pnpm dev   →   http://localhost:4321
import { context } from "esbuild";
import { widgetOptions } from "./widget-options.ts";

const port = Number(process.env.PORT ?? 4321);

const ctx = await context({
  ...widgetOptions,
  outfile: "playground/widget.js",
  sourcemap: true,
  // tells the page to reload after each rebuild
  banner: {
    js: `new EventSource("/esbuild").addEventListener("change", () => location.reload());`,
  },
});
await ctx.watch();
await ctx.serve({ servedir: "playground", port });
console.log(`playground: http://localhost:${port}`);
