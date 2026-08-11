import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseWhitespace,
  enforceShortStatusBubble,
  splitImessageParts,
  truncateForImessage,
} from "./client";

describe("truncateForImessage", () => {
  it("preserves paragraph breaks instead of flattening to one line", () => {
    const input = "Line one.\n\nLine two.\n\nLine three.";
    const out = truncateForImessage(input);
    assert.equal(out, "Line one.\n\nLine two.\n\nLine three.");
    assert.ok(out.includes("\n\n"));
  });

  it("collapses horizontal whitespace only", () => {
    assert.equal(
      truncateForImessage("Hello   world.\n\nNext    para."),
      "Hello world.\n\nNext para.",
    );
  });

  it("ellipsis-clips only when over max (legacy helper)", () => {
    const raw =
      "Got it. Three quick ones:\n\nWhat's the core product or service?\nWho's the target customer?";
    const out = truncateForImessage(raw, 80);
    assert.ok(out.endsWith("..."));
    assert.ok(out.length <= 82);
    // This is the bug Riley saw - keep the repro locked in tests.
    assert.match(out, /Who's the target\.\.\./);
  });
});

describe("enforceShortStatusBubble", () => {
  it("rejects the Riley truncation repro instead of ellipsis-clipping", () => {
    const raw =
      "Got it. Three quick ones:\n\nWhat's the core product or service?\nWho's the target customer?";
    const out = enforceShortStatusBubble(raw, { maxChars: 80, maxWords: 12 });
    assert.equal(out.rejected, true);
    assert.equal(out.reason, "contains_question");
    assert.equal(out.text, "On it.");
    assert.ok(!out.text.includes("..."));
  });

  it("passes short acks through", () => {
    const out = enforceShortStatusBubble("Got it - checking now.");
    assert.equal(out.rejected, false);
    assert.equal(out.text, "Got it - checking now.");
  });

  it("rejects overlong status without questions", () => {
    const raw =
      "Working through the full checklist and will report back with concrete next steps shortly for you";
    const out = enforceShortStatusBubble(raw, { maxChars: 80, maxWords: 12 });
    assert.equal(out.rejected, true);
    assert.ok(
      out.reason === "too_many_words" || out.reason === "too_long",
    );
    assert.equal(out.text, "On it.");
  });
});

describe("splitImessageParts", () => {
  it("splits substantial paragraphs into separate messages", () => {
    const a =
      "First paragraph with enough substance to stand alone as its own bubble.";
    const b =
      "Second paragraph also long enough that we should not glue it back together.";
    const parts = splitImessageParts(`${a}\n\n${b}`);
    assert.equal(parts.length, 2);
    assert.equal(parts[0], a);
    assert.equal(parts[1], b);
  });

  it("keeps tiny paragraphs together", () => {
    const parts = splitImessageParts("Ok.\n\nDone.");
    assert.equal(parts.length, 1);
    assert.equal(parts[0], "Ok.\n\nDone.");
  });

  it("hard-splits oversize single paragraphs without ellipsis", () => {
    const long = `${"word ".repeat(400)}end.`;
    const parts = splitImessageParts(long, 1400);
    assert.ok(parts.length >= 2);
    assert.ok(parts.every((p) => p.length <= 1400));
    assert.ok(parts.every((p) => !p.endsWith("...")));
    assert.ok(parts.join(" ").includes("end."));
  });
});

describe("collapseWhitespace", () => {
  it("flattens for single-line status snippets", () => {
    assert.equal(collapseWhitespace("a\n\nb  c"), "a b c");
  });
});
