import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createOutboundSession } from "./outbound";
import { useMemoryThreadLocksForTests } from "./thread-lock";

describe("outbound status never ellipsis-clips", () => {
  before(() => {
    useMemoryThreadLocksForTests();
  });

  it("rejects multi-question status into On it. instead of target...", async () => {
    const posts: string[] = [];
    const session = createOutboundSession({
      id: "status-clip-t1",
      messageHandle: "mh-status-clip-1",
      post: async (text) => {
        posts.push(text);
      },
    });
    const rogue =
      "Got it. Three quick ones:\n\nWhat's the core product or service?\nWho's the target customer?";
    await session.send(rogue, "status");
    assert.equal(posts.length, 1);
    assert.equal(posts[0], "On it.");
    assert.ok(!posts[0]!.includes("..."));
    assert.ok(!posts[0]!.includes("target"));
  });

  it("sends multi-question replies intact across bubbles", async () => {
    const posts: string[] = [];
    const session = createOutboundSession({
      id: "reply-intact-t1",
      post: async (text) => {
        posts.push(text);
      },
    });
    const full = [
      "Got it. Three quick ones:",
      "What's the core product or service?",
      "Who's the target customer and what pain is acute?",
      "What does a win look like in 90 days?",
    ].join("\n\n");
    await session.send(full, "reply");
    const joined = posts.join("\n\n");
    assert.ok(joined.includes("What's the core product or service?"));
    assert.ok(joined.includes("Who's the target customer"));
    assert.ok(joined.includes("What does a win look like in 90 days?"));
    assert.ok(!joined.includes("target..."));
    assert.ok(posts.every((p) => !p.endsWith("...") || p.length < 20));
  });
});
