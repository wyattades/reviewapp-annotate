// A fake reviewapp-annotate server, in the page: every route the widget calls,
// kept in localStorage so a reload keeps your threads. "Reset" in the page
// starts over. Load it before widget.js.
(() => {
  const API = "https://fake-api.test/api/reviewapp-annotate";
  const KEY = "playground-threads";
  const me = { author: "You", authorId: "me", avatar: null };
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const id = () => Math.random().toString(36).slice(2, 10);

  const seed = () => [
    {
      id: "t1", author: "Grace", authorId: "grace", avatar: null,
      text: "Can this heading be shorter? It wraps on mobile.",
      pageUrl: location.href, selector: "main > h1",
      rect: { x: 0, y: 0, w: 0.6, h: 1 }, pageRect: { x: 0, y: 0, w: 0, h: 0 },
      createdAt: ago(90), resolved: false,
      replies: [{ id: "r1", author: "You", authorId: "me", avatar: null, text: "Sure, on it", createdAt: ago(60) }],
    },
    {
      id: "t2", author: "Kai", authorId: "kai", avatar: null,
      text: "The trial button colour is off",
      pageUrl: location.href, selector: "#plan-team > button",
      rect: { x: 0, y: 0, w: 1, h: 1 }, pageRect: { x: 0, y: 0, w: 0, h: 0 },
      createdAt: ago(180), resolved: false, replies: [],
    },
  ];

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? seed();
    } catch {
      return seed();
    }
  };
  let items = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(items));
  window.resetPlayground = () => {
    localStorage.removeItem(KEY);
    location.reload();
  };

  // signed in already
  localStorage.setItem("reviewapp-annotate-token", "playground");

  const ok = (body = { ok: true }) => Response.json(body);
  const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), location.href);
    if (!url.href.startsWith(API)) return realFetch(input, init);
    // a little latency, like the real thing
    await new Promise((resolve) => setTimeout(resolve, 250));

    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    const p = url.searchParams;
    const item = items.find((i) => i.id === p.get("id"));
    const reply = item?.replies.find((r) => r.id === p.get("reply"));
    const now = new Date().toISOString();

    if (method === "GET") {
      return ok({
        user: me.author, userId: me.authorId, image: null,
        repo: "acme/web", prNumber: 128,
        commentUrl: "https://github.com/acme/web/pull/128",
        items,
      });
    }
    if (method === "POST" && p.has("reply_to")) {
      const parent = items.find((i) => i.id === p.get("reply_to"));
      if (!parent) return notFound();
      parent.replies.push({ id: id(), ...me, text: body.text, createdAt: now });
    } else if (method === "POST") {
      const { text, pageUrl, selector, rect, pageRect } = body;
      const created = { id: id(), ...me, text, pageUrl, selector, rect, pageRect, createdAt: now, resolved: false, replies: [] };
      items.push(created);
      save();
      return ok({ url: "https://github.com/acme/web/pull/128", itemId: created.id });
    } else if (method === "PATCH") {
      if (!item) return notFound();
      const target = p.has("reply") ? reply : item;
      if (!target) return notFound();
      if ("resolved" in body) item.resolved = body.resolved;
      else if ("selector" in body) Object.assign(item, { selector: body.selector, rect: body.rect, pageRect: body.pageRect });
      else Object.assign(target, { text: body.text, editedAt: now });
    } else if (method === "DELETE") {
      if (!item) return notFound();
      if (p.has("reply")) item.replies = item.replies.filter((r) => r.id !== p.get("reply"));
      else items = items.filter((i) => i !== item);
    }
    save();
    return ok();
  };
})();
