// A fake reviewapp-annotate server, in the page: every route the widget calls,
// kept in localStorage so a reload keeps your threads. "Reset" in the page
// starts over. Load it before widget.js.
(() => {
  const API = "https://fake-api.test/api/reviewapp-annotate";
  const KEY = "playground-threads";
  const me = { author: "You", authorId: "me", avatar: null };
  const ago = (minutes) =>
    new Date(Date.now() - minutes * 60_000).toISOString();
  const id = () => Math.random().toString(36).slice(2, 10);

  const seed = () => [
    {
      id: "t1",
      author: "Grace",
      authorId: "grace",
      avatar: null,
      text: "Can this heading be shorter? It wraps on mobile.",
      pageUrl: location.href,
      selector: "main > h1",
      rect: { x: 0, y: 0, w: 0.6, h: 1 },
      pageRect: { x: 0, y: 0, w: 0, h: 0 },
      createdAt: ago(90),
      resolved: false,
      imageUrls: [],
      replies: [
        {
          id: "r1",
          author: "You",
          authorId: "me",
          avatar: null,
          text: "Sure, on it",
          createdAt: ago(60),
        },
      ],
    },
    {
      id: "t2",
      author: "Kai",
      authorId: "kai",
      avatar: null,
      text: "The trial button colour is off",
      pageUrl: location.href,
      selector: "#plan-team > button",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      pageRect: { x: 0, y: 0, w: 0, h: 0 },
      createdAt: ago(180),
      resolved: false,
      imageUrls: [],
      replies: [],
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
    // the PR comment preview (pr-comment.ts) redraws
    window.dispatchEvent(new Event("playground-change"));
  };
  window.resetPlayground = () => {
    localStorage.removeItem(KEY);
    location.reload();
  };
  /** For the PR comment preview: the threads, and ticking one off as GitHub's checkbox would. */
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
    /** The comment as edited on GitHub (parsed by the preview): what's ticked, and every reply. */
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

  // signed in already
  localStorage.setItem("reviewapp-annotate-token", "playground");

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
        user: me.author,
        userId: me.authorId,
        image: null,
        repo: "acme/web",
        prNumber: 128,
        commentUrl: "https://github.com/acme/web/pull/128",
        items,
      });
    }
    if (method === "POST" && p.has("reply_to")) {
      const parent = items.find((i) => i.id === p.get("reply_to"));
      if (!parent) return notFound();
      parent.replies.push({ id: id(), ...me, text: body.text, createdAt: now });
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
        ...me,
        text,
        pageUrl,
        selector,
        rect,
        pageRect,
        createdAt: now,
        resolved: false,
        replies: [],
        imageUrls: screenshots,
        // only in the PR comment, which the preview shows
        elementText,
        viewport,
        consoleEntries,
      };
      items.push(created);
      save();
      return ok({
        url: "https://github.com/acme/web/pull/128",
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
