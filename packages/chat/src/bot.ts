import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv, normalizePhone } from "@altered/env";
import { generateFastAck } from "./fast-ack";
import { createOutboundSession } from "./outbound";
import { createOperatorContext, handleOperatorMessage } from "./operator";

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
 * Fire read receipt immediately. Never await behind status/LLM work.
 * Caller should also register the promise with waitUntil so the isolate stays warm.
 */
export function fireReadReceipt(
  adapter: SendblueAdapterLike | undefined,
  threadId: string,
  meta?: { phone?: string },
): Promise<void> {
  const task = (async () => {
    if (adapter?.sendReadReceipt) {
      await adapter.sendReadReceipt(threadId);
      return;
    }
    await adapter?.markRead?.(threadId);
  })()
    .then(() => {
      console.info("[altered-ops] read receipt sent", {
        phone: meta?.phone,
        threadId,
      });
    })
    .catch((err) => {
      console.warn("[altered-ops] read receipt failed", {
        phone: meta?.phone,
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return task;
}

export function createAlteredChat() {
  const env = getServerEnv();
  const chat = new Chat({
    userName: "altered-ops",
    // Queue (not burst): no mandatory debounce wait on a lone message.
    // Overlapping inbound still serializes per-thread; latest + skipped[] on drain.
    concurrency: {
      strategy: "queue",
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
        sendReadReceipts: true,
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
    console.info("[altered-ops] inbound message", {
      phone,
      threadId: thread.id,
      textPreview: text.slice(0, 80),
      skipped: context?.skipped?.length ?? 0,
      burstTotal: context?.totalSinceLastHandler ?? 1,
    });

    const adapter = chat.getAdapter("sendblue") as SendblueAdapterLike | undefined;

    const outbound = createOutboundSession({
      id: thread.id,
      post: (body) => thread.post(body),
      startTyping: () => thread.startTyping?.() ?? Promise.resolve(),
      sendReadReceipt: () => fireReadReceipt(adapter, thread.id, { phone }),
    });

    // Receipt is fire-and-forget (also waitUntil-tracked at webhook). Do not
    // serialize first-bubble send behind mark-read completing.
    void fireReadReceipt(adapter, thread.id, { phone });
    const ack = await generateFastAck(ctx, phone, text);
    const sendStarted = Date.now();
    await outbound.send(ack.text, "status");
    console.info("[altered-ops] fast ack sent", {
      phone,
      threadId: thread.id,
      model: ack.model,
      genMs: ack.ms,
      sendMs: Date.now() - sendStarted,
      handlerMs: Date.now() - handlerStarted,
      timedOut: ack.timedOut,
      preview: ack.text.slice(0, 80),
    });

    // Non-critical path after first bubble is out.
    void thread.subscribe().catch(() => undefined);

    try {
      const reply = await handleOperatorMessage({
        ctx,
        chatThreadId: thread.id,
        phone,
        text,
        outbound,
      });
      console.info("[altered-ops] turn complete", {
        phone,
        replyLen: reply.length,
        sends: outbound.sent.length,
        totalMs: Date.now() - handlerStarted,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[altered-ops] inbound handler failed", { phone, error: msg });
      try {
        await outbound.send(`Error handling message: ${msg}`.slice(0, 400));
      } catch {
        /* ignore secondary send failure */
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

/** Resolve Sendblue thread id for a contact (used by webhook early receipt). */
export function sendblueThreadIdForContact(
  fromNumber: string,
  contactNumber: string,
): string {
  const from = Buffer.from(fromNumber).toString("base64url");
  const contact = Buffer.from(contactNumber).toString("base64url");
  return `sendblue:${from}:${contact}`;
}
