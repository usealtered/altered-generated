import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv, normalizePhone } from "@altered/env";
import { createOperatorContext, handleOperatorMessage } from "./operator";

export type AlteredChat = Chat;

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
      raw?: { number?: string; from_number?: string; to_number?: string };
    },
  ) => {
    const text = message.text?.trim();
    if (!text) return;
    // Prefer contact `number` from Sendblue payload; adapter author.userId uses
    // from_number which can be the agent line on some inbound shapes.
    const agentLine = normalizePhone(env.SENDBLUE_FROM_NUMBER ?? "");
    const candidates = [
      message.raw?.number,
      message.author?.userId,
      message.raw?.from_number,
      message.raw?.to_number,
    ]
      .filter((v): v is string => Boolean(v))
      .map((v) => normalizePhone(v))
      .filter((v) => v && v !== agentLine);
    const phone = candidates[0] ?? normalizePhone(message.author?.userId ?? "unknown");
    console.info("[altered-ops] inbound message", {
      phone,
      threadId: thread.id,
      textPreview: text.slice(0, 80),
    });
    try {
      await thread.subscribe();
      await thread.startTyping?.();
      const reply = await handleOperatorMessage({
        ctx,
        chatThreadId: thread.id,
        phone,
        text,
      });
      await thread.post(reply);
      console.info("[altered-ops] reply posted", { phone, replyLen: reply.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[altered-ops] inbound handler failed", { phone, error: msg });
      try {
        await thread.post(`Error handling message: ${msg}`.slice(0, 400));
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
