import { implement } from "@orpc/server";
import { appContract } from "@altered/api-contract";
import {
  createOperatorContext,
  handleOperatorMessage,
} from "@altered/chat";
import { createCursorClient } from "@altered/cursor-bridge";
import { createDb, dailyMetrics, leads } from "@altered/db";
import { getServerEnv, missingCriticalEnv } from "@altered/env";
import { getKnowledgeRoot } from "@altered/knowledge";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { desc, eq, sql } from "drizzle-orm";

const os = implement(appContract);

function knowledgeRoot() {
  return getKnowledgeRoot();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export const router = os.router({
  health: os.health.handler(async () => {
    const env = getServerEnv();
    return {
      ok: true,
      service: "altered-api",
      missingEnv: missingCriticalEnv(env),
      time: new Date().toISOString(),
    };
  }),

  createLead: os.createLead.handler(async ({ input }) => {
    const env = getServerEnv();
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL required");
    }
    const db = createDb(env.DATABASE_URL);
    const [lead] = await db
      .insert(leads)
      .values({
        email: input.email,
        phone: input.phone,
        name: input.name,
        company: input.company,
        source: input.source ?? "web",
        notes: input.notes,
        utm: input.utm,
        status: input.wantDepositCheckout ? "qualified" : "new",
        depositAmountCents: env.EARLY_ACCESS_DEPOSIT_AMOUNT_CENTS,
        depositCurrency: env.EARLY_ACCESS_DEPOSIT_CURRENCY,
      })
      .returning();

    await db
      .insert(dailyMetrics)
      .values({ day: todayKey(), leadsCreated: 1 })
      .onConflictDoUpdate({
        target: dailyMetrics.day,
        set: {
          leadsCreated: sql`${dailyMetrics.leadsCreated} + 1`,
          updatedAt: new Date(),
        },
      });

    return {
      id: lead!.id,
      status: lead!.status,
      checkoutUrl: env.EARLY_ACCESS_CHECKOUT_URL,
    };
  }),

  listLeads: os.listLeads.handler(async ({ input }) => {
    const env = getServerEnv();
    if (!env.DATABASE_URL) return { items: [] };
    const db = createDb(env.DATABASE_URL);
    const rows = await db
      .select()
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(input?.limit ?? 20);
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        phone: r.phone,
        name: r.name,
        company: r.company,
        status: r.status,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }),

  metricsToday: os.metricsToday.handler(async () => {
    const env = getServerEnv();
    const day = todayKey();
    const goalCents = 25000;
    if (!env.DATABASE_URL) {
      return {
        day,
        leadsCreated: 0,
        depositsCount: 0,
        depositsCents: 0,
        goalCents,
        progress: 0,
      };
    }
    const db = createDb(env.DATABASE_URL);
    const row = await db.query.dailyMetrics.findFirst({
      where: eq(dailyMetrics.day, day),
    });
    const depositsCents = row?.depositsCents ?? 0;
    return {
      day,
      leadsCreated: row?.leadsCreated ?? 0,
      depositsCount: row?.depositsCount ?? 0,
      depositsCents,
      goalCents,
      progress: Math.min(1, depositsCents / goalCents),
    };
  }),

  askRag: os.askRag.handler(async ({ input }) => {
    const env = getServerEnv();
    const chunks = await loadKnowledgeDir(knowledgeRoot());
    return answerWithRag({
      query: input.query,
      chunks,
      modelId: env.AI_MODEL,
      hasLlm: Boolean(env.OPENAI_API_KEY),
      openAiApiKey: env.OPENAI_API_KEY,
    });
  }),

  cursorStatus: os.cursorStatus.handler(async () => {
    const env = getServerEnv();
    if (!env.CURSOR_API_KEY || !env.CURSOR_OPERATING_AGENT_ID) {
      return { agentId: null, agentUrl: null, latestRun: null };
    }
    const cursor = createCursorClient(env.CURSOR_API_KEY);
    const agent = await cursor.getAgent(env.CURSOR_OPERATING_AGENT_ID);
    if (!agent.latestRunId) {
      return {
        agentId: agent.id,
        agentUrl: agent.url ?? null,
        latestRun: null,
      };
    }
    const run = await cursor.getRun(agent.id, agent.latestRunId);
    return {
      agentId: agent.id,
      agentUrl: agent.url ?? null,
      latestRun: {
        id: run.id,
        status: run.status,
        result: run.result,
      },
    };
  }),

  promptCursor: os.promptCursor.handler(async ({ input }) => {
    const env = getServerEnv();
    const reply = await handleOperatorMessage({
      ctx: createOperatorContext({ env, knowledgeRoot: knowledgeRoot() }),
      chatThreadId: `api:${input.notifyPhone ?? "system"}`,
      phone: input.notifyPhone ?? "+10000000000",
      text: input.prompt,
    });
    const runMatch = reply.match(/run[=:]?\s*([a-z0-9-]+)/i);
    const jobMatch = reply.match(/job[=:]?\s*([a-z0-9-]+)/i);
    return {
      jobId: jobMatch?.[1] ?? "unknown",
      agentId: input.agentId ?? env.CURSOR_OPERATING_AGENT_ID ?? "unknown",
      runId: runMatch?.[1] && runMatch[1] !== "n/a" ? runMatch[1] : null,
      status: /busy/i.test(reply) ? "busy_retry" : "running",
    };
  }),
});

export type AppRouter = typeof router;
