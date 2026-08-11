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

  it("status ack skips typing so it is not blocked on typing API", async () => {
    const events: string[] = [];
    const session = createOutboundSession({
      id: "t2c",
      post: async (text) => {
        events.push(`post:${text}`);
      },
      startTyping: async () => {
        events.push("typing");
      },
    });
    await session.ensureStatus("Checking that now.");
    assert.deepEqual(events, ["post:Checking that now."]);
    await session.send("Final answer.");
    assert.deepEqual(events, [
      "post:Checking that now.",
      "typing",
      "post:Final answer.",
    ]);
  });

  it("ensureStatus is safe when tools race in parallel", async () => {
    const posts: string[] = [];
    let resolveFirstPost!: () => void;
    const firstPostGate = new Promise<void>((r) => {
      resolveFirstPost = r;
    });
    let postsStarted = 0;
    let secondResolvedEarly = false;

    const session = createOutboundSession({
      id: "t2b",
      post: async (text) => {
        postsStarted += 1;
        if (postsStarted === 1) await firstPostGate;
        posts.push(text);
      },
    });

    const a = session.ensureStatus("Checking that now.");
    // Yield so first caller claims + starts the in-flight send.
    await new Promise((r) => setTimeout(r, 0));
    const b = session.ensureStatus("Checking that now.").then((result) => {
      // Must not resolve before the shared status post finishes.
      if (posts.length === 0) secondResolvedEarly = true;
      return result;
    });
    await new Promise((r) => setTimeout(r, 5));
    resolveFirstPost();
    const results = await Promise.all([a, b]);

    assert.equal(posts.length, 1);
    assert.equal(posts[0], "Checking that now.");
    assert.equal(session.statusSent, true);
    assert.equal(secondResolvedEarly, false);
    assert.equal(results[0]?.skipped, false);
    assert.equal(results[1]?.skipped, true);
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
