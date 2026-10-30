// The playground's own controls, on both pages: switch between the review app
// and its PR, start the threads over, sign in or out. None of it is part of
// the pages it sits on, so `#screenshot` (what scripts/screenshots.ts loads)
// leaves it out, along with the reload on rebuild. (A hash, not `?screenshot`:
// the widget tells pages apart by their query, and a hash doesn't change that.)
(() => {
  if (location.hash === "#screenshot") return;

  // `pnpm dev` rebuilds on save: reload then
  new EventSource("/esbuild").addEventListener("change", () =>
    location.reload(),
  );

  const onPr = location.pathname.endsWith("/pr.html");
  const bar = document.createElement("div");
  bar.id = "playground-toolbar";
  bar.innerHTML = `
    <style>
      #playground-toolbar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 100;
        display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 10px;
        background: rgba(17, 17, 17, .86); color: #eee; box-shadow: 0 6px 20px rgba(0,0,0,.25);
        font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
      #playground-toolbar b { padding: 0 8px; color: #999; font-weight: 500; }
      #playground-toolbar a, #playground-toolbar button { padding: 6px 9px; border: 0; border-radius: 7px;
        background: none; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
      #playground-toolbar a:hover, #playground-toolbar button:hover { background: rgba(255,255,255,.12); }
      #playground-toolbar .on { background: rgba(255,255,255,.18); }
      #playground-toolbar .note { padding: 0 8px; color: #999; }
    </style>
    <b>playground</b>
    <a href="/" class="${onPr ? "" : "on"}">App</a>
    <a href="/pr.html" class="${onPr ? "on" : ""}">PR on GitHub</a>
    <button data-do="reset">Reset threads</button>
    <button data-do="sign-in">${window.playgroundSignedIn() ? "Sign out" : "Sign in"}</button>
    <span class="note" id="playground-note"></span>
  `;
  bar.querySelector('[data-do="reset"]').onclick = () =>
    window.resetPlayground();
  bar.querySelector('[data-do="sign-in"]').onclick = () =>
    window.togglePlaygroundSignIn();
  document.body.append(bar);
})();
