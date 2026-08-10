import { aiEvents, dailyMetrics } from "@altered/db";
import { sql } from "drizzle-orm";
import type { OperatorContext } from "./operator-context";

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Rough USD per 1M tokens — refine from OpenRouter invoices over time. */
const RATE_TABLE: Array<{ match: RegExp; inputPerM: number; outputPerM: number }> = [
  { match: /claude-opus|opus-4/i, inputPerM: 15, outputPerM: 75 },
  { match: /claude-sonnet|sonnet/i, inputPerM: 3, outputPerM: 15 },
  { match: /claude-haiku|haiku/i, inputPerM: 0.8, outputPerM: 4 },
  { match: /gpt-4o-mini/i, inputPerM: 0.15, outputPerM: 0.6 },
  { match: /gpt-4o/i, inputPerM: 2.5, outputPerM: 10 },
];

const DEFAULT_RATE = { inputPerM: 3, outputPerM: 15 };

export function estimateCostMicros(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate =
    RATE_TABLE.find((r) => (model ? r.match.test(model) : false)) ?? DEFAULT_RATE;
  const usd =
    (inputTokens / 1_000_000) * rate.inputPerM +
    (outputTokens / 1_000_000) * rate.outputPerM;
  return Math.max(0, Math.round(usd * 1_000_000));
}

export function extractUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const u = (usage ?? {}) as Record<string, unknown>;
  const inputTokens = Number(
    u.inputTokens ?? u.promptTokens ?? u.prompt_tokens ?? 0,
  );
  const outputTokens = Number(
    u.outputTokens ?? u.completionTokens ?? u.completion_tokens ?? 0,
  );
  const totalTokens = Number(
    u.totalTokens ?? u.total_tokens ?? inputTokens + outputTokens,
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens)
      ? totalTokens
      : inputTokens + outputTokens,
  };
}

export function toolNamesFromSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const names: string[] = [];
  for (const step of steps) {
    const calls =
      (step as { toolCalls?: Array<{ toolName?: string }> })?.toolCalls ?? [];
    for (const call of calls) {
      if (call?.toolName) names.push(call.toolName);
    }
  }
  return names;
}

export async function recordAiEvent(
  ctx: OperatorContext,
  input: {
    surface?: string;
    threadId?: string;
    phone?: string;
    leadId?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costMicros?: number;
    latencyMs?: number;
    toolsCalled?: string[];
    ok?: boolean;
    error?: string;
    meta?: Record<string, unknown>;
  },
) {
  if (!ctx.db) return;

  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const totalTokens = input.totalTokens ?? inputTokens + outputTokens;
  const costMicros =
    input.costMicros ??
    estimateCostMicros(input.model, inputTokens, outputTokens);

  await ctx.db.insert(aiEvents).values({
    surface: input.surface ?? "ops_imessage",
    threadId: input.threadId,
    phone: input.phone,
    leadId: input.leadId,
    model: input.model,
    inputTokens,
    outputTokens,
    totalTokens,
    costMicros,
    latencyMs: input.latencyMs,
    toolsCalled: input.toolsCalled ?? [],
    ok: input.ok ?? true,
    error: input.error,
    meta: input.meta,
  });

  const day = todayKey();
  await ctx.db
    .insert(dailyMetrics)
    .values({
      day,
      aiCalls: 1,
      aiInputTokens: inputTokens,
      aiOutputTokens: outputTokens,
      aiCostMicros: costMicros,
    })
    .onConflictDoUpdate({
      target: dailyMetrics.day,
      set: {
        aiCalls: sql`${dailyMetrics.aiCalls} + 1`,
        aiInputTokens: sql`${dailyMetrics.aiInputTokens} + ${inputTokens}`,
        aiOutputTokens: sql`${dailyMetrics.aiOutputTokens} + ${outputTokens}`,
        aiCostMicros: sql`${dailyMetrics.aiCostMicros} + ${costMicros}`,
        updatedAt: new Date(),
      },
    });
}
