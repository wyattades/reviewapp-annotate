// The playground: a review app with the widget (playground/index.html) and the
// PR it comments on (playground/pr.html), against a fake API in the page
// (playground/fake-api.js). No GitHub, no sign-in: for working on the widget
// and the comment format.
//
//   pnpm dev   →   http://localhost:4321
import { servePlayground } from "./playground.ts";

const { url } = await servePlayground(Number(process.env.PORT ?? 4321));
console.log(`playground: ${url} (the PR: ${url}/pr.html)`);
