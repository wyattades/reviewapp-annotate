/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInside, overlap } from "./geometry";

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("overlap", () => {
  it("is the area two rectangles share", () => {
    assert.equal(overlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), 25);
    assert.equal(overlap(rect(0, 0, 10, 10), rect(2, 2, 4, 4)), 16);
  });

  it("is nothing for rectangles apart, or only touching", () => {
    assert.equal(overlap(rect(0, 0, 10, 10), rect(20, 0, 5, 5)), 0);
    assert.equal(overlap(rect(0, 0, 10, 10), rect(10, 0, 5, 5)), 0);
  });

  it("says how much of a drag an element holds, even when the drag strays past its edge", () => {
    // a fixed button, and a drag a few pixels bigger than it (the case that
    // used to climb all the way up to <body>)
    const button = rect(888, 110, 112, 45);
    const drag = rect(891, 108, 113, 41);
    assert.ok(overlap(button, drag) / (drag.w * drag.h) >= 0.8);
    assert.equal(isInside(drag, button), false);
  });
});

describe("isInside", () => {
  it("holds a rectangle within, give or take a couple of pixels", () => {
    assert.ok(isInside(rect(10, 10, 20, 20), rect(0, 0, 100, 100)));
    assert.ok(isInside(rect(-1, -1, 102, 102), rect(0, 0, 100, 100)));
    assert.equal(isInside(rect(-5, 0, 20, 20), rect(0, 0, 100, 100)), false);
  });
});
