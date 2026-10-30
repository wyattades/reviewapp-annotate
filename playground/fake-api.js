// A fake reviewapp-annotate server, in the page: every route the widget calls,
// kept in localStorage so a reload keeps your threads, and so the PR page
// (pr.html) sees the same ones. "Reset threads" in the toolbar starts over.
// Load it before widget.js.
(() => {
  const API = "https://fake-api.test/api/reviewapp-annotate";
  const KEY = "playground-threads";
  /** who's signed in: "You", unless `playgroundUser` (in localStorage) says otherwise, as the screenshots do */
  const USER_KEY = "playground-user";
  const me = () => {
    try {
      const user = JSON.parse(localStorage.getItem(USER_KEY));
      if (user?.author) return { avatar: null, ...user };
    } catch {
      // not set, or garbled: the default
    }
    return { author: "You", authorId: "me", avatar: null };
  };
  /** the review app's page, which the threads are on (pr.html loads this too) */
  const appUrl = new URL("/", location.href).href;
  const ago = (minutes) =>
    new Date(Date.now() - minutes * 60_000).toISOString();
  const id = () => Math.random().toString(36).slice(2, 10);

  const seed = () => [
    {
      id: "t1",
      author: "Kai",
      authorId: "kai",
      avatar: null,
      text: "Logo is a little blurry on retina",
      pageUrl: appUrl,
      selector: "nav > div > a.brand",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      pageRect: { x: 232, y: 21, w: 92, h: 22 },
      viewport: { width: 1440, height: 900 },
      createdAt: ago(130),
      resolved: true,
      imageUrls: [],
      replies: [],
    },
    {
      id: "t2",
      author: "Grace",
      authorId: "grace",
      avatar: null,
      text: "Can “Most popular” use the brand green? It blends into the card border.",
      pageUrl: appUrl,
      selector: "#plan-team > span.tag",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      pageRect: { x: 832, y: 434, w: 100, h: 24 },
      viewport: { width: 1440, height: 900 },
      createdAt: ago(25),
      resolved: false,
      imageUrls: [],
      replies: [
        {
          id: "r1",
          author: "Ada",
          authorId: "ada",
          avatar: null,
          text: "On it, pushing now.",
          createdAt: ago(12),
        },
      ],
    },
  ];

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      // threads saved before images were kept
      return saved?.map((item) => ({ imageUrls: [], ...item })) ?? seed();
    } catch {
      return seed();
    }
  };
  let items = load();
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(items));
    // the PR page (pr.ts) redraws
    window.dispatchEvent(new Event("playground-change"));
  };
  // the other page changed them (a box ticked on the PR page, a comment in the app)
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    items = load();
    window.dispatchEvent(new Event("playground-change"));
    // the widget reloads when the page becomes visible: have it look now
    document.dispatchEvent(new Event("visibilitychange"));
  });
  window.resetPlayground = () => {
    localStorage.removeItem(KEY);
    location.reload();
  };
  /** For the PR page: the threads, and ticking one off as GitHub's checkbox would. */
  window.playground = {
    threads: () => items,
    setResolved: (threadId, resolved) => {
      const thread = items.find((i) => i.id === threadId);
      if (!thread) return;
      thread.resolved = resolved;
      save();
      // the widget reloads when the page becomes visible: have it look now, not at its next poll
      document.dispatchEvent(new Event("visibilitychange"));
    },
    /** The comment as edited on GitHub (parsed by the PR page): what's ticked, and every reply. */
    applyEdit: (parsed) => {
      for (const edited of parsed) {
        const thread = items.find((i) => i.id === edited.id);
        if (!thread) continue;
        thread.resolved = edited.resolved;
        thread.replies = edited.replies;
      }
      save();
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };

  // signed in, unless "Sign out" in the page signed you out
  const TOKEN_KEY = "reviewapp-annotate-token";
  const SIGNED_OUT_KEY = "playground-signed-out";
  const signedIn = () => !localStorage.getItem(SIGNED_OUT_KEY);
  if (signedIn()) localStorage.setItem(TOKEN_KEY, "playground");
  else localStorage.removeItem(TOKEN_KEY);
  window.playgroundSignedIn = signedIn;
  window.togglePlaygroundSignIn = () => {
    if (signedIn()) localStorage.setItem(SIGNED_OUT_KEY, "1");
    else localStorage.removeItem(SIGNED_OUT_KEY);
    location.reload();
  };
  // the widget's "Sign in" opens the server's sign-in popup: here, just sign in
  const realOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (!String(url).startsWith(`${API}/connect`))
      return realOpen(url, ...rest);
    localStorage.removeItem(SIGNED_OUT_KEY);
    location.reload();
    return null;
  };

  const ok = (body = { ok: true }) => Response.json(body);
  const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.href);
    if (!url.href.startsWith(API)) return realFetch(input, init);
    // a little latency, like the real thing; from the console,
    // `playgroundLatencyMs = 3000` slows it down and `playgroundFail = true`
    // makes every save fail, to see the pill's spinner and errors
    await new Promise((resolve) =>
      setTimeout(resolve, window.playgroundLatencyMs ?? 250),
    );

    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    const p = url.searchParams;
    const item = items.find((i) => i.id === p.get("id"));
    const reply = item?.replies.find((r) => r.id === p.get("reply"));
    const now = new Date().toISOString();

    // a thread's image: the real server fetches it from the repo
    if (method === "GET" && url.pathname.endsWith("/asset")) {
      const image = item?.imageUrls?.[Number(p.get("n"))];
      return image ? realFetch(image) : notFound();
    }
    if (method !== "GET" && window.playgroundFail) {
      return Response.json({ error: "The server is down" }, { status: 502 });
    }
    if (method === "GET") {
      return ok({
        user: me().author,
        userId: me().authorId,
        image: null,
        repo: "lumen/web",
        prNumber: 128,
        // the PR page here stands in for GitHub
        commentUrl: new URL("/pr.html#review-comment", location.href).href,
        items,
      });
    }
    if (method === "POST" && p.has("reply_to")) {
      const parent = items.find((i) => i.id === p.get("reply_to"));
      if (!parent) return notFound();
      parent.replies.push({
        id: id(),
        ...me(),
        text: body.text,
        createdAt: now,
      });
    } else if (method === "POST") {
      const {
        text,
        pageUrl,
        selector,
        rect,
        pageRect,
        screenshots = [],
        elementText,
        viewport,
        console: consoleEntries = [],
      } = body;
      // the real server commits these to the repo; here they're kept as they came (data URLs)
      const created = {
        id: id(),
        ...me(),
        text,
        pageUrl,
        selector,
        rect,
        pageRect,
        createdAt: now,
        resolved: false,
        replies: [],
        imageUrls: screenshots,
        // only in the PR comment, which the PR page shows
        elementText,
        viewport,
        consoleEntries,
      };
      items.push(created);
      save();
      return ok({
        url: new URL("/pr.html#review-comment", location.href).href,
        itemId: created.id,
      });
    } else if (method === "PATCH") {
      if (!item) return notFound();
      const target = p.has("reply") ? reply : item;
      if (!target) return notFound();
      if ("resolved" in body) item.resolved = body.resolved;
      else if ("selector" in body)
        Object.assign(item, {
          selector: body.selector,
          rect: body.rect,
          pageRect: body.pageRect,
          elementText: body.elementText,
        });
      else Object.assign(target, { text: body.text, editedAt: now });
    } else if (method === "DELETE") {
      if (!item) return notFound();
      if (p.has("reply"))
        item.replies = item.replies.filter((r) => r.id !== p.get("reply"));
      else items = items.filter((i) => i !== item);
    }
    save();
    return ok();
  };
})();
