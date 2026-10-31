/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchImage, MAX_IMAGE_BYTES, publicUrl } from "./image-proxy";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** A fetch that answers from `routes` (by URL), and records what it was asked for. */
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    return routes[url]?.() ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetcher, asked };
}

const image =
  (type = "image/png", body: BodyInit = PNG) =>
  () =>
    new Response(body, { headers: { "content-type": type } });
const redirect = (to: string) => () =>
  new Response(null, { status: 302, headers: { location: to } });

describe("publicUrl", () => {
  it("takes public http(s) URLs", () => {
    for (const url of [
      "https://cdn.example.com/a.png",
      "http://images.example.org/b.jpg?w=200",
      "https://8.8.8.8/c.png",
      "https://[2606:4700::1111]/d.png",
    ]) {
      assert.ok(publicUrl(url), url);
    }
  });

  it("refuses other schemes, credentials and private hosts", () => {
    for (const url of [
      null,
      "not a url",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "ftp://example.com/a.png",
      "https://user:pass@example.com/a.png",
      "http://localhost/a.png",
      "http://app.localhost/a.png",
      "http://intranet/a.png",
      "http://printer.local/a.png",
      "http://db.internal/a.png",
      "http://127.0.0.1/a.png",
      "http://2130706433/a.png", // 127.0.0.1, written as one number
      "http://0x7f.1/a.png",
      "http://10.1.2.3/a.png",
      "http://172.20.0.1/a.png",
      "http://192.168.1.1/a.png",
      "http://169.254.169.254/latest/meta-data", // cloud metadata
      "http://100.64.0.1/a.png",
      "http://0.0.0.0/a.png",
      "http://[::1]/a.png",
      "http://[fd00::1]/a.png",
      "http://[fe80::1]/a.png",
      "http://[::ffff:127.0.0.1]/a.png",
    ]) {
      assert.equal(publicUrl(url), null, String(url));
    }
  });
});

describe("fetchImage", () => {
  it("returns an image", async () => {
    const { fetcher } = fakeFetch({ "https://cdn.test/a.png": image() });
    const result = await fetchImage(new URL("https://cdn.test/a.png"), fetcher);
    assert.equal(result?.contentType, "image/png");
    assert.deepEqual(
      new Uint8Array(await new Response(result!.body).arrayBuffer()),
      PNG,
    );
  });

  it("follows public redirects, and stops at private ones", async () => {
    const { fetcher, asked } = fakeFetch({
      "https://cdn.test/a.png": redirect("/b.png"),
      "https://cdn.test/b.png": image("image/webp"),
      "https://cdn.test/evil.png": redirect("http://169.254.169.254/x"),
    });
    const ok = await fetchImage(new URL("https://cdn.test/a.png"), fetcher);
    assert.equal(ok?.contentType, "image/webp");
    assert.equal(
      await fetchImage(new URL("https://cdn.test/evil.png"), fetcher),
      null,
    );
    assert.ok(!asked.some((url) => url.includes("169.254")));
  });

  it("gives up after 3 redirects", async () => {
    const { fetcher } = fakeFetch({
      "https://cdn.test/1": redirect("/2"),
      "https://cdn.test/2": redirect("/3"),
      "https://cdn.test/3": redirect("/4"),
      "https://cdn.test/4": redirect("/5"),
      "https://cdn.test/5": image(),
    });
    assert.equal(
      await fetchImage(new URL("https://cdn.test/1"), fetcher),
      null,
    );
  });

  it("only passes on raster images", async () => {
    for (const type of ["text/html", "image/svg+xml", "application/json", ""]) {
      const { fetcher } = fakeFetch({ "https://cdn.test/x": image(type) });
      assert.equal(
        await fetchImage(new URL("https://cdn.test/x"), fetcher),
        null,
        type,
      );
    }
  });

  it("refuses what says it's too big", async () => {
    const { fetcher } = fakeFetch({
      "https://cdn.test/big": () =>
        new Response(PNG, {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_IMAGE_BYTES + 1),
          },
        }),
    });
    assert.equal(
      await fetchImage(new URL("https://cdn.test/big"), fetcher),
      null,
    );
  });

  it("cuts off a stream once it passes the cap", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const { fetcher } = fakeFetch({
      // no content-length: only reading it tells
      "https://cdn.test/big": () =>
        new Response(new Blob([big]).stream(), {
          headers: { "content-type": "image/png" },
        }),
    });
    const result = await fetchImage(new URL("https://cdn.test/big"), fetcher);
    await assert.rejects(new Response(result!.body).arrayBuffer());
  });

  it("passes on a failed fetch", async () => {
    const { fetcher } = fakeFetch({});
    assert.equal(
      await fetchImage(new URL("https://cdn.test/gone.png"), fetcher),
      null,
    );
  });
});
