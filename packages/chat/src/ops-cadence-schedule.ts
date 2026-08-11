import { eq } from "drizzle-orm";
import { settings } from "@altered/db";
import type { OperatorContext } from "./operator-context";

const REVIEW_SCHEDULE_ID = "altered-ops-hourly-review";
const SNAPSHOT_SCHEDULE_ID = "altered-ops-daily-analytics";
const LEADGEN_SCHEDULE_ID = "altered-ops-lead-gen-sweep";

/** Hourly conversation tone / missed-opportunity review */
export const REVIEW_CRON = "0 * * * *";
/** Daily analytics snapshot at 05:00 UTC */
export const SNAPSHOT_CRON = "0 5 * * *";
/** Proactive lead-gen sweep twice daily (12:00 and 20:00 UTC) */
export const LEADGEN_CRON = "0 12,20 * * *";

async function setSetting(ctx: OperatorContext, key: string, value: string) {
  if (!ctx.db) return;
  await ctx.db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function ensureOpsCadenceSchedules(ctx: OperatorContext): Promise<{
  ok: boolean;
  reviewScheduleId?: string;
  snapshotScheduleId?: string;
  leadGenScheduleId?: string;
  skipped?: string;
  error?: string;
}> {
  if (!ctx.qstash || !ctx.env.APP_BASE_URL) {
    return { ok: false, skipped: "qstash_or_app_base_url_missing" };
  }
  const base = ctx.env.APP_BASE_URL.replace(/\/$/, "");
  try {
    const review = await ctx.qstash.schedules.create({
      scheduleId: REVIEW_SCHEDULE_ID,
      destination: `${base}/webhooks/qstash/ops/hourly-review`,
      cron: REVIEW_CRON,
      body: JSON.stringify({ source: "qstash-schedule" }),
      headers: { "content-type": "application/json" },
    });
    await setSetting(ctx, "ops.qstash.review_schedule_id", review.scheduleId);

    const snapshot = await ctx.qstash.schedules.create({
      scheduleId: SNAPSHOT_SCHEDULE_ID,
      destination: `${base}/webhooks/qstash/ops/daily-analytics`,
      cron: SNAPSHOT_CRON,
      body: JSON.stringify({ source: "qstash-schedule" }),
      headers: { "content-type": "application/json" },
    });
    await setSetting(
      ctx,
      "ops.qstash.snapshot_schedule_id",
      snapshot.scheduleId,
    );

    const leadgen = await ctx.qstash.schedules.create({
      scheduleId: LEADGEN_SCHEDULE_ID,
      destination: `${base}/webhooks/qstash/ops/lead-gen-sweep`,
      cron: LEADGEN_CRON,
      body: JSON.stringify({ source: "qstash-schedule" }),
      headers: { "content-type": "application/json" },
    });
    await setSetting(ctx, "ops.qstash.leadgen_schedule_id", leadgen.scheduleId);

    return {
      ok: true,
      reviewScheduleId: review.scheduleId,
      snapshotScheduleId: snapshot.scheduleId,
      leadGenScheduleId: leadgen.scheduleId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
