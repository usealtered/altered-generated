/**
 * Structured inbound-pipeline tracing.
 *
 * Every stage logs one JSON line:
 *   [altered-ops:trace] {"v":1,"stage":"...","cid":"...","ts":"...","elapsedMs":N,...}
 *
 * Query Vercel: `altered-ops:trace` (optionally + cid / messageHandle).
 */

export type TraceContext = {
  /** Correlation id - prefer Sendblue message_handle, else generated. */
  cid: string;
  /** Epoch ms when our webhook handler first saw the request. */
  t0: number;
  phone?: string;
  threadId?: string;
  messageHandle?: string;
};

export type TraceStage =
  | "webhook_received"
  | "webhook_parsed"
  | "read_receipt_start"
  | "read_receipt_done"
  | "read_receipt_error"
  | "webhook_http_ok"
  | "handler_start"
  | "fast_ack_start"
  | "fast_ack_done"
  | "status_send_start"
  | "status_send_done"
  | "main_gen_detached"
  | "main_gen_start"
  | "main_gen_done"
  | "outbound_send_start"
  | "outbound_send_done"
  | "send_lock_wait"
  | "send_lock_acquired"
  | "send_lock_released"
  | "turn_complete"
  | "turn_error";

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** Build a short cid from message_handle or random. */
export function makeTraceCid(messageHandle?: string | null): string {
  if (messageHandle && messageHandle.length > 0) {
    return messageHandle.length > 36
      ? messageHandle.slice(0, 36)
      : messageHandle;
  }
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTrace(input: {
  messageHandle?: string | null;
  phone?: string;
  threadId?: string;
  t0?: number;
}): TraceContext {
  return {
    cid: makeTraceCid(input.messageHandle),
    t0: input.t0 ?? Date.now(),
    phone: input.phone,
    threadId: input.threadId,
    messageHandle: input.messageHandle ?? undefined,
  };
}

/**
 * Parse Sendblue date_sent (ISO string or epoch ms/seconds) → epoch ms, or null.
 */
export function parseSendblueDateSent(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs ms
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && value.trim().match(/^\d+(\.\d+)?$/)) {
      return asNum < 1e12 ? Math.round(asNum * 1000) : Math.round(asNum);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export function webhookAgeMs(
  dateSentMs: number | null,
  receivedAtMs: number,
): number | null {
  if (dateSentMs == null) return null;
  return Math.max(0, receivedAtMs - dateSentMs);
}

export function traceLog(
  ctx: TraceContext,
  stage: TraceStage,
  extra: Record<string, unknown> = {},
): void {
  const now = Date.now();
  const payload: Record<string, unknown> = {
    v: 1,
    stage,
    cid: ctx.cid,
    ts: iso(now),
    t0: ctx.t0,
    elapsedMs: now - ctx.t0,
  };
  if (ctx.phone) payload.phone = ctx.phone;
  if (ctx.threadId) payload.threadId = ctx.threadId;
  if (ctx.messageHandle) payload.messageHandle = ctx.messageHandle;
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) payload[k] = v;
  }
  console.info(`[altered-ops:trace] ${JSON.stringify(payload)}`);
}
