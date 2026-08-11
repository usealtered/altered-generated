import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  beginMainGen,
  isCurrentMainGen,
  resetMainGenGatesForTests,
} from "./main-gen-gate";

describe("main-gen-gate", () => {
  beforeEach(() => {
    resetMainGenGatesForTests();
  });

  it("aborts the previous generation when a new inbound starts", () => {
    const a = beginMainGen("thread-1");
    assert.equal(a.generation, 1);
    assert.equal(a.signal.aborted, false);
    const b = beginMainGen("thread-1");
    assert.equal(b.generation, 2);
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, false);
    assert.equal(isCurrentMainGen("thread-1", 1), false);
    assert.equal(isCurrentMainGen("thread-1", 2), true);
  });

  it("isolates generations across threads", () => {
    const a = beginMainGen("t-a");
    const b = beginMainGen("t-b");
    assert.equal(a.signal.aborted, false);
    assert.equal(b.signal.aborted, false);
    beginMainGen("t-a");
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, false);
  });
});
