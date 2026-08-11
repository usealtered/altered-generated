import { and, eq, sql } from "drizzle-orm";
import {
  aiEvents,
  dailyMetrics,
  leads,
  messages,
  operators,
  threads,
  type Database,
} from "@altered/db";

/** Hardcoded seed — also inserted into `operators` by migration 0005. */
export const KNOWN_OPERATOR_PHONES = ["+12368370221"] as const;

export type FunnelStages = {
  new: number;
  contacted: number;
  qualified: number;
  reserved: number;
  paid: number;
  lost: number;
};

export type ProspectFunnelMetrics = {
  uniquePhonesMessagedToday: number;
  inboundMessagesToday: number;
  leadsCreatedToday: number;
  /** All-time real (non-test) leads by stage — not contaminated by audit rows. */
  funnelStages: FunnelStages;
  aiCallsToday: number;
  aiCostUsdToday: number;
  depositsCount: number;
  depositsCents: number;
};

export type InternalOpsMetrics = {
  uniquePhonesMessagedToday: number;
  inboundMessagesToday: number;
  operatorPhones: string[];
  aiCallsToday: number;
  aiCostUsdToday: number;
  surfaces: string[];
};

export type SplitMetricsToday = {
  day: string;
  /** Real prospect / lead funnel — never includes operator/ops chat. */
  prospectFunnel: ProspectFunnelMetrics;
  /** Riley ops copilot + other internal activity — labeled separately. */
  internalOps: InternalOpsMetrics;
  goalCents: number;
  progress: number;
  /**
   * @deprecated Contaminated counter from daily_metrics — do not use for funnel.
   * Prefer prospectFunnel / internalOps.
   */
  legacyDailyCounters: {
    imessageInbound: number;
    leadsCreated: number;
    aiCalls: number;
    aiCostUsd: number;
  };
};

function emptyStages(): FunnelStages {
  return {
    new: 0,
    contacted: 0,
    qualified: 0,
    reserved: 0,
    paid: 0,
    lost: 0,
  };
}

function dayStartUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Surfaces that belong to the ops / operator copilot path. */
function isOpsSurface(surface: string): boolean {
  return (
    surface.startsWith("ops_") ||
    surface === "posting_generate" ||
    surface === "posting_publish"
  );
}

/**
 * Compute today's metrics split into prospect funnel vs internal ops.
 * Source of truth: messages.is_internal + threads.kind + leads.is_test + ai_events.surface.
 * Never sum the two buckets by default.
 */
