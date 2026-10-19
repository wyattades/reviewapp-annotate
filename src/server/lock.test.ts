/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubRefLock } from "./lock";
import { createFakeGitHub } from "./testing/fake-github";

const KEY = "o/r#7";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("githubRefLock", () => {
  it("runs one holder at a time", async () => {
    const { port } = createFakeGitHub({ latencyMs: 2 });
    const lock = githubRefLock(port.refs, { pollMs: 5 });

    let inside = 0;
    let overlapped = false;
    let shared = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        lock(KEY, async () => {
          if (++inside > 1) overlapped = true;
          const read = shared;
          await sleep(15); // a read-change-write that would lose updates unlocked
          shared = read + 1;
          inside--;
        }),
      ),
    );

    assert.equal(overlapped, false);
    assert.equal(shared, 6);
  });

  it("lets go when the work throws", async () => {
    const { port, refs } = createFakeGitHub();
    const lock = githubRefLock(port.refs);
    await assert.rejects(
      lock(KEY, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(refs.size, 0);
    assert.equal(await lock(KEY, async () => "again"), "again");
  });

  it("locks each PR separately", async () => {
    const { port } = createFakeGitHub();
    const lock = githubRefLock(port.refs, { waitMs: 50, pollMs: 5 });
    await lock("o/r#1", () => lock("o/r#2", async () => undefined));
  });

  it("gives up waiting for a holder that's still going", async () => {
    const { port } = createFakeGitHub();
    const lock = githubRefLock(port.refs, { waitMs: 40, pollMs: 5 });
    await lock(KEY, async () => {
      await assert.rejects(
        lock(KEY, async () => undefined),
        /Timed out/,
      );
    });
  });

  it("pushes aside a holder that died", async () => {
    const fake = createFakeGitHub();
    // a lock taken a minute ago by something that never let go
    const sha = await fake.port.refs.createCommit(
      "o/r",
      `lock ${Date.now() - 120_000} dead`,
    );
    await fake.port.refs.createRef("o/r", "refs/reviewapp-annotate/lock-7", sha);

    const lock = githubRefLock(fake.port.refs, { ttlMs: 60_000, pollMs: 5 });
    assert.equal(await lock(KEY, async () => "ran"), "ran");
    assert.equal(fake.refs.size, 0);
  });
});
