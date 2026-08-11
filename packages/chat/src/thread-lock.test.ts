import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withThreadSendLock } from "./thread-lock";

describe("withThreadSendLock", () => {
  it("serializes concurrent work on the same thread key", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const a = withThreadSendLock("t1", async () => {
      order.push("a-start");
      await gateA;
      order.push("a-end");
      return 1;
    });

    // Let A acquire the lock.
    await new Promise((r) => setTimeout(r, 5));

    const b = withThreadSendLock("t1", async () => {
      order.push("b");
      return 2;
    });

    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(order, ["a-start"]);
    releaseA();
    const results = await Promise.all([a, b]);
    assert.deepEqual(results, [1, 2]);
    assert.deepEqual(order, ["a-start", "a-end", "b"]);
  });

  it("allows parallel work on different thread keys", async () => {
    const started: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const a = withThreadSendLock("tA", async () => {
      started.push("A");
      await gateA;
    });
    const b = withThreadSendLock("tB", async () => {
      started.push("B");
    });

    await new Promise((r) => setTimeout(r, 5));
    assert.ok(started.includes("A"));
    assert.ok(started.includes("B"));
    releaseA();
    await Promise.all([a, b]);
  });
});
