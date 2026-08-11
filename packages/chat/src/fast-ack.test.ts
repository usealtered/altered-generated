import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateFastAck } from "./fast-ack";
import type { OperatorContext } from "./operator-context";

function stubCtx(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    env: {
      OPENROUTER_API_KEY: undefined,
      CHAT_ACK_MODEL_ID: "anthropic/claude-haiku-4.5",
    } as OperatorContext["env"],
    redis: undefined,
    ...overrides,
  } as OperatorContext;
}

describe("generateFastAck", () => {
  it("falls back immediately when OpenRouter key is missing", async () => {
    const started = Date.now();
    const result = await generateFastAck(stubCtx(), "+12368370221", "ping");
    assert.equal(result.text, "On it.");
    assert.equal(result.model, "fallback");
    assert.equal(result.timedOut, false);
    assert.ok(Date.now() - started < 200);
    assert.ok(result.ms < 200);
  });

  it("uses tiny redis history without throwing on bad JSON", async () => {
    const redis = {
      lrange: async () => ["not-json{"],
    };
    const result = await generateFastAck(
      stubCtx({ redis: redis as unknown as OperatorContext["redis"] }),
      "+12368370221",
      "status?",
    );
    assert.equal(result.text, "On it.");
  });
});
