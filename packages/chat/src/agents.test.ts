import assert from "node:assert/strict";
import { test } from "node:test";
import { slugifyWorkstream } from "./agents";

test("slugifyWorkstream normalizes labels", () => {
  assert.equal(slugifyWorkstream("Env Bootstrap"), "env-bootstrap");
  assert.equal(slugifyWorkstream("  Landing!! Page "), "landing-page");
  assert.equal(slugifyWorkstream(""), "general");
});
