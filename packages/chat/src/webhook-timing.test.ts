import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  markWebhookAckClaimed,
  wasWebhookAckSent,
} from "./webhook-timing";

describe("webhook-timing ack claim", () => {
  it("treats claimed (pre-send) as already acked for handler skip", async () => {
    const handle = `test-claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    assert.equal(await wasWebhookAckSent(handle), false);
    await markWebhookAckClaimed(handle);
    assert.equal(await wasWebhookAckSent(handle), true);
  });
});
