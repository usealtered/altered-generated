import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  sanitizeImessageText,
  truncateForImessage,
} from "@altered/cursor-bridge";
import type { OperatorContext } from "./operator-context";
import { createOpenRouter, chatAgentModelId } from "./model";
import { extractUsage, recordAiEvent } from "./observability";
import { sendblueThreadIdForContact } from "./thread-id";
import { withThreadSendLock } from "./thread-lock";

export type CompletionNotice = {
  agentId: string;
  runId: string;
  status: string;
  /** Raw agent result - never sent to Riley as-is. */
  rawResult?: string | null;
  workstream?: string | null;
  at: number;
};

const AGG_KEY = (phone: string) => `notify:agg:${phone}`;
const FLUSH_TOKEN_KEY = (phone: string) => `notify:flush:${phone}`;
/** Aggregation window for near-simultaneous Cursor completions. */
export const COMPLETION_AGG_WINDOW_SEC = 3;

/**
 * Queue a Cursor completion for debounced, merged delivery.
 * Near-simultaneous finishes on the same phone collapse into one outbound.
 */
export async function enqueueCompletionNotice(
  ctx: OperatorContext,
  phone: string,
  notice: Omit<CompletionNotice, "at">,
): Promise<{ queued: boolean; flushScheduled: boolean }> {
  const entry: CompletionNotice = { ...notice, at: Date.now() };

  if (!ctx.redis) {
    // No Redis: send immediately (still summarized, never raw).
    await deliverCompletionNotices(ctx, phone, [entry]);
    return { queued: false, flushScheduled: false };
  }

  await ctx.redis.lpush(AGG_KEY(phone), JSON.stringify(entry));
  await ctx.redis.expire(AGG_KEY(phone), 120);

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await ctx.redis.set(FLUSH_TOKEN_KEY(phone), token, {
    ex: 60,
  });

  if (ctx.qstash && ctx.env.APP_BASE_URL) {
    await ctx.qstash.publishJSON({
      url: `${ctx.env.APP_BASE_URL}/webhooks/qstash/notify-flush`,
      body: { phone, token },
      delay: COMPLETION_AGG_WINDOW_SEC,
      retries: 2,
    });
    return { queued: true, flushScheduled: true };
  }

  // Fallback: best-effort delayed flush in this isolate.
  setTimeout(() => {
    void flushCompletionNotices(ctx, phone, token).catch((err) => {
      console.error("[altered-ops] notify flush failed", err);
    });
  }, COMPLETION_AGG_WINDOW_SEC * 1000);
  return { queued: true, flushScheduled: true };
}

const DRAIN_LOCK_KEY = (phone: string) => `notify:drain:${phone}`;

/** Drain + send if this flush token is still the latest (debounce). */
export async function flushCompletionNotices(
  ctx: OperatorContext,
  phone: string,
  token: string,
): Promise<{ flushed: number; skipped?: boolean }> {
  if (!ctx.redis) return { flushed: 0 };

  const current = await ctx.redis.get<string>(FLUSH_TOKEN_KEY(phone));
  if (current && current !== token) {
    return { flushed: 0, skipped: true };
  }

  // Only one isolate may flush a phone at a time (QStash retry / overlap).
  const drainLock = await ctx.redis.set(DRAIN_LOCK_KEY(phone), token, {
    nx: true,
    ex: 60,
  });
  if (!(typeof drainLock === "string" && drainLock.toUpperCase() === "OK")) {
    return { flushed: 0, skipped: true };
  }

  try {
    // Recheck after lock - a newer enqueue may have superseded us.
    const latest = await ctx.redis.get<string>(FLUSH_TOKEN_KEY(phone));
    if (latest && latest !== token) {
      return { flushed: 0, skipped: true };
    }

    const raw = await ctx.redis.lrange(AGG_KEY(phone), 0, 49);
    await ctx.redis.del(AGG_KEY(phone), FLUSH_TOKEN_KEY(phone));

    const notices: CompletionNotice[] = [];
    for (const item of raw ?? []) {
      try {
        const parsed =
          typeof item === "string"
            ? (JSON.parse(item) as CompletionNotice)
            : (item as CompletionNotice);
        if (parsed?.agentId) notices.push(parsed);
      } catch {
        /* ignore */
      }
    }

    // lpush order is newest-first; chronological for summary
    notices.reverse();
    if (notices.length === 0) return { flushed: 0 };

    await deliverCompletionNotices(ctx, phone, notices);
    return { flushed: notices.length };
  } finally {
    await ctx.redis.del(DRAIN_LOCK_KEY(phone)).catch(() => undefined);
  }
}

