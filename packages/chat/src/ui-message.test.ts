import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createOutboundSession } from "./outbound";
import { useMemoryThreadLocksForTests } from "./thread-lock";

describe("outbound sendMedia", () => {
  before(() => {
    useMemoryThreadLocksForTests();
  });

  it("types then posts media via transport.postMedia", async () => {
    const events: string[] = [];
    const session = createOutboundSession({
      id: "media-t1",
      post: async (text) => {
        events.push(`post:${text}`);
      },
      postMedia: async (url, caption) => {
        events.push(`media:${url}:${caption ?? ""}`);
      },
      startTyping: async () => {
        events.push("typing");
      },
    });

    const res = await session.sendMedia(
      "https://example.com/AlteredCard.png",
      "Here is the card.",
    );
    assert.equal(res.ok, true);
    assert.deepEqual(events, [
      "typing",
      "media:https://example.com/AlteredCard.png:Here is the card.",
    ]);
  });

  it("fails cleanly when media transport is unbound", async () => {
    const session = createOutboundSession({
      id: "media-t2",
      post: async () => undefined,
    });
    const res = await session.sendMedia("https://example.com/x.png");
    assert.equal(res.ok, false);
  });
});
