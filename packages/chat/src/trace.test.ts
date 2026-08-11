import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  makeTraceCid,
  parseSendblueDateSent,
  webhookAgeMs,
} from "./trace";

describe("trace helpers", () => {
  it("parses ISO and epoch date_sent", () => {
    const iso = parseSendblueDateSent("2026-08-11T02:32:00.000Z");
    assert.equal(iso, Date.parse("2026-08-11T02:32:00.000Z"));
    assert.equal(parseSendblueDateSent(1786415520000), 1786415520000);
    assert.equal(parseSendblueDateSent(1786415520), 1786415520000);
    assert.equal(parseSendblueDateSent(null), null);
  });

  it("computes webhook age", () => {
    assert.equal(webhookAgeMs(1000, 1600), 600);
    assert.equal(webhookAgeMs(null, 1600), null);
    assert.equal(webhookAgeMs(2000, 1600), 0);
  });

  it("prefers message_handle as cid", () => {
    assert.equal(makeTraceCid("ABC-123"), "ABC-123");
    assert.ok(makeTraceCid(null).startsWith("gen_"));
  });
});
