import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  pendingMainGenPartCountForTests,
  resetMainGenCoalesceForTests,
  scheduleCoalescedMainGen,
} from "./main-gen-coalesce";
import { resetMainGenGatesForTests } from "./main-gen-gate";

describe("main-gen-coalesce", () => {
  beforeEach(() => {
    resetMainGenCoalesceForTests();
    resetMainGenGatesForTests();
  });

  it("merges rapid texts into one flush after the quiet window", async () => {
    const flushes: string[] = [];
    const a = scheduleCoalescedMainGen({
      threadId: "t1",
      text: "Maybe it was fixed",
      debounceMs: 40,
      execute: async ({ composedText, partCount }) => {
        flushes.push(`${partCount}:${composedText}`);
      },
    });
    assert.equal(a.partCount, 1);

    const b = scheduleCoalescedMainGen({
      threadId: "t1",
      text: "Well this block",
      debounceMs: 40,
      execute: async ({ composedText, partCount }) => {
        flushes.push(`${partCount}:${composedText}`);
      },
    });
    assert.equal(b.partCount, 2);

    const c = scheduleCoalescedMainGen({
      threadId: "t1",
      text: "Is the concurrency issue",
      debounceMs: 40,
      execute: async ({ composedText, partCount }) => {
        flushes.push(`${partCount}:${composedText}`);
      },
    });
    assert.equal(c.partCount, 3);
    assert.equal(pendingMainGenPartCountForTests("t1"), 3);

    await Promise.all([a.promise, b.promise, c.promise]);

    assert.equal(flushes.length, 1);
    assert.equal(
      flushes[0],
      "3:Maybe it was fixed\n\nWell this block\n\nIs the concurrency issue",
    );
    assert.equal(pendingMainGenPartCountForTests("t1"), 0);
  });

  it("aborts an in-flight flush and re-merges its texts with the follow-up", async () => {
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const flushes: string[] = [];

    const a = scheduleCoalescedMainGen({
      threadId: "t2",
      text: "first",
      debounceMs: 20,
      execute: async ({ composedText, signal, partCount }) => {
        flushes.push(`start:${partCount}:${composedText}`);
        releaseFirst();
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 200);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            resolve();
          });
        });
      },
    });

    await firstStarted;
    const b = scheduleCoalescedMainGen({
      threadId: "t2",
      text: "second",
      debounceMs: 20,
      execute: async ({ composedText, partCount }) => {
        flushes.push(`done:${partCount}:${composedText}`);
      },
    });

    await Promise.all([a.promise, b.promise]);

    assert.ok(flushes.some((f) => f.startsWith("start:1:first")));
    assert.ok(flushes.some((f) => f === "done:2:first\n\nsecond"));
  });
});
