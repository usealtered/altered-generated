import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv, normalizePhone } from "@altered/env";
import { runInBackground } from "./background";
import { generateFastAck } from "./fast-ack";
import {
  MAIN_GEN_COALESCE_MS,
  scheduleCoalescedMainGen,
} from "./main-gen-coalesce";
import { createOutboundSession } from "./outbound";
import { createOperatorContext, handleOperatorMessage } from "./operator";
import { sendMarkReadDirect } from "./read-receipt";
import { decodeSendblueThreadId } from "./thread-id";
import { createTrace, type TraceContext, traceLog } from "./trace";
import { shouldSkipHandlerFastAck } from "./webhook-fast-ack";
import { lookupWebhookReceivedAt } from "./webhook-timing";

export { sendblueThreadIdForContact, decodeSendblueThreadId } from "./thread-id";

export type AlteredChat = Chat;

type SendblueAdapterLike = {
  sendReadReceipt?: (threadId: string) => Promise<unknown>;
  markRead?: (threadId: string) => Promise<unknown>;
  encodeThreadId?: (d: {
    fromNumber: string;
    contactNumber?: string;
    groupId?: string;
  }) => string;
};

type MessageLike = {
  text?: string | null;
  author?: { userId?: string };
  raw?: unknown;
};

type MessageContextLike = {
  skipped?: MessageLike[];
  totalSinceLastHandler?: number;
};

function createState() {
  const env = getServerEnv();
  if (env.REDIS_URL) {
    return createRedisState({
      url: env.REDIS_URL,
      keyPrefix: "altered-chat",
    });
  }
  return createMemoryState();
}

function resolveInboundPhone(
  envFromNumber: string | undefined,
  message: MessageLike,
) {
  const agentLine = normalizePhone(envFromNumber ?? "");
  const raw =
    message.raw && typeof message.raw === "object"
      ? (message.raw as {
          number?: string;
          from_number?: string;
          to_number?: string;
        })
      : undefined;
  const candidates = [
    raw?.number,
    message.author?.userId,
    raw?.from_number,
    raw?.to_number,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => normalizePhone(v))
    .filter((v) => v && v !== agentLine);
  return candidates[0] ?? normalizePhone(message.author?.userId ?? "unknown");
}

function messageHandleFromRaw(message: MessageLike): string | undefined {
  const raw =
    message.raw && typeof message.raw === "object"
      ? (message.raw as { message_handle?: string })
      : undefined;
  return typeof raw?.message_handle === "string"
    ? raw.message_handle
    : undefined;
}

/** Combine queue skipped messages with the latest into one operator turn. */
function composeTurnText(message: MessageLike, context?: MessageContextLike) {
  const parts = [...(context?.skipped ?? []), message]
    .map((m) => m.text?.trim())
    .filter((t): t is string => Boolean(t));
  const deduped: string[] = [];
  for (const p of parts) {
    if (deduped[deduped.length - 1] !== p) deduped.push(p);
  }
  return deduped.join("\n\n");
}

/**
 * Fire read receipt immediately via direct Sendblue HTTP.
 * Never await behind status/LLM work. Prefer webhook_early path in app.ts.
 */
export function fireReadReceipt(
  _adapter: SendblueAdapterLike | undefined,
  threadId: string,
  meta?: { phone?: string; trace?: TraceContext; source?: string },
): Promise<void> {
  const decoded = decodeSendblueThreadId(threadId);
  const contact = meta?.phone ?? decoded.contactNumber;
  const from = decoded.fromNumber;
  if (!contact || !from) {
    console.warn("[altered-ops] read receipt skipped: missing numbers", {
      threadId,
      phone: meta?.phone,
    });
    return Promise.resolve();
  }
  return sendMarkReadDirect({
    contactNumber: contact,
    fromNumber: from,
    trace: meta?.trace,
    source: meta?.source ?? "handler",
  }).then(() => undefined);
}

