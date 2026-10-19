/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTime } from "./time";

const now = new Date(2026, 9, 19, 15, 0).getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatTime", () => {
  it("says 'ago' within 12 hours", () => {
    assert.equal(formatTime(ago(10_000), now), "just now");
    assert.equal(formatTime(ago(MIN), now), "1 minute ago");
    assert.equal(formatTime(ago(5 * MIN), now), "5 minutes ago");
    assert.equal(formatTime(ago(HOUR), now), "1 hour ago");
    assert.equal(formatTime(ago(11 * HOUR + 59 * MIN), now), "11 hours ago");
  });

  it("gives a short date from 12 hours back, without the year when it's this one", () => {
    const out = formatTime(ago(12 * HOUR), now);
    assert.ok(!out.includes("ago"), out);
    assert.match(out, /Oct/);
    assert.ok(!out.includes("2026"), out);
  });

  it("includes the year for another year", () => {
    assert.match(
      formatTime(new Date(2025, 11, 31, 9, 5).toISOString(), now),
      /2025/,
    );
  });
});
