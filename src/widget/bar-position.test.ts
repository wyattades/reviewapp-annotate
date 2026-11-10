/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchoredPopoverStyle } from "./bar-position";

const viewport = { width: 1000, height: 800 };
const anchor = (left: number, top: number) => ({
  left,
  top,
  right: left + 40,
  bottom: top + 40,
});

describe("anchoredPopoverStyle", () => {
  it("opens above a button in the lower half, lined up with its left edge on the left", () => {
    assert.deepEqual(anchoredPopoverStyle(anchor(16, 744), 340, viewport), {
      left: 16,
      right: "auto",
      bottom: 64,
      top: "auto",
    });
  });

  it("opens below a button in the upper half, lined up with its right edge on the right", () => {
    assert.deepEqual(anchoredPopoverStyle(anchor(900, 16), 340, viewport), {
      left: 600,
      right: "auto",
      top: 64,
      bottom: "auto",
    });
  });

  it("stays on screen when the popover is wider than the room beside the button", () => {
    const style = anchoredPopoverStyle(anchor(980, 16), 340, viewport);
    assert.equal(style.left, 652);
    assert.equal(anchoredPopoverStyle(anchor(0, 16), 340, viewport).left, 8);
  });
});
