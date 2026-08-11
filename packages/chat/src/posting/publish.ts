import { and, asc, eq, inArray } from "drizzle-orm";
import { postEvents, postIdeas } from "@altered/db";
import type { OperatorContext } from "../operator-context";
import {
  platformsForEnv,
  postingEnabled,
  zernioConfigured,
  zernioCreatePost,
} from "./zernio";

export async function publishApprovedPosts(
  ctx: OperatorContext,
  opts: { limit?: number; source?: string; ideaIds?: string[] } = {},
): Promise<{
  ok: boolean;
  published: number;
  failed: number;
  skipped?: string;
  results: Array<{
    id: string;
    ok: boolean;
    zernioPostId?: string;
    error?: string;
  }>;
}> {
  if (!postingEnabled(ctx.env)) {
    return {
      ok: false,
      published: 0,
      failed: 0,
      skipped: "POSTING_ENABLED=false",
      results: [],
    };
  }
  if (!ctx.db) {
    return {
      ok: false,
      published: 0,
      failed: 0,
      skipped: "no db",
      results: [],
    };
  }

  const source = opts.source ?? "cron";
  const limit = opts.limit ?? 10;

  if (!zernioConfigured(ctx.env)) {
    const pending = await ctx.db.query.postIdeas.findMany({
      where: eq(postIdeas.status, "approved"),
      limit: 5,
    });
    if (pending.length) {
      await ctx.db.insert(postEvents).values({
        type: "publish_blocked",
        source,
        payload: {
          reason: "ZERNIO_API_KEY or ZERNIO_TWITTER_ACCOUNT_ID missing",
          approvedWaiting: pending.length,
        },
      });
    }
    return {
      ok: false,
      published: 0,
      failed: 0,
      skipped: "zernio_not_configured",
      results: [],
    };
  }

  const platforms = platformsForEnv(ctx.env);
  const ideas = opts.ideaIds?.length
    ? await ctx.db.query.postIdeas.findMany({
        where: and(
          inArray(postIdeas.id, opts.ideaIds),
          inArray(postIdeas.status, ["approved", "failed"]),
        ),
      })
    : await ctx.db.query.postIdeas.findMany({
        where: eq(postIdeas.status, "approved"),
        orderBy: [asc(postIdeas.approvedAt), asc(postIdeas.createdAt)],
        limit,
      });

  const results: Array<{
    id: string;
    ok: boolean;
    zernioPostId?: string;
    error?: string;
  }> = [];
  let published = 0;
  let failed = 0;

  for (const idea of ideas) {
    const now = new Date();
    await ctx.db
      .update(postIdeas)
      .set({ status: "publishing", updatedAt: now })
      .where(eq(postIdeas.id, idea.id));

    const platformAccounts =
      idea.platform === "linkedin"
        ? platforms.filter((p) => p.platform === "linkedin")
        : platforms.filter((p) => p.platform === "twitter");
    const targets = platformAccounts.length
      ? platformAccounts
      : platforms.slice(0, 1);

    if (!targets.length) {
      failed += 1;
      await ctx.db
        .update(postIdeas)
        .set({
          status: "failed",
          error: `No Zernio account for platform ${idea.platform}`,
          updatedAt: new Date(),
        })
        .where(eq(postIdeas.id, idea.id));
      await ctx.db.insert(postEvents).values({
        postIdeaId: idea.id,
        batchId: idea.batchId,
        type: "publish_failed",
        source,
        payload: { error: "no platform account" },
      });
      results.push({
        id: idea.id,
        ok: false,
        error: "no platform account",
      });
      continue;
    }

    const useQueue =
      Boolean(ctx.env.ZERNIO_PROFILE_ID) &&
      ctx.env.POSTING_ENABLED?.trim().toLowerCase() !== "publish-now" &&
      process.env.POSTING_USE_ZERNIO_QUEUE?.trim().toLowerCase() === "true";
    const result = await zernioCreatePost(ctx.env, {
      content: idea.content,
      platforms: targets,
      ...(useQueue
        ? { queuedFromProfile: ctx.env.ZERNIO_PROFILE_ID }
        : { publishNow: true }),
      requestId: idea.id,
    });

    if (result.ok) {
      published += 1;
      await ctx.db
        .update(postIdeas)
        .set({
          status: "published",
          zernioPostId: result.postId,
          zernioPlatformUrl: result.platformPostUrl,
          scheduledFor: result.scheduledFor
            ? new Date(result.scheduledFor)
            : null,
          publishedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(postIdeas.id, idea.id));
      await ctx.db.insert(postEvents).values({
        postIdeaId: idea.id,
        batchId: idea.batchId,
        type: "published",
        source,
        payload: {
          zernioPostId: result.postId,
          status: result.status,
          platformPostUrl: result.platformPostUrl,
          scheduledFor: result.scheduledFor,
          queued: useQueue,
        },
      });
      results.push({ id: idea.id, ok: true, zernioPostId: result.postId });
    } else {
      failed += 1;
      await ctx.db
        .update(postIdeas)
        .set({
          status: "failed",
          error: result.error ?? "zernio publish failed",
          updatedAt: new Date(),
        })
        .where(eq(postIdeas.id, idea.id));
      await ctx.db.insert(postEvents).values({
        postIdeaId: idea.id,
        batchId: idea.batchId,
        type: "publish_failed",
        source,
        payload: { error: result.error, raw: result.raw },
      });
      results.push({ id: idea.id, ok: false, error: result.error });
    }
  }

  return { ok: failed === 0, published, failed, results };
}
