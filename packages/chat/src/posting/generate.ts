import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  postBatches,
  postEvents,
  postIdeas,
} from "@altered/db";
import type { OperatorContext } from "../operator-context";
import { createOpenRouter, chatAgentModelId } from "../model";
import { recordAiEvent } from "../observability";
import { postingEnabled } from "./zernio";

const ideaSchema = z.object({
  ideas: z
    .array(
      z.object({
        platform: z.enum(["twitter", "linkedin"]).default("twitter"),
        hook: z.string().min(8).max(280),
        body: z.string().min(40).max(900),
        cta: z.string().min(8).max(200),
      }),
    )
    .min(3)
    .max(7),
});

const FALLBACK_IDEAS: z.infer<typeof ideaSchema>["ideas"] = [
  {
    platform: "twitter",
    hook: "You do not have a notes problem. You have a pressure-pivot problem.",
    body: "Most founders do not fail from lack of ideas. They fail because pressure makes them pivot off the goal they already chose.\n\nALTERED is an always-on iMessage layer that remembers your decisions and keeps you locked on the goal until it ships.",
    cta: "Text +13054098546 - founding cohort. $100 reservation deposit credits toward $499.",
  },
  {
    platform: "twitter",
    hook: "Your best thinking dies in old chats. That is why you rebuild the same product.",
    body: "You settled the WHY. Then a busy week hit and you re-litigated it from zero. That loop is expensive.\n\nALTERED resurfaces your own best thinking when you start to drift.",
    cta: "Text +13054098546 to reserve a founding seat ($100 deposit).",
  },
  {
    platform: "twitter",
    hook: "Never lose your best thinking again.",
    body: "No fake testimonials. No theater.\n\nFounding cohort for detail-obsessed technical founders who want their thinking to compound instead of evaporate.",
    cta: "$100 reservation deposit. Credits to the $499 program. Text +13054098546.",
  },
  {
    platform: "twitter",
    hook: "Stop asking AI what to do. Make it remember what you already decided.",
    body: "Detail-obsessed founders do not need another AI chat. They need memory that fights back when priorities shift under pressure.",
    cta: "Reserve: text +13054098546 or open the founding page.",
  },
  {
    platform: "linkedin",
    hook: "Shipping fails when priorities shift under pressure.",
    body: "ALTERED is built for technical founders who already know what to build - and keep losing the thread when the week gets loud.\n\nAlways-on iMessage agent. Durable memory of your decisions. Goal lock until ship.",
    cta: "Founding cohort open. $100 reservation deposit toward $499. Text +13054098546.",
  },
];

function landingBase(ctx: OperatorContext): string {
  const site = (
    ctx.env.SITE_BASE_URL ?? "https://generated.usealtered.com"
  ).replace(/\/$/, "");
  return `${site}/early-access`;
}

export function buildLandingUrl(
  ctx: OperatorContext,
  opts: { ideaId?: string; platform: string; batchId?: string },
): string {
  const base = landingBase(ctx);
  const params = new URLSearchParams({
    utm_source: opts.platform === "linkedin" ? "linkedin" : "x",
    utm_medium: "social",
    utm_campaign: "founding_cohort",
  });
  if (opts.ideaId) params.set("utm_content", opts.ideaId.slice(0, 8));
  if (opts.batchId) params.set("utm_term", opts.batchId.slice(0, 8));
  return `${base}?${params.toString()}`;
}

