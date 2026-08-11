import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendblueThreadIdForContact } from "./thread-id";

describe("sendblueThreadIdForContact", () => {
  it("matches chat-adapter-sendblue base64url encoding", () => {
    const id = sendblueThreadIdForContact("+13054098546", "+12368370221");
    assert.equal(id, "sendblue:KzEzMDU0MDk4NTQ2:KzEyMzY4MzcwMjIx");
  });
});
