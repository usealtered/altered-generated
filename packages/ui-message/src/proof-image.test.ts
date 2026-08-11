import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateProofPng } from "./proof-image";

describe("generateProofPng", () => {
  it("returns a non-empty PNG buffer with extension", async () => {
    const img = await generateProofPng({ subtitle: "unit test" });
    assert.equal(img.contentType, "image/png");
    assert.ok(img.filename.endsWith(".png"));
    assert.ok(img.bytes.byteLength > 500);
    // PNG magic
    assert.equal(img.bytes[0], 0x89);
    assert.equal(img.bytes[1], 0x50);
    assert.equal(img.bytes[2], 0x4e);
    assert.equal(img.bytes[3], 0x47);
  });
});