export function createAlteredChat() {
  const env = getServerEnv();
  const chat = new Chat({
    userName: "altered-ops",
    // Burst coalesces only while the inbound lock is held. We release that
    // lock after fast-ack, so this window is a first-pass merge; main-gen
    // coalescing (MAIN_GEN_COALESCE_MS) merges across handlers.
    concurrency: {
      strategy: "burst",
      debounceMs: 1_500,
      maxQueueSize: 20,
      onQueueFull: "drop-oldest",
    },
    adapters: {
      sendblue: createSendblueAdapter({
        apiKey: env.SENDBLUE_API_KEY,
        apiSecret: env.SENDBLUE_API_SECRET,
        defaultFromNumber: env.SENDBLUE_FROM_NUMBER,
        webhookSecret: env.SENDBLUE_WEBHOOK_SECRET,
        allowedServices: ["iMessage", "SMS", "RCS"],
        // We fire mark-read ourselves (webhook_early + timed). Adapter auto
        // receipts are untimed and can race without adding coverage.
        sendReadReceipts: false,
      }),
    },
    state: createState(),
  });

  const ctx = createOperatorContext({ env });

  const onMessage = async (
    thread: {
      id: string;
      post: (text: string) => Promise<unknown>;
      startTyping?: () => Promise<unknown>;
      subscribe: () => Promise<unknown>;
    },
    message: MessageLike,
    context?: MessageContextLike,
  ) => {
    const handlerStarted = Date.now();
    const text = composeTurnText(message, context);
    if (!text) return;

    const phone = resolveInboundPhone(env.SENDBLUE_FROM_NUMBER, message);
    const messageHandle = messageHandleFromRaw(message);
    const webhookT0 = await lookupWebhookReceivedAt(messageHandle);
    const sinceWebhookMs =
      webhookT0 != null ? Math.max(0, handlerStarted - webhookT0) : null;
    const trace = createTrace({
      messageHandle,
      phone,
      threadId: thread.id,
      // Prefer webhook t0 so elapsedMs is end-to-end when available.
      t0: webhookT0 ?? handlerStarted,
    });

    traceLog(trace, "handler_start", {
      textPreview: text.slice(0, 80),
      skipped: context?.skipped?.length ?? 0,
      queueTotal: context?.totalSinceLastHandler ?? 1,
      sinceWebhookMs,
      handlerStartedAt: new Date(handlerStarted).toISOString(),
    });
    console.info("[altered-ops] inbound message", {
      phone,
      threadId: thread.id,
      cid: trace.cid,
      textPreview: text.slice(0, 80),
      skipped: context?.skipped?.length ?? 0,
      burstTotal: context?.totalSinceLastHandler ?? 1,
      sinceWebhookMs,
    });

    const adapter = chat.getAdapter("sendblue") as SendblueAdapterLike | undefined;

    const outbound = createOutboundSession({
      id: thread.id,
      post: (body) => thread.post(body),
      startTyping: () => thread.startTyping?.() ?? Promise.resolve(),
      sendReadReceipt: () =>
        fireReadReceipt(adapter, thread.id, {
          phone,
          trace,
          source: "outbound_session",
        }),
      trace,
      messageHandle,
    });

    // Backup receipt (webhook_early is primary). Fire-and-forget.
    void fireReadReceipt(adapter, thread.id, {
      phone,
      trace,
      source: "handler_backup",
    });

    // Fast-ack is dispatched at webhook receipt (outside Chat SDK lock).
    // Only backup here if webhook path did not already deliver it.
    const webhookAcked = await shouldSkipHandlerFastAck(messageHandle);
    if (webhookAcked) {
      traceLog(trace, "status_send_done", {
        skipped: true,
        reason: "webhook_early_ack",
        sinceWebhookMs,
      });
      console.info("[altered-ops] fast ack skipped (webhook-early)", {
        phone,
        cid: trace.cid,
        sinceWebhookMs,
      });
    } else {
      traceLog(trace, "fast_ack_start", { source: "handler_backup" });
      const ack = await generateFastAck(ctx, phone, text, trace);
      traceLog(trace, "fast_ack_done", {
        source: "handler_backup",
        genMs: ack.ms,
        model: ack.model,
        timedOut: ack.timedOut,
      });
      const sendStarted = Date.now();
      const sent = await outbound.send(ack.text, "status");
      console.info("[altered-ops] fast ack sent", {
        phone,
        threadId: thread.id,
        cid: trace.cid,
        model: ack.model,
        genMs: ack.ms,
        sendMs: Date.now() - sendStarted,
        handlerMs: Date.now() - handlerStarted,
        timedOut: ack.timedOut,
        skipped: Boolean(sent.skipped),
        preview: ack.text.slice(0, 80),
        source: "handler_backup",
      });
    }

    // Non-critical path after first bubble is out.
    void thread.subscribe().catch(() => undefined);

    // Detach Sonnet so the Chat SDK burst lock releases after fast-ack.
    // Coalesce across handlers: follow-ups during the quiet window (or while
    // a prior Sonnet is still running) merge into ONE main-gen with full text.
    const scheduled = await scheduleCoalescedMainGen({
      threadId: thread.id,
      text,
      trace,
      debounceMs: MAIN_GEN_COALESCE_MS,
      execute: async ({ composedText, signal, generation, partCount }) => {
        // Fresh outbound for the flushed turn (latest thread.post binding).
        const flushOutbound = createOutboundSession({
          id: thread.id,
          post: (body) => thread.post(body),
          startTyping: () => thread.startTyping?.() ?? Promise.resolve(),
          sendReadReceipt: () =>
            fireReadReceipt(adapter, thread.id, {
              phone,
              trace,
              source: "outbound_session",
            }),
          trace,
          messageHandle,
        });

        traceLog(trace, "main_gen_detached", {
          handlerMs: Date.now() - handlerStarted,
          sinceWebhookMs,
          generation,
          coalesced: partCount,
          burstSkipped: context?.skipped?.length ?? 0,
        });

        try {
          const reply = await handleOperatorMessage({
            ctx,
            chatThreadId: thread.id,
            phone,
            text: composedText,
            outbound: flushOutbound,
            trace,
            abortSignal: signal,
          });
          if (signal.aborted) {
            traceLog(trace, "main_gen_aborted", {
              generation,
              reason: "stale_after_complete",
              partCount,
            });
            return;
          }
          traceLog(trace, "turn_complete", {
            replyLen: reply.length,
            sends: flushOutbound.sent.length,
            totalMs: Date.now() - handlerStarted,
            sinceWebhookMs,
            generation,
            partCount,
          });
          console.info("[altered-ops] turn complete", {
            phone,
            cid: trace.cid,
            replyLen: reply.length,
            sends: flushOutbound.sent.length,
            totalMs: Date.now() - handlerStarted,
            generation,
            partCount,
          });
        } catch (err) {
          if (signal.aborted) {
            traceLog(trace, "main_gen_aborted", {
              generation,
              reason: "abort_signal",
              partCount,
            });
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (/abort/i.test(msg)) {
            traceLog(trace, "main_gen_aborted", {
              generation,
              reason: "abort_error",
              partCount,
            });
            return;
          }
          traceLog(trace, "turn_error", { error: msg, generation, partCount });
          console.error("[altered-ops] inbound handler failed", {
            phone,
            cid: trace.cid,
            error: msg,
          });
          try {
            await flushOutbound.send(
              `Error handling message: ${msg}`.slice(0, 400),
            );
          } catch {
            /* ignore secondary send failure */
          }
        }
      },
    });

    // Keep the isolate alive through debounce quiet-window + Sonnet.
    runInBackground(scheduled.promise);
  };

  chat.onDirectMessage(async (thread, message, _channel, context) => {
    await onMessage(thread, message, context);
  });

  chat.onNewMention(async (thread, message, context) => {
    await onMessage(thread, message, context);
  });

  chat.onSubscribedMessage(async (thread, message, context) => {
    await onMessage(thread, message, context);
  });

  return chat;
}

let singleton: AlteredChat | null = null;

export function getAlteredChat() {
  if (!singleton) singleton = createAlteredChat();
  return singleton;
}
