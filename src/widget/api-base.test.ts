/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiBase } from "./api-base";

describe("resolveApiBase", () => {
  it("finds the API next to a script the server serves itself", () => {
    assert.equal(
      resolveApiBase("https://app.example.com/api/reviewapp-annotate/widget.js", undefined),
      "https://app.example.com/api/reviewapp-annotate",
    );
    assert.equal(
      resolveApiBase("https://app.example.com/custom/mount/widget.js?v=3", undefined),
      "https://app.example.com/custom/mount",
    );
  });

  it("takes data-api as a path on the script's origin, or a full URL", () => {
    const src = "https://cdn.example.com/assets/widget.js";
    assert.equal(resolveApiBase(src, "/annotate"), "https://cdn.example.com/annotate");
    assert.equal(
      resolveApiBase(src, "https://api.example.com/v1/annotate/"),
      "https://api.example.com/v1/annotate",
    );
  });

  it("uses the usual place on the script's origin for a copy hosted elsewhere", () => {
    assert.equal(
      resolveApiBase("https://cdn.example.com/review-widget.js", undefined),
      "https://cdn.example.com/api/reviewapp-annotate",
    );
  });

  it("takes data-api from a CDN, and has no guess without it", () => {
    const cdn = "https://cdn.jsdelivr.net/npm/reviewapp-annotate@0.1.0/dist/widget.js";
    assert.equal(
      resolveApiBase(cdn, "https://app.example.com/api/reviewapp-annotate"),
      "https://app.example.com/api/reviewapp-annotate",
    );
    assert.equal(resolveApiBase(cdn, undefined), null);
    assert.equal(
      resolveApiBase("https://unpkg.com/reviewapp-annotate@0.1.0/dist/widget.js", undefined),
      null,
    );
  });
});