export function composePostContent(input: {
  hook: string;
  body: string;
  cta: string;
  landingUrl: string;
}): string {
  const parts = [
    input.hook.trim(),
    "",
    input.body.trim(),
    "",
    input.cta.trim(),
    input.landingUrl,
  ];
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function generatePostIdeas(
  ctx: OperatorContext,
  opts: { count?: number; source?: string } = {},
): Promise<{
  ok: boolean;
  batchId?: string;
  ideaIds?: string[];
  skipped?: string;
  error?: string;
}> {
  if (!postingEnabled(ctx.env)) {
    return { ok: false, skipped: "POSTING_ENABLED=false" };
  }
  if (!ctx.db) return { ok: false, error: "DATABASE_URL missing" };

  const count = Math.min(Math.max(opts.count ?? 5, 3), 7);
  const source = opts.source ?? "cron";
  const started = Date.now();
  let ideas = FALLBACK_IDEAS.slice(0, count);
  let modelUsed = "fallback-templates";

  if (ctx.env.OPENROUTER_API_KEY) {
    try {
      const openrouter = createOpenRouter(ctx.env);
      const modelId = chatAgentModelId(ctx.env);
      modelUsed = modelId;
      const result = await generateObject({
        model: openrouter.chat(modelId),
        schema: ideaSchema,
        temperature: 0.7,
        prompt: `Generate ${count} sharp social post ideas for ALTERED founding cohort.

PRODUCT:
- ALTERED: always-on iMessage agent for detail-obsessed technical founders
- Tagline: Never lose your best thinking again
- Kills pressure pivots and redundant thinking
- $100 reservation deposit credits toward $499 program (net $399)
- Never say pre-sale, presale, or pre-sell
- CTA must drive to text +13054098546 and/or the founding reservation page

RULES:
- Pain-led hooks. Hormozi-direct. No fluff. No em dashes.
- Plain text. No markdown.
- Mix mostly twitter (short) with at most one linkedin
- Each idea: hook, body, cta (cta should mention texting +13054098546 or founding deposit)
- Vary angles: pressure pivots, redundant thinking, memory, goal lock, founding honesty`,
      });
      ideas = result.object.ideas.slice(0, count);
      await recordAiEvent(ctx, {
        surface: "posting_generate",
        model: modelId,
        latencyMs: Date.now() - started,
        ok: true,
        meta: { count: ideas.length, source },
      });
    } catch (err) {
      await recordAiEvent(ctx, {
        surface: "posting_generate",
        model: modelUsed,
        latencyMs: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        meta: { source, fallback: true },
      });
      // keep FALLBACK_IDEAS
    }
  }

  const [batch] = await ctx.db
    .insert(postBatches)
    .values({
      status: "pending",
      channelHint: "twitter",
      ideaCount: ideas.length,
      meta: { source, model: modelUsed },
    })
    .returning();
  if (!batch) return { ok: false, error: "failed to create batch" };

  const ideaIds: string[] = [];
  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i]!;
    const tempLanding = buildLandingUrl(ctx, {
      platform: idea.platform,
      batchId: batch.id,
    });
    const content = composePostContent({
      hook: idea.hook,
      body: idea.body,
      cta: idea.cta,
      landingUrl: tempLanding,
    });
    const [row] = await ctx.db
      .insert(postIdeas)
      .values({
        batchId: batch.id,
        batchIndex: i + 1,
        status: "pending_approval",
        platform: idea.platform,
        hook: idea.hook,
        body: idea.body,
        cta: idea.cta,
        content,
        landingUrl: tempLanding,
        utm: {
          utm_source: idea.platform === "linkedin" ? "linkedin" : "x",
          utm_medium: "social",
          utm_campaign: "founding_cohort",
        },
        meta: { source, model: modelUsed },
      })
      .returning();
    if (!row) continue;
    ideaIds.push(row.id);

    // Rewrite landing with idea id for attribution
    const landingUrl = buildLandingUrl(ctx, {
      ideaId: row.id,
      platform: idea.platform,
      batchId: batch.id,
    });
    const finalContent = composePostContent({
      hook: idea.hook,
      body: idea.body,
      cta: idea.cta,
      landingUrl,
    });
    await ctx.db
      .update(postIdeas)
      .set({
        landingUrl,
        content: finalContent,
        utm: {
          utm_source: idea.platform === "linkedin" ? "linkedin" : "x",
          utm_medium: "social",
          utm_campaign: "founding_cohort",
          utm_content: row.id.slice(0, 8),
        },
        updatedAt: new Date(),
      })
      .where(eq(postIdeas.id, row.id));

    await ctx.db.insert(postEvents).values({
      postIdeaId: row.id,
      batchId: batch.id,
      type: "generated",
      source,
      payload: { platform: idea.platform, batchIndex: i + 1 },
    });
  }

  await ctx.db.insert(postEvents).values({
    batchId: batch.id,
    type: "batch_generated",
    source,
    payload: { ideaCount: ideaIds.length, model: modelUsed },
  });

  return { ok: true, batchId: batch.id, ideaIds };
}
