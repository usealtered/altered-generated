import assert from "node:assert/strict";
import { test } from "node:test";
import { isOperatorPhone, normalizePhone, parseAllowlist } from "@altered/env";

test("normalize phone with spaces", () => {
  assert.equal(normalizePhone("+1 (236) 837-0221"), "+12368370221");
});

test("allowlist matches operator", () => {
  const list = parseAllowlist("+1 (236) 837-0221");
  assert.equal(isOperatorPhone("+12368370221", list), true);
  assert.equal(isOperatorPhone("+13054098546", list), false);
});
