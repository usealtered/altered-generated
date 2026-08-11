import { createOperatorContext } from "./operator-context";
import { generateFastAck } from "./fast-ack";
import { sendImessageDirect } from "./sendblue-send";
import { claimThreadStatusAck } from "./thread-lock";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";
import {
  markWebhookAckClaimed,
  markWebhookAckSent,
  wasWebhookAckSent,
} from "./webhook-timing";

/**
 * Fast-ack that runs at webhook receipt - NEVER waits on Chat SDK inbound lock
 * or another message's main-gen / fast-ack handler.
 * Runs for both operator (Riley) and sales prospects.
 */
export async function dispatchWebhookFastAck(input: {
  phone: string;
  fromNumber: string;
  text: string;
  messageHandle: string;
  threadId: string;
  trace: TraceContext;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  genMs?: number;
  sendMs?: number;
  error?: string;
}> {
  const { phone, fromNumber, text, messageHandle, threadId, trace } = input;
  const ctx = createOperatorContext();

  // Per-messageHandle claim - overlap B must not be blocked by A's claim.
  const claimed = await claimThreadStatusAck(threadId, messageHandle);
  if (!claimed || (await wasWebhookAckSent(messageHandle))) {
    traceLog(trace, "status_send_done", {
      skipped: true,
      reason: "already_acked",
      source: "webhook_early",
    });
    return { ok: true, skipped: true };
  }

  // Before any Haiku await: handler skip-check must win the race.
  await markWebhookAckClaimed(messageHandle);

  traceLog(trace, "fast_ack_start", { source: "webhook_early" });
  const ack = await generateFastAck(ctx, phone, text, trace);
  traceLog(trace, "fast_ack_done", {
    source: "webhook_early",
    genMs: ack.ms,
    model: ack.model,
    timedOut: ack.timedOut,
  });

  traceLog(trace, "status_send_start", { source: "webhook_early" });
  traceLog(trace, "ack_send_start", { source: "webhook_early", kind: "status" });
  const sent = await sendImessageDirect({
    contactNumber: phone,
    fromNumber,
    text: ack.text,
  });
  if (!sent.ok) {
    traceLog(trace, "status_send_done", {
      source: "webhook_early",
      skipped: true,
      sendMs: sent.ms,
      error: sent.error,
    });
    console.warn("[altered-ops] webhook fast-ack send failed", {
      phone,
      cid: trace.cid,
      error: sent.error,
      ms: sent.ms,
    });
    return { ok: false, genMs: ack.ms, sendMs: sent.ms, error: sent.error };
  }

  await markWebhookAckSent(messageHandle);
  traceLog(trace, "ack_send_done", {
    source: "webhook_early",
    postMs: sent.ms,
    kind: "status",
  });
  traceLog(trace, "status_send_done", {
    source: "webhook_early",
    skipped: false,
    parts: 1,
    sendMs: sent.ms,
  });
  console.info("[altered-ops] webhook fast ack sent", {
    phone,
    cid: trace.cid,
    model: ack.model,
    genMs: ack.ms,
    sendMs: sent.ms,
    timedOut: ack.timedOut,
    preview: ack.text.slice(0, 80),
  });
  return { ok: true, genMs: ack.ms, sendMs: sent.ms };
}

export async function shouldSkipHandlerFastAck(
  messageHandle: string | undefined,
): Promise<boolean> {
  if (!messageHandle) return false;
  return wasWebhookAckSent(messageHandle);
}
