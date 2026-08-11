import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { truncateForImessage } from "@altered/cursor-bridge";
import { cursorJobs, messages, threads } from "@altered/db";
import { isOperatorPhone, normalizePhone, parseAllowlist } from "@altered/env";
import {
  getSoftDefaultAgentId,
  registerCursorAgent,
  setSoftDefaultAgentId,
} from "./agents";
import { createOpenRouter, chatAgentModelId } from "./model";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";
import {
  createOperatorContext,
  type OperatorContext,
} from "./operator-context";
import type { OutboundSession } from "./outbound";
import {
  extractUsage,
  recordAiEvent,
  toolNamesFromSteps,
} from "./observability";
import { handleSalesMessage } from "./sales";
import {
  bumpMetric,
  createOperatorTools,
  loadMemoryPreamble,
} from "./tools";
import { enqueueCompletionNotice } from "./notify";
import {
  enqueuePublish,
  tryHandleApprovalMessage,
} from "./posting";

/** Optional env bootstrap only - not a hard singleton agent. */
async function ensureSoftDefaultAgentSeed(ctx: OperatorContext) {
  const fromEnv = ctx.env.CURSOR_OPERATING_AGENT_ID;
  if (!fromEnv) return;
  const existing = await getSoftDefaultAgentId(ctx);
  if (existing) return;
  await setSoftDefaultAgentId(ctx, fromEnv);
  await registerCursorAgent(ctx, {
    agentId: fromEnv,
    workstream: "bootstrap",
    name: "env-bootstrap",
  });
}

export type { OperatorContext };
export { createOperatorContext };

async function ensureThread(
  ctx: OperatorContext,
  chatThreadId: string,
  phone: string,
) {
  if (!ctx.db) return null;
  const existing = await ctx.db.query.threads.findFirst({
    where: eq(threads.chatThreadId, chatThreadId),
  });
  if (existing) return existing;
  const [row] = await ctx.db
    .insert(threads)
    .values({ chatThreadId, phone, channel: "sendblue" })
    .returning();
  return row ?? null;
}

async function saveMessage(
  ctx: OperatorContext,
  threadId: string | undefined,
  direction: "inbound" | "outbound",
  body: string,
) {
  if (!ctx.db || !threadId) return;
  await ctx.db.insert(messages).values({ threadId, direction, body });
}

async function recentHistory(
  ctx: OperatorContext,
  phone: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const fromRedis =
    (await ctx.redis?.lrange(`chat:history:${phone}`, 0, 5)) ?? [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of [...fromRedis].reverse()) {
    try {
      const parsed =
        typeof item === "string"
          ? (JSON.parse(item) as { in?: string; out?: string })
          : (item as { in?: string; out?: string });
      if (parsed.in) turns.push({ role: "user", content: parsed.in });
      if (parsed.out) turns.push({ role: "assistant", content: parsed.out });
    } catch {
      /* ignore */
    }
  }
  return turns;
}