async function deliverCompletionNotices(
  ctx: OperatorContext,
  phone: string,
  notices: CompletionNotice[],
) {
  const summary = await summarizeCompletions(ctx, phone, notices);
  if (!summary.trim()) return;

  const from = ctx.env.SENDBLUE_FROM_NUMBER;
  if (!from || !ctx.env.SENDBLUE_API_KEY) {
    console.warn("[altered-ops] cannot deliver completion notice: Sendblue unset");
    return;
  }

  const { getAlteredChat } = await import("./bot");
  const chat = getAlteredChat();
  await chat.initialize();
  const adapter = chat.getAdapter("sendblue") as {
    getSdk?: () => {
      messages: {
        send: (p: {
          number: string;
          from_number: string;
          content: string;
        }) => Promise<unknown>;
      };
    };
    startTyping?: (threadId: string) => Promise<unknown>;
    encodeThreadId?: (d: {
      fromNumber: string;
      contactNumber: string;
    }) => string;
  };

  const sdk = adapter.getSdk?.();
  if (!sdk) return;

  // Must match Chat SDK / outbound session thread ids (base64url), or the
  // per-thread send lock will not serialize against status/reply bubbles.
  const threadId =
    adapter.encodeThreadId?.({
      fromNumber: from,
      contactNumber: phone,
    }) ?? sendblueThreadIdForContact(from, phone);

  await withThreadSendLock(threadId, async () => {
    if (adapter.startTyping) {
      await adapter.startTyping(threadId).catch(() => undefined);
    }
    const parts = summary
      .split(/\n\n+/)
      .map((p) => sanitizeImessageText(p))
      .filter(Boolean);
    for (const part of parts.length ? parts : [summary]) {
      await sdk.messages.send({
        number: phone,
        from_number: from,
        content: truncateForImessage(part, 1400),
      });
    }
  });

  console.info("[altered-ops] completion notice delivered", {
    phone,
    notices: notices.length,
    summaryLen: summary.length,
  });
}

/**
 * Forced tool-calling summarizer: model must call send_message then done.
 * Raw markdown/tables from agent results never reach Riley.
 */
async function summarizeCompletions(
  ctx: OperatorContext,
  phone: string,
  notices: CompletionNotice[],
): Promise<string> {
  if (!ctx.env.OPENROUTER_API_KEY) {
    // Deterministic fallback - still sanitized, never raw dump.
    const lines = notices.map((n) => {
      const ws = n.workstream ? ` (${n.workstream})` : "";
      return `Cursor ${n.status.toLowerCase()}${ws}: agent ${n.agentId.slice(0, 14)}.`;
    });
    return sanitizeImessageText(lines.join(" "));
  }

  const openrouter = createOpenRouter(ctx.env);
  const modelId = chatAgentModelId(ctx.env);
  const sent: string[] = [];
  let finished = false;

  const payload = notices
    .map((n, i) => {
      const raw = (n.rawResult ?? "").slice(0, 1200);
      return [
        `#${i + 1}`,
        `agent=${n.agentId}`,
        `run=${n.runId}`,
        `status=${n.status}`,
        n.workstream ? `workstream=${n.workstream}` : null,
        raw ? `result_excerpt=${raw}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const started = Date.now();
  try {
    const result = await generateText({
      model: openrouter.chat(modelId),
      system: `You rewrite Cursor cloud-agent completion notices for Riley over iMessage.
Hard rules:
- Plain text only. No markdown. No em dashes (use hyphens).
- 1-3 short sentences total for the whole batch.
- Serious, precise, actionable. No fluff.
- You MUST call send_message with the user-facing summary, then call done.
- Never paste tables, bullet dumps, or raw agent transcripts.`,
      messages: [
        {
          role: "user",
          content: `Summarize these Cursor completion(s) for iMessage:\n\n${payload}`,
        },
      ],
      tools: {
        send_message: tool({
          description:
            "Send the short plain-text iMessage summary to Riley. Call once.",
          inputSchema: z.object({
            text: z
              .string()
              .min(1)
              .max(700)
              .describe("1-3 sentence plain-text summary"),
          }),
          execute: async ({ text }) => {
            const clean = sanitizeImessageText(text);
            if (clean) sent.push(clean);
            return { ok: true };
          },
        }),
        done: tool({
          description:
            "Signal that the summary was sent and this notify turn is finished.",
          inputSchema: z.object({
            ok: z.boolean().optional().default(true),
          }),
          // No execute: stops the tool loop when called (forced-tool pattern).
        }),
      },
      toolChoice: "required",
      stopWhen: [stepCountIs(4), hasToolCall("done")],
      temperature: 0.2,
    });

    void result; // ensure generateText completes; user text comes from send_message tool

    await recordAiEvent(ctx, {
      surface: "ops_imessage_notify",
      phone,
      model: modelId,
      ...extractUsage(result.usage),
      latencyMs: Date.now() - started,
      toolsCalled: ["send_message", "done"],
      ok: true,
      meta: { noticeCount: notices.length, forcedTools: true },
    });

    finished = sent.length > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[altered-ops] completion summarize failed", msg);
    await recordAiEvent(ctx, {
      surface: "ops_imessage_notify",
      phone,
      model: modelId,
      latencyMs: Date.now() - started,
      ok: false,
      error: msg,
    });
  }

  if (finished) return sent.join("\n\n");

  // Safe fallback
  if (notices.length === 1) {
    const n = notices[0]!;
    return sanitizeImessageText(
      `Cursor agent ${n.agentId.slice(0, 18)} finished with status ${n.status}. Check the agent URL for details.`,
    );
  }
  return sanitizeImessageText(
    `${notices.length} Cursor agents finished. Latest: ${notices[notices.length - 1]!.agentId.slice(0, 18)} (${notices[notices.length - 1]!.status}). Check the dashboard for details.`,
  );
}
