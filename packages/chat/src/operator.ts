import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import {
  formatRunStatus,
  truncateForImessage,
} from "@altered/cursor-bridge";
import { cursorJobs, messages, threads } from "@altered/db";
import { isOperatorPhone, normalizePhone, parseAllowlist } from "@altered/env";
import {
  getSoftDefaultAgentId,
  registerCursorAgent,
  setSoftDefaultAgentId,
} from "./agents";
import { createOpenRouter, chatAgentModelId } from "./model";
import {
  createOperatorContext,
  type OperatorContext,
} from "./operator-context";
import {
  bumpMetric,
  createOperatorTools,
  loadMemoryPreamble,
} from "./tools";

/** Optional env bootstrap only — not a hard singleton agent. */
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
    (await ctx.redis?.lrange(`chat:history:${phone}`, 0, 11)) ?? [];
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
Product: ALTERED — Knowledge Orchestration Infrastructure SaaS.
Near-term goal: early-access reservation deposits (offer band $99–$249, amount still being finalized).
You talk to Riley (founder/operator). Keep replies short and iMessage-friendly (plain text, no markdown tables).
Never invent slash commands. Use tools when you need status, knowledge, Cursor work, leads, metrics, checkout link, durable memory, or DB tasks.

Cursor agents are DYNAMIC — do not assume a single env agent id.
- Group related work into one workstream → one Cloud Agent chat (prompt_cursor with the same workstream).
- Start a new workstream/agent for unrelated tasks.
- Track open development work with upsert_dev_task / list_dev_tasks so chats can restart without loss.
- Prefer knowledge/ops/preferences.md + AGENTS.md for Riley's standing prefs (Git: ship to main; he does not manage PRs/branches).

Default: if Riley asks you to build/fix/ship/change the repo, call prompt_cursor with a workstream.
If he asks a factual question about the offer/ops/product, search_knowledge first.
Persist important decisions with save_memory (keys like offer.deposit, ops.decision.*, prefs.*).
Do not claim Stripe Checkout API is wired — use get_checkout_link for PRIMARY_CHECKOUT_URL when set.`;

export async function handleOperatorMessage(input: {
  ctx?: OperatorContext;
  chatThreadId: string;
  phone: string;
  text: string;
}): Promise<string> {
  const ctx = input.ctx ?? createOperatorContext();
  const phone = normalizePhone(input.phone);
  const allowlist = parseAllowlist(ctx.env.OPERATOR_PHONE_ALLOWLIST);
  if (!isOperatorPhone(phone, allowlist)) {
    return "Unauthorized phone for ALTERED ops bridge.";
  }

  await ensureSoftDefaultAgentSeed(ctx);
  const thread = await ensureThread(ctx, input.chatThreadId, phone);
  await saveMessage(ctx, thread?.id, "inbound", input.text);
  await bumpMetric(ctx, "imessageInbound");

  if (!ctx.env.OPENROUTER_API_KEY) {
    const reply =
      "OPENROUTER_API_KEY missing — AI tool calling offline. Add it on Vercel and retext.";
    await saveMessage(ctx, thread?.id, "outbound", reply);
    return reply;
  }

  const memory = await loadMemoryPreamble(ctx, phone);
  const softDefault = await getSoftDefaultAgentId(ctx);
  const history = await recentHistory(ctx, phone);
  const tools = createOperatorTools(ctx, {
    phone,
    threadDbId: thread?.id,
  });

  const openrouter = createOpenRouter(ctx.env);
  const modelId = chatAgentModelId(ctx.env);

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
      stopWhen: stepCountIs(6),
      temperature: 0.3,
    });

    const reply = truncateForImessage(
      result.text?.trim() ||
        "Done — check tool results / Cursor status if nothing else came back.",
    );

    await saveMessage(ctx, thread?.id, "outbound", reply);
    await ctx.redis?.lpush(
      `chat:history:${phone}`,
      JSON.stringify({ at: Date.now(), in: input.text, out: reply }),
    );
    await ctx.redis?.ltrim(`chat:history:${phone}`, 0, 49);
    return reply;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reply = truncateForImessage(`Error: ${msg}`);
    await saveMessage(ctx, thread?.id, "outbound", reply);
    return reply;
  }
}

export async function pollCursorJob(
  ctx: OperatorContext,
  input: { jobId: string; agentId: string; runId: string; notifyPhone?: string },
): Promise<{ done: boolean; summary?: string; notifyPhone?: string }> {
  if (!ctx.cursor) return { done: true, summary: "No Cursor client" };
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

  return {
    done: true,
    notifyPhone: input.notifyPhone,
    summary: truncateForImessage(
      `Cursor done (${run.status})\nagent=${input.agentId}\n${formatRunStatus(run)}`,
    ),
  };
}
