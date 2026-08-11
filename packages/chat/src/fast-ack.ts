import { generateText } from "ai";
import { sanitizeImessageText, truncateForImessage } from "@altered/cursor-bridge";
import type { OperatorContext } from "./operator-context";
import { chatAckModelId, createOpenRouter } from "./model";
import { extractUsage, recordAiEvent } from "./observability";

const ACK_SYSTEM = `You are ALTERED's iMessage ops copilot acknowledging Riley's latest message.
Write ONE short plain-text confirmation that you received it and are on it.
Hard rules:
- Max 12 words.
- Plain text only. No markdown. No em dashes (use hyphens).
- No questions. No tools. No lists.
- Serious and direct. Natural, not a canned template.
Examples of shape (do not copy verbatim): On it. Looking into that. Got it - checking now.`;

const ACK_TIMEOUT_MS = 2200;
const FALLBACK = "On it.";

async function loadTinyHistory(
  ctx: OperatorContext,
  phone: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // Last 1 turn only from Redis - never hydrate full thread / Neon for ack.
  const raw = (await ctx.redis?.lrange(`chat:history:${phone}`, 0, 0)) ?? [];
  const item = raw[0];
  if (!item) return [];
  try {
    const parsed =
      typeof item === "string"
        ? (JSON.parse(item) as { in?: string; out?: string })
        : (item as { in?: string; out?: string });
    const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (parsed.in) turns.push({ role: "user", content: parsed.in.slice(0, 280) });
    if (parsed.out) {
      turns.push({ role: "assistant", content: parsed.out.slice(0, 280) });
    }
    return turns;
  } catch {
    return [];
  }
}

/**
 * Fast receipt-confirmation generate: tiny history, no tools, short max tokens.
 * Times out to a short fallback so the first bubble stays under the latency budget.
 */
export async function generateFastAck(
  ctx: OperatorContext,
  phone: string,
  text: string,
): Promise<{ text: string; ms: number; model: string; timedOut: boolean }> {
  const started = Date.now();
  if (!ctx.env.OPENROUTER_API_KEY) {
    return {
      text: FALLBACK,
      ms: Date.now() - started,
      model: "fallback",
      timedOut: false,
    };
  }

  const modelId = chatAckModelId(ctx.env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACK_TIMEOUT_MS);

  try {
    const history = await loadTinyHistory(ctx, phone);
    const openrouter = createOpenRouter(ctx.env);
    const result = await generateText({
      model: openrouter.chat(modelId),
      system: ACK_SYSTEM,
      messages: [
        ...history,
        { role: "user", content: text.slice(0, 500) },
      ],
      maxOutputTokens: 40,
      temperature: 0.4,
      abortSignal: controller.signal,
    });

    const cleaned = truncateForImessage(
      sanitizeImessageText(result.text ?? ""),
      80,
    );
    const textOut = cleaned || FALLBACK;
    const ms = Date.now() - started;

    // Never block first-bubble send on Neon observability writes.
    void recordAiEvent(ctx, {
      surface: "ops_imessage_ack",
      phone,
      model: modelId,
      ...extractUsage(result.usage),
      latencyMs: ms,
      toolsCalled: [],
      ok: true,
      meta: { fastAck: true, maxOutputTokens: 40 },
    }).catch(() => undefined);

    return {
      text: textOut,
      ms,
      model: modelId,
      timedOut: false,
    };
  } catch (err) {
    const timedOut =
      controller.signal.aborted ||
      (err instanceof Error && /abort/i.test(err.message));
    const ms = Date.now() - started;
    void recordAiEvent(ctx, {
      surface: "ops_imessage_ack",
      phone,
      model: modelId,
      latencyMs: ms,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      meta: { fastAck: true, timedOut },
    }).catch(() => undefined);
    return {
      text: FALLBACK,
      ms,
      model: modelId,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
