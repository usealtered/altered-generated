import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeImessageText } from "./sanitize";

describe("sanitizeImessageText", () => {
  it("replaces em and en dashes with hyphens", () => {
    assert.equal(
      sanitizeImessageText("Done — shipped – live"),
      "Done - shipped - live",
    );
  });

  it("strips markdown bold/italic/code and list markers", () => {
    const input = "**Bold** and *italic* and `code`\n\n- item one\n- item two";
    const out = sanitizeImessageText(input);
    assert.equal(out.includes("**"), false);
    assert.equal(out.includes("`"), false);
    assert.ok(out.includes("Bold"));
    assert.ok(out.includes("item one"));
    assert.ok(out.includes("\n\n"));
  });

  it("flattens markdown tables into plain lines", () => {
    const input = "| Col | Val |\n| --- | --- |\n| A | 1 |";
    const out = sanitizeImessageText(input);
    assert.equal(out.includes("|"), false);
    assert.ok(out.includes("Col"));
    assert.ok(out.includes("A"));
  });

  it("preserves URLs and paragraph breaks", () => {
    const out = sanitizeImessageText(
      "See https://cursor.com/agents/bc-123\n\nNext line.",
    );
    assert.ok(out.includes("https://cursor.com/agents/bc-123"));
    assert.ok(out.includes("\n\n"));
  });
});
