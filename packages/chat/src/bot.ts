import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";
import { getServerEnv } from "@altered/env";
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
    message: { text?: string | null; author?: { userId?: string } },
  ) => {
    const text = message.text?.trim();
    if (!text) return;
    await thread.subscribe();
    await thread.startTyping?.();
    const phone = message.author?.userId ?? "unknown";
    const reply = await handleOperatorMessage({
      ctx,
      chatThreadId: thread.id,
      phone,
      text,
    });
    await thread.post(reply);
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