const SYSTEM = `You are ALTERED's operator copilot over iMessage.
Product: ALTERED - always-on iMessage agent / Knowledge Orchestration for detail-obsessed founders (ALTERED Koa / Layer 1).
Near-term revenue goal: $100 program reservation deposits (credits toward $499 program, net $399). Founding cohort. Never say pre-sale/presale.
You talk to Riley (founder/operator). Write with weight and intention: serious, brutalist, precise, critical, actionable, forward-moving. Hormozi-style directness when it fits. Not fluffy. Not playful.

SALES FUNNEL (for context when Riley asks; prospect DMs are handled by sales mode automatically):
- Knowledge: sales/imessage-funnel.md and offers/early-access-deposit.md
- Stages: new → contacted → qualified → reserved (checkout sent) → paid | lost
- Tools: save_lead, get_checkout_link

POSTING PIPELINE (HITL-minimal):
- Cron/QStash generates X/LinkedIn post idea batches and texts you for one-tap approval.
- Reply APPROVE ALL, REJECT ALL, APPROVE 1 3 5, or tap the approve link. No detailed review needed.
- Approved posts publish via Zernio automatically. Tools: generate_post_ideas, list_post_ideas, approve_posts, run_post_publish, posting_status.

FORMATTING (hard rules - also enforced by code sanitizer):
- Plain text only. No markdown asterisks, bold, italics, code fences, or markdown bullets.
- Structure with \\n\\n paragraph breaks, and/or multiple send_message calls.
- Never use em dashes. Use hyphens (-) instead.
- Full sentences with periods.
- Keep each send_message tight and iMessage-readable.

MULTI-SEND FLOW (hard rules):
- The runtime already sent a fast LLM receipt-ack before you were invoked. Do NOT send another status ack. Never use the canned phrase "Checking that now."
- Rapid inbound texts may be coalesced into one turn (paragraph-joined). Answer that combined turn ONCE. Do not narrate each line separately or re-answer older superseded turns.
- Every user-visible reply goes through send_message and/or send_ui_message. Never rely on a final assistant text blob.
- Flow: run tools as needed, start_typing, then send_message / send_ui_message the final answer (split across sends on paragraph breaks when useful).
- Use start_typing shortly before any reply you are about to send if tools just ran or there was a pause.
- You may send multiple send_message calls in one turn. Use send_ui_message for image/attachment bubbles (public mediaUrl or proof=true).
- When finished with all user-visible sends, call the done tool. toolChoice is required - you must use tools every step.

SELF-FIX / DELEGATION (hard rules):
- Any code, infra, bug, latency, formatting, or product concern Riley raises is an IMPLICIT instruction to act. Do not wait for him to say "make this change."
- Default action: prompt_cursor / spawn_cursor_agent on the right workstream, and upsert_dev_task so it is tracked.
- If it is a tiny factual ops question only, answer directly - but if it implies a fix, ship a task.
- Hyper-awareness: if YOU notice your own replies drifted (markdown, em dashes, fluff, raw dumps, missing status-before-tools), immediately upsert_dev_task a self-correction and/or prompt_cursor to fix the underlying code. Do not wait to be told.

AUDIT DEFAULT (for coding agents you spawn):
- For any diagnosis task, the coding agent owns pulling Vercel logs, querying relevant Neon tables, checking Redis state, and OpenRouter/AI usage as needed. Riley and this copilot should not have to spell that out each time. Encode it in the prompt_cursor task text.

Never invent slash commands. Use tools for status, knowledge, Cursor work, leads, metrics, checkout link, durable memory, or DB tasks.

Cursor agents are DYNAMIC - do not assume a single env agent id.
- Group related work into one workstream -> one Cloud Agent chat (prompt_cursor with the same workstream).
- Start a new workstream/agent for unrelated tasks.
- Track open development work with upsert_dev_task / list_dev_tasks so chats can restart without loss.
- Prefer knowledge/ops/preferences.md + AGENTS.md for Riley's standing prefs (Git: ship to main; he does not manage PRs/branches).

Default: if Riley asks you to build/fix/ship/change the repo, call prompt_cursor with a workstream.
If he asks a factual question about the offer/ops/product, search_knowledge first.
Persist important decisions with save_memory - KEY REQUIRED (offer.deposit, ops.decision.*, prefs.*).
Do not dump narrative into always-on context; use recall_memories / search_knowledge when needed.
Do not claim Stripe Checkout API is wired - use get_checkout_link for PRIMARY_CHECKOUT_URL when set.
Never paste raw agent transcripts, markdown tables, or tool JSON to Riley.`;

