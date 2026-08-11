import { implement } from "@orpc/server";
import { appContract } from "@altered/api-contract";
import {
  createOperatorContext,
  handleOperatorMessage,
  computeSplitMetricsToday,
} from "@altered/chat";
import { createCursorClient } from "@altered/cursor-bridge";
import { createDb, dailyMetrics, leadEvents, leads } from "@altered/db";
import { getServerEnv, missingCriticalEnv } from "@altered/env";
import { getKnowledgeRoot } from "@altered/knowledge";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { desc, eq, sql } from "drizzle-orm";

// Deposit amount resolved from knowledge (not env)
async function depositCents() {
  const { resolveDepositAmountCents } = await import("@altered/chat/offer");
  return resolveDepositAmountCents(knowledgeRoot());
}

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
    const amountCents = await depositCents();
    const status = input.wantDepositCheckout ? "qualified" : "new";
    const source = input.source ?? "web";
    const isTest = /audit|test|smoke/i.test(source);
    const [lead] = await db
      .insert(leads)
      .values({
        email: input.email,
        phone: input.phone,
        name: input.name,
        company: input.company,
        source,
        notes: input.notes,
        utm: input.utm,
        status,
        isTest,
        depositAmountCents: amountCents,
        depositCurrency: env.EARLY_ACCESS_DEPOSIT_CURRENCY,
      })
      .returning();

    if (lead) {
      await db.insert(leadEvents).values({
        leadId: lead.id,
        type: "created",
        toStatus: status,
        source: input.source ?? "web",
        phone: lead.phone ?? undefined,
        payload: { notes: input.notes, utm: input.utm },
      });
      if (input.wantDepositCheckout && env.PRIMARY_CHECKOUT_URL) {
        await db.insert(leadEvents).values({
          leadId: lead.id,
          type: "checkout_redirect",
          toStatus: status,
          source: input.source ?? "web",
          phone: lead.phone ?? undefined,
          payload: { checkoutUrlSet: true },
        });
      } else if (input.wantDepositCheckout && !env.PRIMARY_CHECKOUT_URL) {
        await db.insert(leadEvents).values({
          leadId: lead.id,
          type: "checkout_missing",
          toStatus: status,
          source: input.source ?? "web",
          phone: lead.phone ?? undefined,
          payload: { checkoutUrlSet: false },
        });
      }
    }

    if (!isTest) {
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
    }

    return {
      id: lead!.id,
      status: lead!.status,
      checkoutUrl: env.PRIMARY_CHECKOUT_URL,
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
    const emptyStages = {
      new: 0,
      contacted: 0,
      qualified: 0,
      reserved: 0,
      paid: 0,
      lost: 0,
    };
    const integrityNote =
      "prospectFunnel excludes operator +12368370221 and leads.is_test=true. internalOps is reported separately and must not be summed into funnel stats.";
    if (!env.DATABASE_URL) {
      return {
        day,
        goalCents,
        progress: 0,
        prospectFunnel: {
          uniquePhonesMessagedToday: 0,
          inboundMessagesToday: 0,
          leadsCreatedToday: 0,
          funnelStages: emptyStages,
          aiCallsToday: 0,
          aiCostUsdToday: 0,
          depositsCount: 0,
          depositsCents: 0,
        },
        internalOps: {
          uniquePhonesMessagedToday: 0,
          inboundMessagesToday: 0,
          operatorPhones: ["+12368370221"],
          aiCallsToday: 0,
          aiCostUsdToday: 0,
          surfaces: [],
        },
        leadsCreated: 0,
        leadsCreatedToday: 0,
        depositsCount: 0,
        depositsCents: 0,
        inboundMessagesToday: 0,
        uniquePhonesMessagedToday: 0,
        imessageInbound: 0,
        funnelStages: emptyStages,
        integrityNote,
      };
    }
    const db = createDb(env.DATABASE_URL);
    const split = await computeSplitMetricsToday(db, day, goalCents);
    return {
      day: split.day,
      goalCents: split.goalCents,
      progress: split.progress,
      prospectFunnel: split.prospectFunnel,
      internalOps: split.internalOps,
      leadsCreated: split.prospectFunnel.leadsCreatedToday,
      leadsCreatedToday: split.prospectFunnel.leadsCreatedToday,
      depositsCount: split.prospectFunnel.depositsCount,
      depositsCents: split.prospectFunnel.depositsCents,
      inboundMessagesToday: split.prospectFunnel.inboundMessagesToday,
      uniquePhonesMessagedToday: split.prospectFunnel.uniquePhonesMessagedToday,
      imessageInbound: split.legacyDailyCounters.imessageInbound,
      funnelStages: split.prospectFunnel.funnelStages,
      integrityNote,
    };
  }),

  askRag: os.askRag.handler(async ({ input }) => {
    const env = getServerEnv();
    const chunks = await loadKnowledgeDir(knowledgeRoot());
    return answerWithRag({
      query: input.query,
      chunks,
      modelId: env.CHAT_AGENT_MODEL_ID,
      hasLlm: Boolean(env.OPENROUTER_API_KEY),
      openRouterApiKey: env.OPENROUTER_API_KEY,
    });
  }),

  cursorStatus: os.cursorStatus.handler(async () => {
    const env = getServerEnv();
    if (!env.CURSOR_API_KEY) {
      return { agentId: null, agentUrl: null, latestRun: null };
    }
    const { getSoftDefaultAgentId } = await import("@altered/chat");
    const ctx = createOperatorContext({ env, knowledgeRoot: knowledgeRoot() });
    const agentId =
      (await getSoftDefaultAgentId(ctx)) ?? env.CURSOR_OPERATING_AGENT_ID;
    if (!agentId) {
      return { agentId: null, agentUrl: null, latestRun: null };
    }
    const cursor = createCursorClient(env.CURSOR_API_KEY);
    const agent = await cursor.getAgent(agentId);
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
    const { getSoftDefaultAgentId } = await import("@altered/chat");
    const ctx = createOperatorContext({ env, knowledgeRoot: knowledgeRoot() });
    const reply = await handleOperatorMessage({
      ctx,
      chatThreadId: `api:${input.notifyPhone ?? "system"}`,
      phone: input.notifyPhone ?? "+10000000000",
      text: input.prompt,
    });
    const runMatch = reply.match(/run[=:]?\s*([a-z0-9-]+)/i);
    const jobMatch = reply.match(/job[=:]?\s*([a-z0-9-]+)/i);
    const soft = await getSoftDefaultAgentId(ctx);
    return {
      jobId: jobMatch?.[1] ?? "unknown",
      agentId:
        input.agentId ?? soft ?? env.CURSOR_OPERATING_AGENT_ID ?? "unknown",
      runId: runMatch?.[1] && runMatch[1] !== "n/a" ? runMatch[1] : null,
      status: /busy/i.test(reply) ? "busy_retry" : "running",
    };
  }),
});

export type AppRouter = typeof router;
