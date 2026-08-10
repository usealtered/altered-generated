import { createOpenAI } from "@ai-sdk/openai";
import type { ServerEnv } from "@altered/env";

/** OpenRouter-compatible provider (OpenAI SDK shape, custom base URL). */
export function createOpenRouter(env: ServerEnv) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }
  return createOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": env.SITE_BASE_URL ?? env.APP_BASE_URL ?? "https://generated.usealtered.com",
      "X-Title": "ALTERED Ops Bridge",
    },
  });
}

export function chatAgentModelId(env: ServerEnv) {
  return env.CHAT_AGENT_MODEL_ID;
}
