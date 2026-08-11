import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOutboundSession } from "./outbound";

describe("createOutboundSession", () => {
  it("sends typing before each bubble and splits substantial paragraphs", async () => {
    const posts: string[] = [];
    const events: string[] = [];
    const a =
      "First paragraph with enough substance to stand alone as its own bubble.";
    const b =
      "Second paragraph also long enough that we should not glue it back together.";

    const session = createOutboundSession({
      id: "t1",
      post: async (text) => {
        events.push(`post:${text.slice(0, 20)}`);
        posts.push(text);
      },
      startTyping: async () => {
        events.push("typing");
      },
    });

    await session.send(`${a}\n\n${b}`, "reply");
    assert.equal(posts.length, 2);
    assert.deepEqual(events, [
      "typing",
      `post:${a.slice(0, 20)}`,
      "typing",
      `post:${b.slice(0, 20)}`,
    ]);
    assert.ok(posts[0]!.includes("\n") === false || posts[0] === a);
    assert.equal(posts[0], a);
    assert.equal(posts[1], b);
  });

  it("ensureStatus only fires once before tool work", async () => {
    const posts: string[] = [];
    const session = createOutboundSession({
      id: "t2",
      post: async (text) => {
        posts.push(text);
      },
    });
    await session.ensureStatus("Checking that now.");
    await session.ensureStatus("Checking that now.");
    assert.equal(posts.length, 1);
    assert.equal(posts[0], "Checking that now.");
    assert.equal(session.statusSent, true);
  });

  it("preserves paragraph breaks inside a single short multi-line bubble", async () => {
    const posts: string[] = [];
    const session = createOutboundSession({
      id: "t3",
      post: async (text) => {
        posts.push(text);
      },
    });
    await session.send("Ok.\n\nDone.", "reply");
    assert.equal(posts.length, 1);
    assert.equal(posts[0], "Ok.\n\nDone.");
  });
});