export async function computeSplitMetricsToday(
  db: Database,
  day = new Date().toISOString().slice(0, 10),
  goalCents = 25_000,
): Promise<SplitMetricsToday> {
  const start = dayStartUtc(day);

  const operatorRows = await db
    .select({ phone: operators.phone })
    .from(operators)
    .where(eq(operators.active, true));
  const operatorPhones = [
    ...new Set([
      ...KNOWN_OPERATOR_PHONES,
      ...operatorRows.map((r) => r.phone),
    ]),
  ].sort();

  const [prospectInbound] = await db
    .select({
      inboundMessages: sql<number>`count(*)::int`,
      uniquePhones: sql<number>`count(distinct ${threads.phone})::int`,
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      and(
        eq(messages.direction, "inbound"),
        eq(messages.isInternal, false),
        eq(threads.kind, "prospect"),
        sql`${messages.createdAt} >= ${start}`,
      ),
    );

  const [opsInbound] = await db
    .select({
      inboundMessages: sql<number>`count(*)::int`,
      uniquePhones: sql<number>`count(distinct ${threads.phone})::int`,
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      and(
        eq(messages.direction, "inbound"),
        eq(messages.isInternal, true),
        sql`${messages.createdAt} >= ${start}`,
      ),
    );

  const stageRows = await db
    .select({
      status: leads.status,
      n: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(eq(leads.isTest, false))
    .groupBy(leads.status);
  const funnelStages = emptyStages();
  for (const r of stageRows) {
    if (r.status in funnelStages) {
      funnelStages[r.status as keyof FunnelStages] = r.n;
    }
  }

  const [leadsTodayRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(eq(leads.isTest, false), sql`${leads.createdAt} >= ${start}`),
    );

  const aiRows = await db
    .select({
      surface: aiEvents.surface,
      calls: sql<number>`count(*)::int`,
      costMicros: sql<number>`coalesce(sum(${aiEvents.costMicros}), 0)::int`,
    })
    .from(aiEvents)
    .where(sql`${aiEvents.createdAt} >= ${start}`)
    .groupBy(aiEvents.surface);

  let prospectAiCalls = 0;
  let prospectAiCost = 0;
  let opsAiCalls = 0;
  let opsAiCost = 0;
  const opsSurfaces = new Set<string>();
  for (const row of aiRows) {
    if (isOpsSurface(row.surface) || row.surface.startsWith("ops_")) {
      opsAiCalls += row.calls;
      opsAiCost += row.costMicros;
      opsSurfaces.add(row.surface);
    } else if (
      row.surface.startsWith("sales_") ||
      row.surface === "sales_imessage"
    ) {
      prospectAiCalls += row.calls;
      prospectAiCost += row.costMicros;
    } else {
      // Unknown surfaces: attribute by whether phone is operator when present —
      // conservative: leave out of prospect funnel (count under ops "other").
      opsAiCalls += row.calls;
      opsAiCost += row.costMicros;
      opsSurfaces.add(row.surface);
    }
  }

  const row = await db.query.dailyMetrics.findFirst({
    where: eq(dailyMetrics.day, day),
  });
  const depositsCents = row?.depositsCents ?? 0;

  return {
    day,
    prospectFunnel: {
      uniquePhonesMessagedToday: prospectInbound?.uniquePhones ?? 0,
      inboundMessagesToday: prospectInbound?.inboundMessages ?? 0,
      leadsCreatedToday: leadsTodayRow?.n ?? 0,
      funnelStages,
      aiCallsToday: prospectAiCalls,
      aiCostUsdToday: Number((prospectAiCost / 1_000_000).toFixed(6)),
      depositsCount: row?.depositsCount ?? 0,
      depositsCents,
    },
    internalOps: {
      uniquePhonesMessagedToday: opsInbound?.uniquePhones ?? 0,
      inboundMessagesToday: opsInbound?.inboundMessages ?? 0,
      operatorPhones,
      aiCallsToday: opsAiCalls,
      aiCostUsdToday: Number((opsAiCost / 1_000_000).toFixed(6)),
      surfaces: [...opsSurfaces].sort(),
    },
    goalCents,
    progress: Math.min(1, depositsCents / goalCents),
    legacyDailyCounters: {
      imessageInbound: row?.imessageInbound ?? 0,
      leadsCreated: row?.leadsCreated ?? 0,
      aiCalls: row?.aiCalls ?? 0,
      aiCostUsd: Number(((row?.aiCostMicros ?? 0) / 1_000_000).toFixed(6)),
    },
  };
}

/** Ensure a phone is treated as operator for thread writes. */
export async function ensureOperatorRecord(
  db: Database,
  phone: string,
  name = "operator",
) {
  await db
    .insert(operators)
    .values({ phone, name, active: true })
    .onConflictDoUpdate({
      target: operators.phone,
      set: { active: true },
    });
}

/**
 * True if phone is a known/active operator (DB + hardcoded seed).
 * Does NOT use empty-allowlist-means-everyone (env helper).
 */
export async function isInternalOperatorPhone(
  db: Database | null | undefined,
  phone: string,
): Promise<boolean> {
  if ((KNOWN_OPERATOR_PHONES as readonly string[]).includes(phone)) {
    return true;
  }
  if (!db) return false;
  const row = await db.query.operators.findFirst({
    where: and(eq(operators.phone, phone), eq(operators.active, true)),
  });
  return Boolean(row);
}

/** Re-tag any messages still missing is_internal for operator threads (idempotent). */
export async function repairInternalFlags(db: Database) {
  await db.execute(sql`
    UPDATE messages m
    SET is_internal = true
    FROM threads t
    WHERE m.thread_id = t.id
      AND t.kind = 'operator'
      AND m.is_internal = false
  `);
  await db.execute(sql`
    UPDATE threads
    SET kind = 'operator'
    WHERE phone IN (SELECT phone FROM operators WHERE active = true)
      AND kind <> 'operator'
  `);
}
