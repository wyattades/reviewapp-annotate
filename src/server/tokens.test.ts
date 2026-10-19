/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTokens } from "./tokens";

const claims = {
  origin: "https://a.netlify.com",
  name: "Ada Lovelace",
  userId: "u1",
  image: "https://img.test/a.png",
};
const secret = "a-secret-that-is-long-enough";

describe("tokens", () => {
  it("round-trips the claims", async () => {
    const tokens = createTokens({ secret, ttlSeconds: 60 });
    assert.deepEqual(await tokens.verify(await tokens.sign(claims)), claims);
  });

  it("leaves out an image that isn't there", async () => {
    const tokens = createTokens({ secret, ttlSeconds: 60 });
    const { image: _image, ...without } = claims;
    assert.deepEqual(await tokens.verify(await tokens.sign(without)), without);
  });

  it("expires", async () => {
    let time = Date.parse("2026-10-19T00:00:00Z");
    const tokens = createTokens({ secret, ttlSeconds: 60, now: () => time });
    const token = await tokens.sign(claims);
    time += 59_000;
    assert.ok(await tokens.verify(token));
    time += 2_000;
    assert.equal(await tokens.verify(token), null);
  });

  it("rejects a token that was altered, is from another secret, or isn't one", async () => {
    const tokens = createTokens({ secret, ttlSeconds: 60 });
    const token = await tokens.sign(claims);
    const [version, payload, signature] = token.split(".");
    const forged = btoa(
      JSON.stringify({
        claims: { ...claims, userId: "root" },
        iat: 0,
        exp: 9e9,
      }),
    ).replace(/=+$/, "");

    for (const bad of [
      `${version}.${forged}.${signature}`,
      `${version}.${payload}.AAAA`,
      `${token}.extra`,
      "nope",
      "",
    ]) {
      assert.equal(await tokens.verify(bad), null, bad);
    }
    const other = createTokens({
      secret: "another-secret-long-enough!",
      ttlSeconds: 60,
    });
    assert.equal(await other.verify(token), null);
  });

  it("refuses a short secret", () => {
    assert.throws(
      () => createTokens({ secret: "short", ttlSeconds: 60 }),
      /secret/,
    );
  });
});
