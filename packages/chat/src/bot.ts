import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv, normalizePhone } from "@altered/env";
import { createOutboundSession } from "./outbound";
import { createOperatorContext, handleOperatorMessage } from "./operator";

export type AlteredChat = Chat;

type SendblueAdapterLike = {
  sendReadReceipt?: (threadId: string) => Promise<unknown>;
  markRead?: (threadId: string) => Promise<unknown>;
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
  message: {
    author?: { userId?: string };
    raw?: unknown;
  },
) {
  // Prefer contact `number` from Sendblue payload; adapter author.userId uses
  // from_number which can be the agent line on some inbound shapes.
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

export function createAlteredChat() {
  const env = getServerEnv();
  const chat = new Chat({
    userName: "altered-ops",
    adapters: {
      sendblue: createSendblueAdapter({
        apiKey: env.SENDBLUE_API_KEY,
        apiSecret: env.SENDBLUE_API_SECRET,
        defaultFromNumber: env.SENDBLUE_FROM_NUMBER,
        webhookSecret: env.SENDBLUE_WEBHOOK_SECRET,
        allowedServices: ["iMessage", "SMS", "RCS"],
        // Fork: auto read-receipt on inbound before message handlers run.
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
    message: {
      text?: string | null;
      author?: { userId?: string };
      raw?: unknown;
    },
  ) => {
    const text = message.text?.trim();
    if (!text) return;

    const phone = resolveInboundPhone(env.SENDBLUE_FROM_NUMBER, message);
    console.info("[altered-ops] inbound message", {
      phone,
      threadId: thread.id,
      textPreview: text.slice(0, 80),
    });

    const adapter = chat.getAdapter("sendblue") as SendblueAdapterLike | undefined;
    const sendReadReceipt = async () => {
      if (adapter?.sendReadReceipt) {
        await adapter.sendReadReceipt(thread.id);
        return;
      }
      await adapter?.markRead?.(thread.id);
    };

    // Read receipt first, before any LLM / tool work.
    await sendReadReceipt()
      .then(() => {
        console.info("[altered-ops] read receipt sent", { phone, threadId: thread.id });
      })
      .catch((err) => {
        console.warn("[altered-ops] read receipt failed", {
          phone,
          threadId: thread.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    await thread.subscribe();

    const outbound = createOutboundSession({
      id: thread.id,
      post: (body) => thread.post(body),
      startTyping: () => thread.startTyping?.() ?? Promise.resolve(),
      sendReadReceipt,
    });

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

  // Preferred path for Sendblue 1:1 iMessage/SMS
  chat.onDirectMessage(async (thread, message) => {
    await onMessage(thread, message);
  });

  // Fallbacks for group / mention-style routing
  chat.onNewMention(async (thread, message) => {
    await onMessage(thread, message);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    await onMessage(thread, message);
  });

  return chat;
}

let singleton: AlteredChat | null = null;

export function getAlteredChat() {
  if (!singleton) singleton = createAlteredChat();
  return singleton;
}
