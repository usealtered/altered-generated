import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWN_OPERATOR_PHONES } from "./metrics";

describe("metrics integrity constants", () => {
  it("includes Riley operator phone", () => {
    assert.ok(KNOWN_OPERATOR_PHONES.includes("+12368370221"));
  });
});
