import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseWhitespace,
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
});

describe("collapseWhitespace", () => {
  it("flattens for single-line status snippets", () => {
    assert.equal(collapseWhitespace("a\n\nb  c"), "a b c");
  });
});