export async function handleOperatorMessage(input: {
  ctx?: OperatorContext;
  chatThreadId: string;
  phone: string;
  text: string;
  outbound?: OutboundSession;
  trace?: TraceContext;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const ctx = input.ctx ?? createOperatorContext();
  const phone = normalizePhone(input.phone);
  const allowlist = parseAllowlist(ctx.env.OPERATOR_PHONE_ALLOWLIST);
  if (!isOperatorPhone(phone, allowlist)) {
    // Prospect / sales mode on the public agent line.
    return handleSalesMessage({
      ctx,
      chatThreadId: input.chatThreadId,
      phone,
      text: input.text,
      outbound: input.outbound,
      trace: input.trace,
      abortSignal: input.abortSignal,
    });
  }

  // Fast LLM ack is sent by bot.ts before this function. Do not send a second
  // hardcoded status here - that was rejected as a permanent solution.

  await ensureSoftDefaultAgentSeed(ctx);
  const thread = await ensureThread(ctx, input.chatThreadId, phone);
  await saveMessage(ctx, thread?.id, "inbound", input.text);
  await bumpMetric(ctx, "imessageInbound");

  // HITL posting: one-tap APPROVE ALL / REJECT ALL before the full ops LLM turn.
  const approvalReply = await tryHandleApprovalMessage(ctx, input.text);
  if (approvalReply) {
    if (input.outbound) {
      await input.outbound.send(approvalReply);
      const transcript = input.outbound.joinedTranscript();
      await saveMessage(ctx, thread?.id, "outbound", transcript);
      // Kick publish soon after approval so posts go live without waiting for cron.
      if (/approved/i.test(approvalReply)) {
        await enqueuePublish(ctx, 8);
      }
      return transcript;
    }
    await saveMessage(ctx, thread?.id, "outbound", approvalReply);
    if (/approved/i.test(approvalReply)) {
      await enqueuePublish(ctx, 8);
    }
    return approvalReply;
  }

  if (!ctx.env.OPENROUTER_API_KEY) {
    const reply =
      "OPENROUTER_API_KEY missing - AI tool calling offline. Add it on Vercel and retext.";
    if (input.outbound) {
      await input.outbound.send(reply);
      await saveMessage(ctx, thread?.id, "outbound", input.outbound.joinedTranscript());
      return input.outbound.joinedTranscript();
    }
    await saveMessage(ctx, thread?.id, "outbound", reply);
    return reply;
  }

  // Preamble after fast ack so Redis/DB work cannot delay the first bubble.
  const memory = await loadMemoryPreamble(ctx, phone);
  const softDefault = await getSoftDefaultAgentId(ctx);
  const history = await recentHistory(ctx, phone);
  const baseTools = createOperatorTools(ctx, {
    phone,
    threadDbId: thread?.id,
    outbound: input.outbound,
  });

  // Forced tool-calling: every step must call a tool; done (no execute) ends the turn.
  const tools = {
    ...baseTools,
    done: tool({
      description:
        "Call after all user-visible send_message calls for this turn. Ends the loop. Do not put the user-facing reply here - use send_message.",
      inputSchema: z.object({
        ok: z.boolean().optional().default(true),
      }),
      // Intentionally no execute - AI SDK stops when a tool lacks execute.
    }),
  };

  const openrouter = createOpenRouter(ctx.env);
  const modelId = chatAgentModelId(ctx.env);
  const started = Date.now();
  if (input.trace) traceLog(input.trace, "main_gen_start", { model: modelId });

  try {
    const result = await generateText({
      model: openrouter.chat(modelId),
      system: [
        SYSTEM,
        `Domains: api=${ctx.env.APP_BASE_URL ?? "unset"} site=${ctx.env.SITE_BASE_URL ?? "unset"}`,
        `Sendblue line: ${ctx.env.SENDBLUE_FROM_NUMBER ?? "unset"}`,
        `Soft-default Cursor agent: ${softDefault ?? "unset (will auto-spawn per workstream)"}`,
        memory,
      ].join("\n\n"),
      messages: [...history, { role: "user", content: input.text }],
      tools,
      toolChoice: "required",
      stopWhen: [stepCountIs(10), hasToolCall("done")],
      temperature: 0.3,
      abortSignal: input.abortSignal,
      prepareStep: async ({ stepNumber, steps }) => {
        // After non-messaging tools, nudge toward typing/send/done rather than more research.
        if (stepNumber === 0) return {};
        const called = steps.flatMap((s) =>
          (s.toolCalls ?? []).map((c) => c.toolName),
        );
        const sent =
          called.includes("send_message") || called.includes("send_ui_message");
        const didWork = called.some(
          (n) =>
            n !== "send_message" &&
            n !== "send_ui_message" &&
            n !== "start_typing" &&
            n !== "done",
        );
        if (didWork && !sent) {
          return {
            activeTools: [
              "send_message",
              "send_ui_message",
              "start_typing",
              "done",
            ],
            toolChoice: "required" as const,
          };
        }
        return {};
      },
    });

    const usage = extractUsage(result.usage);
    const toolsCalled = toolNamesFromSteps(result.steps);
    const latencyMs = Date.now() - started;
    if (input.trace) {
      traceLog(input.trace, "main_gen_done", {
        model: modelId,
        genMs: latencyMs,
        ok: true,
        stepCount: Array.isArray(result.steps) ? result.steps.length : 0,
      });
    }
    await recordAiEvent(ctx, {
      surface: "ops_imessage",
      threadId: thread?.id,
      phone,
      model: modelId,
      ...usage,
      latencyMs,
      toolsCalled,
      ok: true,
      meta: {
        stepCount: Array.isArray(result.steps) ? result.steps.length : 0,
        forcedTools: true,
      },
    });

    // Prefer tool-sent bubbles. Do NOT flush raw model text (forced tools path).
    if (input.outbound) {
      if (!input.outbound.hasSent) {
        await input.outbound.send(
          "Done. Nothing else to report on that turn.",
        );
      }
      const reply = input.outbound.joinedTranscript();
      await saveMessage(ctx, thread?.id, "outbound", reply);
      await ctx.redis?.lpush(
        `chat:history:${phone}`,
        JSON.stringify({ at: Date.now(), in: input.text, out: reply }),
      );
      await ctx.redis?.ltrim(`chat:history:${phone}`, 0, 49);
      return reply;
    }

    return "Done.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const latencyMs = Date.now() - started;
    if (input.trace) {
      traceLog(input.trace, "main_gen_done", {
        model: modelId,
        genMs: latencyMs,
        ok: false,
        error: msg,
      });
    }
    await recordAiEvent(ctx, {
      surface: "ops_imessage",
      threadId: thread?.id,
      phone,
      model: modelId,
      latencyMs,
      ok: false,
      error: msg,
    });
    const reply = truncateForImessage(`Error: ${msg}`);
    if (input.outbound) {
      await input.outbound.send(reply);
      const out = input.outbound.joinedTranscript() || reply;
      await saveMessage(ctx, thread?.id, "outbound", out);
      return out;
    }
    await saveMessage(ctx, thread?.id, "outbound", reply);
    return reply;
  }
}

export async function pollCursorJob(
  ctx: OperatorContext,
  input: { jobId: string; agentId: string; runId: string; notifyPhone?: string },
): Promise<{
  done: boolean;
  queuedNotify?: boolean;
  notifyPhone?: string;
}> {
  if (!ctx.cursor) return { done: true };
  const run = await ctx.cursor.getRun(input.agentId, input.runId);
  const terminal = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(
    run.status,
  );

  if (!terminal) {
    if (ctx.qstash && ctx.env.APP_BASE_URL) {
      await ctx.qstash.publishJSON({
        url: `${ctx.env.APP_BASE_URL}/webhooks/qstash/cursor-poll`,
        body: input,
        delay: 25,
        retries: 3,
      });
    }
    return { done: false };
  }

  if (ctx.db) {
    await ctx.db
      .update(cursorJobs)
      .set({
        status: run.status === "FINISHED" ? "finished" : "error",
        resultSummary: run.result ?? run.status,
        updatedAt: new Date(),
      })
      .where(eq(cursorJobs.id, input.jobId));
  }

  // Never return raw markdown/result for direct Sendblue relay.
  // Queue for debounced, forced-tool summarized delivery.
  if (input.notifyPhone) {
    const { queued } = await enqueueCompletionNotice(ctx, input.notifyPhone, {
      agentId: input.agentId,
      runId: input.runId,
      status: run.status,
      rawResult: run.result ?? null,
    });
    return {
      done: true,
      queuedNotify: queued,
      notifyPhone: input.notifyPhone,
    };
  }

  return { done: true };
}
