import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv, normalizePhone } from "@altered/env";
import { generateFastAck } from "./fast-ack";
import { createOutboundSession } from "./outbound";
import { createOperatorContext, handleOperatorMessage } from "./operator";
import { sendMarkReadDirect } from "./read-receipt";
import { sendImessageMediaDirect } from "./sendblue-send";
import { decodeSendblueThreadId } from "./thread-id";
import { createTrace, type TraceContext, traceLog } from "./trace";
import { shouldSkipHandlerFastAck } from "./webhook-fast-ack";
import { lookupWebhookReceivedAt } from "./webhook-timing";

export { sendblueThreadIdForContact, decodeSendblueThreadId } from "./thread-id";

export type AlteredChat = Chat;

type SendblueAdapterLike = {
  sendReadReceipt?: (threadId: string) => Promise<unknown>;
  markRead?: (threadId: string) => Promise<unknown>;
  sendMediaMessage?: (
    threadId: string,
    mediaUrl: string,
    content?: string,
  ) => Promise<unknown>;
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

/** Combine Chat SDK burst skipped[] with the latest into one operator turn. */
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
 * Fire read receipt via direct Sendblue HTTP.
 * Prefer webhook_early path in app.ts; handler is backup only.
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
    // Chat SDK owns inbound coalescing. Hold the handler through main-gen so
    // rapid texts land in skipped[] instead of starting parallel turns.
    concurrency: {
      strategy: "burst",
      debounceMs: 1_000,
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
      postMedia: async (mediaUrl, caption) => {
        if (adapter?.sendMediaMessage) {
          await adapter.sendMediaMessage(thread.id, mediaUrl, caption ?? "");
          return;
        }
        const from = env.SENDBLUE_FROM_NUMBER;
        if (!from) throw new Error("SENDBLUE_FROM_NUMBER missing for media send");
        const res = await sendImessageMediaDirect({
          contactNumber: phone,
          fromNumber: from,
          mediaUrl,
          caption,
        });
        if (!res.ok) {
          throw new Error(res.error ?? "media send failed");
        }
      },
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

    void fireReadReceipt(adapter, thread.id, {
      phone,
      trace,
      source: "handler_backup",
    });

    // Fast-ack runs at webhook (outside this lock). Backup only if it missed.
    const webhookAcked = await shouldSkipHandlerFastAck(messageHandle);
    if (webhookAcked) {
      traceLog(trace, "status_send_done", {
        skipped: true,
        reason: "webhook_early_ack",
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
      await outbound.send(ack.text, "status");
    }

    void thread.subscribe().catch(() => undefined);

    // Await main-gen so Chat SDK burst keeps the lock and coalesces follow-ups.
    try {
      const reply = await handleOperatorMessage({
        ctx,
        chatThreadId: thread.id,
        phone,
        text,
        outbound,
        trace,
      });
      traceLog(trace, "turn_complete", {
        replyLen: reply.length,
        sends: outbound.sent.length,
        totalMs: Date.now() - handlerStarted,
        sinceWebhookMs,
        burstTotal: context?.totalSinceLastHandler ?? 1,
      });
      console.info("[altered-ops] turn complete", {
        phone,
        cid: trace.cid,
        replyLen: reply.length,
        sends: outbound.sent.length,
        totalMs: Date.now() - handlerStarted,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      traceLog(trace, "turn_error", { error: msg });
      console.error("[altered-ops] inbound handler failed", {
        phone,
        cid: trace.cid,
        error: msg,
      });
      try {
        await outbound.send(`Error handling message: ${msg}`.slice(0, 400));
      } catch {
        /* ignore */
      }
    }
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
