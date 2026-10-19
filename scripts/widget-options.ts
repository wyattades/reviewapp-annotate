import type { BuildOptions } from "esbuild";

/** How the widget is bundled: shared by the build and the playground. */
export const widgetOptions = {
  entryPoints: ["src/widget/index.tsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  jsxImportSource: "preact",
  target: "es2020",
  platform: "browser",
  // review apps can be served in any page encoding, and a script is decoded
  // with the page's: keep the bundle ASCII
  charset: "ascii",
  logLevel: "warning",
} satisfies BuildOptions;
