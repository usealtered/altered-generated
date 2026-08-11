import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  analyticsSnapshots,
  conversationReviews,
  leadGenDrafts,
  leads,
  messages,
  postIdeas,
  threads,
} from "@altered/db";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { OperatorContext } from "./operator-context";
import { createOpenRouter, chatAgentModelId } from "./model";
import { computeSplitMetricsToday } from "./metrics";
import { recordAiEvent } from "./observability";

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Persist today's split metrics for the dashboard time series. */
export async function runDailyAnalyticsSnapshot(
  ctx: OperatorContext,
  opts: { source?: string } = {},
) {
  if (!ctx.db) return { ok: false as const, error: "no db" };
  const day = todayKey();
  const split = await computeSplitMetricsToday(ctx.db, day);

  // Unique prospect phones messaged over last 14 days (by day)
  const dayStart14 = new Date(Date.now() - 14 * 86400000);
  const flow = await ctx.db
    .select({
      day: sql<string>`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      uniquePhones: sql<number>`count(distinct ${threads.phone})::int`,
      inbound: sql<number>`count(*)::int`,
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      and(
        eq(messages.direction, "inbound"),
        eq(messages.isInternal, false),
        eq(threads.kind, "prospect"),
        gte(messages.createdAt, dayStart14),
      ),
    )
    .groupBy(sql`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`)
    .orderBy(sql`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`);

  const payload = {
    ...split,
    prospectLeadFlowByDay: flow,
    source: opts.source ?? "daily-cron",
    capturedAt: new Date().toISOString(),
  };

  const existing = await ctx.db.query.analyticsSnapshots.findFirst({
    where: and(
      eq(analyticsSnapshots.day, day),
      eq(analyticsSnapshots.kind, "daily"),
    ),
  });
  if (existing) {
    await ctx.db
      .update(analyticsSnapshots)
      .set({ payload })
      .where(eq(analyticsSnapshots.id, existing.id));
  } else {
    await ctx.db
      .insert(analyticsSnapshots)
      .values({ day, kind: "daily", payload });
  }

  return { ok: true as const, day, payload };
}

/** Review recent prospect (and optionally ops) threads for tone / missed sales. */
export async function runHourlyConversationReview(
  ctx: OperatorContext,
  opts: { source?: string; hours?: number } = {},
) {
  if (!ctx.db) return { ok: false as const, error: "no db" };
  const hours = opts.hours ?? 6;
  const since = new Date(Date.now() - hours * 3600000);

  const recentThreads = await ctx.db
    .select({
      id: threads.id,
      phone: threads.phone,
      kind: threads.kind,
    })
    .from(threads)
    .where(eq(threads.kind, "prospect"))
    .orderBy(desc(threads.updatedAt))
    .limit(12);

  const reviews: Array<{ phone: string; findings: string; severity: string }> =
    [];

  if (!recentThreads.length) {
    await ctx.db.insert(conversationReviews).values({
      kind: "hourly_tone",
      severity: "info",
      findings:
        "No prospect threads to review. Funnel is quiet — lead-gen sweep should stay proactive.",
      missedOpportunity: true,
      meta: { source: opts.source ?? "hourly-cron", hours },
    });
    return { ok: true as const, reviewed: 0, inserted: 1, reviews };
  }

  for (const thread of recentThreads.slice(0, 5)) {
    const msgs = await ctx.db.query.messages.findMany({
      where: and(
        eq(messages.threadId, thread.id),
        gte(messages.createdAt, since),
      ),
      orderBy: [asc(messages.createdAt)],
      limit: 20,
    });
    if (!msgs.length) continue;

    const transcript = msgs
      .map((m: { direction: string; body: string }) => `${m.direction}: ${m.body.slice(0, 400)}`)
      .join("\n");

    let findings =
      "Heuristic review: check for early price blurting and weak qualify.";
    let severity = "info";
    let missed = false;

    const earlyPrice =
      /\$\s*100|\$\s*499|deposit/i.test(transcript) &&
      msgs.filter((m: { direction: string }) => m.direction === "inbound").length <= 2;
    if (earlyPrice) {
      findings =
        "Possible early price mention before enough qualify turns. Reinforce qualify-first.";
      severity = "warn";
      missed = true;
    }

    if (ctx.env.OPENROUTER_API_KEY) {
      try {
        const openrouter = createOpenRouter(ctx.env);
        const modelId = chatAgentModelId(ctx.env);
        const started = Date.now();
        const result = await generateText({
          model: openrouter.chat(modelId),
          temperature: 0.2,
          prompt: `You review ALTERED Koa iMessage sales transcripts.
Rules: price ($100/$499) only AFTER qualify. Plain text. No fluff.
Return 1-3 short sentences: tone issues, missed sales opportunities, or "looks solid".
Transcript:\n${transcript}`,
        });
        findings = result.text.trim().slice(0, 1200) || findings;
        await recordAiEvent(ctx, {
          surface: "ops_conversation_review",
          phone: thread.phone,
          model: modelId,
          latencyMs: Date.now() - started,
          ok: true,
          meta: { threadId: thread.id },
        });
      } catch (err) {
        findings = `${findings} (llm review failed: ${
          err instanceof Error ? err.message : String(err)
        })`;
      }
    }

    if (/missed|should have|weak|early price/i.test(findings)) {
      missed = true;
      if (severity === "info") severity = "warn";
    }

    await ctx.db.insert(conversationReviews).values({
      threadId: thread.id,
      phone: thread.phone,
      kind: "hourly_tone",
      severity,
      findings,
      missedOpportunity: missed,
      meta: { source: opts.source ?? "hourly-cron", hours },
    });
    reviews.push({ phone: thread.phone, findings, severity });
  }

  return { ok: true as const, reviewed: reviews.length, inserted: reviews.length, reviews };
}

/** Draft proactive outbound post / DM ideas (not waiting on inbound). */
export async function runLeadGenSweep(
  ctx: OperatorContext,
  opts: { source?: string; count?: number } = {},
) {
  if (!ctx.db) return { ok: false as const, error: "no db" };
  const count = Math.min(Math.max(opts.count ?? 4, 2), 8);

  const fallback = [
    {
      channel: "x_post",
      hook: "Pressure pivots are silent. Your best decision dies in an old chat.",
      body: "ALTERED keeps your own thinking alive on iMessage so you ship the thing you already chose.",
      cta: "Text +13054098546",
    },
    {
      channel: "x_post",
      hook: "Notes apps store words. They do not fight you when priorities shift.",
      body: "Detail-obsessed founders need memory that interrupts drift - not another blank chat box.",
      cta: "Text +13054098546",
    },
    {
      channel: "dm_draft",
      hook: "Quick note for founders who keep re-deriving the same call.",
      body: "Built ALTERED for that loop. Always-on iMessage agent. Happy to show the mechanism if useful.",
      cta: "Reply or text +13054098546",
    },
    {
      channel: "x_post",
      hook: "Founding cohort is open. No landing-page price theater.",
      body: "Promise + proof in public. Offer details only after we qualify fit in Messages.",
      cta: "Text Koa +13054098546",
    },
  ].slice(0, count);

  let drafts = fallback;
  if (ctx.env.OPENROUTER_API_KEY) {
    try {
      const openrouter = createOpenRouter(ctx.env);
      const modelId = chatAgentModelId(ctx.env);
      const started = Date.now();
      const result = await generateObject({
        model: openrouter.chat(modelId),
        schema: z.object({
          drafts: z
            .array(
              z.object({
                channel: z.enum(["x_post", "linkedin_post", "dm_draft"]),
                hook: z.string().min(8).max(280),
                body: z.string().min(40).max(900),
                cta: z.string().min(4).max(200),
              }),
            )
            .min(2)
            .max(8),
        }),
        prompt: `Draft ${count} proactive ALTERED lead-gen posts/DMs for detail-obsessed technical founders.
No fake testimonials. Do not put $100/$499 in public posts - CTA is text +13054098546 only.
Plain direct Hormozi tone. No em dashes.`,
      });
      drafts = result.object.drafts.slice(0, count);
      await recordAiEvent(ctx, {
        surface: "ops_lead_gen_sweep",
        model: modelId,
        latencyMs: Date.now() - started,
        ok: true,
        meta: { count: drafts.length },
      });
    } catch {
      /* keep fallback */
    }
  }

  const inserted = [];
  for (const d of drafts) {
    const [row] = await ctx.db
      .insert(leadGenDrafts)
      .values({
        channel: d.channel,
        hook: d.hook,
        body: d.body,
        cta: d.cta,
        status: "draft",
        meta: { source: opts.source ?? "lead-gen-cron" },
      })
      .returning();
    if (row) inserted.push(row);
  }

  return { ok: true as const, count: inserted.length, drafts: inserted };
}

/** Bundle for gated ops dashboard. */
export async function buildOpsDashboard(ctx: OperatorContext) {
  if (!ctx.db) return { ok: false as const, error: "no db" };
  const day = todayKey();
  const metrics = await computeSplitMetricsToday(ctx.db, day);

  const dayStart14 = new Date(Date.now() - 14 * 86400000);
  const leadFlow = await ctx.db
    .select({
      day: sql<string>`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      uniquePhones: sql<number>`count(distinct ${threads.phone})::int`,
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      and(
        eq(messages.direction, "inbound"),
        eq(messages.isInternal, false),
        eq(threads.kind, "prospect"),
        gte(messages.createdAt, dayStart14),
      ),
    )
    .groupBy(sql`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`)
    .orderBy(sql`to_char((${messages.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`);

  const stages = metrics.prospectFunnel.funnelStages;
  const realLeads = Object.values(stages).reduce(
    (a: number, b: number) => a + b,
    0,
  );
  const costPerLead =
    realLeads > 0
      ? Number(
          (
            metrics.prospectFunnel.aiCostUsdToday / Math.max(realLeads, 1)
          ).toFixed(6),
        )
      : null;

  const queue = await ctx.db.query.postIdeas.findMany({
    where: inArray(postIdeas.status, [
      "pending_approval",
      "approved",
      "draft",
      "failed",
    ]),
    orderBy: [desc(postIdeas.createdAt)],
    limit: 40,
  });

  const reviews = await ctx.db.query.conversationReviews.findMany({
    orderBy: [desc(conversationReviews.createdAt)],
    limit: 20,
  });

  const drafts = await ctx.db.query.leadGenDrafts.findMany({
    orderBy: [desc(leadGenDrafts.createdAt)],
    limit: 20,
  });

  const snapshots = await ctx.db.query.analyticsSnapshots.findMany({
    orderBy: [desc(analyticsSnapshots.createdAt)],
    limit: 14,
  });

  const [leadCountRow] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.isTest, false));

  return {
    ok: true as const,
    day,
    prospectFunnel: metrics.prospectFunnel,
    internalOps: metrics.internalOps,
    leadFlowByDay: leadFlow,
    costPerLeadUsd: costPerLead,
    totalAiCostUsdToday:
      metrics.prospectFunnel.aiCostUsdToday + metrics.internalOps.aiCostUsdToday,
    prospectAiCostUsdToday: metrics.prospectFunnel.aiCostUsdToday,
    realLeadsTotal: leadCountRow?.n ?? realLeads,
    postingQueue: queue.map((q) => ({
      id: q.id,
      status: q.status,
      platform: q.platform,
      hook: q.hook,
      content: q.content,
      batchId: q.batchId,
      batchIndex: q.batchIndex,
      error: q.error,
      zernioPlatformUrl: q.zernioPlatformUrl,
      createdAt: q.createdAt,
    })),
    recentReviews: reviews,
    leadGenDrafts: drafts,
    snapshots: snapshots.map((s) => ({
      id: s.id,
      day: s.day,
      kind: s.kind,
      createdAt: s.createdAt,
      payload: s.payload,
    })),
    integrityNote: metrics.legacyDailyCounters
      ? "prospectFunnel and internalOps are never summed for funnel decisions."
      : undefined,
  };
}
