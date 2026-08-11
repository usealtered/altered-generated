import { eq } from "drizzle-orm";
import { settings } from "@altered/db";
import type { OperatorContext } from "../operator-context";

const GENERATE_SCHEDULE_KEY = "posting.qstash.generate_schedule_id";
const PUBLISH_SCHEDULE_KEY = "posting.qstash.publish_schedule_id";

/** Stable QStash schedule ids (upsert-friendly). */
export const GENERATE_SCHEDULE_ID = "altered-posts-generate";
export const PUBLISH_SCHEDULE_ID = "altered-posts-publish";

/** Mon/Wed/Fri 14:00 UTC (~10am ET) idea generation */
export const GENERATE_CRON = "0 14 * * 1,3,5";
/** Every 15 minutes publish approved posts */
export const PUBLISH_CRON = "*/15 * * * *";

async function getSetting(ctx: OperatorContext, key: string) {
  if (!ctx.db) return null;
  const row = await ctx.db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return row?.value ?? null;
}

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

/**
 * Ensure QStash recurring schedules for generate + publish.
 * Idempotent via fixed scheduleId + settings keys.
 */
export async function ensurePostingSchedules(ctx: OperatorContext): Promise<{
  ok: boolean;
  generateScheduleId?: string | null;
  publishScheduleId?: string | null;
  skipped?: string;
  error?: string;
}> {
  if (!ctx.qstash || !ctx.env.APP_BASE_URL) {
    return { ok: false, skipped: "qstash_or_app_base_url_missing" };
  }
  const base = ctx.env.APP_BASE_URL.replace(/\/$/, "");

  try {
    const generate = await ctx.qstash.schedules.create({
      scheduleId: GENERATE_SCHEDULE_ID,
      destination: `${base}/webhooks/qstash/posts/generate`,
      cron: GENERATE_CRON,
      body: JSON.stringify({ source: "qstash-schedule" }),
      headers: { "content-type": "application/json" },
    });
    const generateScheduleId = generate.scheduleId;
    await setSetting(ctx, GENERATE_SCHEDULE_KEY, generateScheduleId);

    const publish = await ctx.qstash.schedules.create({
      scheduleId: PUBLISH_SCHEDULE_ID,
      destination: `${base}/webhooks/qstash/posts/publish`,
      cron: PUBLISH_CRON,
      body: JSON.stringify({ source: "qstash-schedule" }),
      headers: { "content-type": "application/json" },
    });
    const publishScheduleId = publish.scheduleId;
    await setSetting(ctx, PUBLISH_SCHEDULE_KEY, publishScheduleId);

    // Keep existing keys if create somehow returned empty
    return {
      ok: true,
      generateScheduleId:
        generateScheduleId || (await getSetting(ctx, GENERATE_SCHEDULE_KEY)),
      publishScheduleId:
        publishScheduleId || (await getSetting(ctx, PUBLISH_SCHEDULE_KEY)),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Immediately enqueue a one-shot generate. */
export async function enqueueGenerate(
  ctx: OperatorContext,
  delaySeconds = 0,
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.qstash || !ctx.env.APP_BASE_URL) {
    return { ok: false, error: "qstash_or_app_base_url_missing" };
  }
  try {
    await ctx.qstash.publishJSON({
      url: `${ctx.env.APP_BASE_URL.replace(/\/$/, "")}/webhooks/qstash/posts/generate`,
      body: { source: "manual" },
      delay: delaySeconds || undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function enqueuePublish(
  ctx: OperatorContext,
  delaySeconds = 5,
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.qstash || !ctx.env.APP_BASE_URL) {
    return { ok: false, error: "qstash_or_app_base_url_missing" };
  }
  try {
    await ctx.qstash.publishJSON({
      url: `${ctx.env.APP_BASE_URL.replace(/\/$/, "")}/webhooks/qstash/posts/publish`,
      body: { source: "post-approval" },
      delay: delaySeconds || undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
