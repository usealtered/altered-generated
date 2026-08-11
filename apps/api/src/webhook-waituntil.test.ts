import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Mirrors Chat SDK processMessage + Sendblue adapter behavior:
 * when waitUntil is provided, the webhook can return 200 before handlers finish.
 */
describe("sendblue webhook waitUntil contract", () => {
  it("returns before background work settles when waitUntil is used", async () => {
    const order: string[] = [];
    let resolveWork!: () => void;
    const work = new Promise<void>((r) => {
      resolveWork = r;
    });

    const waitUntil = (task: Promise<unknown>) => {
      order.push("waitUntil-registered");
      void task.then(() => order.push("work-done"));
    };

    const processMessage = (
      handler: () => Promise<void>,
      options?: { waitUntil?: (t: Promise<unknown>) => void },
    ) => {
      const task = (async () => {
        order.push("handler-start");
        await handler();
        order.push("handler-end");
      })();
      options?.waitUntil?.(task);
      return task;
    };

    const handleWebhook = async (options?: {
      waitUntil?: (t: Promise<unknown>) => void;
    }) => {
      processMessage(async () => {
        await work;
      }, options);
      order.push("http-200");
      return new Response("OK", { status: 200 });
    };

    const res = await handleWebhook({ waitUntil });
    assert.equal(res.status, 200);
    assert.ok(order.includes("http-200"));
    assert.ok(order.includes("waitUntil-registered"));
    assert.ok(order.indexOf("http-200") < order.indexOf("handler-end") || !order.includes("handler-end"));
    // Background still pending until we release it
    assert.ok(!order.includes("work-done"));
    resolveWork();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(order.includes("work-done"));
  });
});
