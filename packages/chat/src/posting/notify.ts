import { eq } from "drizzle-orm";
import { postBatches, postEvents, postIdeas } from "@altered/db";
import { normalizePhone, parseAllowlist } from "@altered/env";
import { asc } from "drizzle-orm";
import type { OperatorContext } from "../operator-context";
import { sendImessageReplyDirect } from "../sendblue-send";
import { buildApprovalLinks } from "./approve";

function operatorNotifyPhone(ctx: OperatorContext): string | null {
  const allowlist = parseAllowlist(ctx.env.OPERATOR_PHONE_ALLOWLIST);
  if (allowlist[0]) return normalizePhone(allowlist[0]);
  return "+12368370221";
}

function preview(text: string, max = 140): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}-`;
}

/**
 * Text Riley a batch summary with one-tap APPROVE ALL / magic link.
 * Keep friction minimal: numbered list + APPROVE ALL / REJECT ALL.
 */
export async function notifyOperatorOfBatch(
  ctx: OperatorContext,
  batchId: string,
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  if (!ctx.db) return { ok: false, error: "no db" };
  const from = ctx.env.SENDBLUE_FROM_NUMBER;
  if (!from || !ctx.env.SENDBLUE_API_KEY) {
    return { ok: false, skipped: "sendblue_not_configured" };
  }
  const to = operatorNotifyPhone(ctx);
  if (!to) return { ok: false, error: "no operator phone" };

  const ideas = await ctx.db.query.postIdeas.findMany({
    where: eq(postIdeas.batchId, batchId),
    orderBy: [asc(postIdeas.batchIndex)],
  });
  if (!ideas.length) return { ok: false, error: "empty batch" };

  const links = buildApprovalLinks(ctx, batchId);
  const lines = [
    `${ideas.length} post ideas ready for one-tap approval.`,
    "",
    "Reply APPROVE ALL or REJECT ALL",
    "Or APPROVE 1 3 5 / REJECT 2",
    "",
    ...ideas.map((idea) => {
      const idx = idea.batchIndex ?? "?";
      const hook = idea.hook ?? idea.content;
      return `${idx}. [${idea.platform}] ${preview(hook, 120)}`;
    }),
    "",
    `Approve all: ${links.approveAll}`,
    `Reject all: ${links.rejectAll}`,
  ];

  // Split into bubbles under 1400 chars
  const bubbles: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 1200) {
      if (current) bubbles.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) bubbles.push(current);

  for (const bubble of bubbles) {
    const res = await sendImessageReplyDirect({
      contactNumber: to,
      fromNumber: from,
      text: bubble,
    });
    if (!res.ok) {
      await ctx.db.insert(postEvents).values({
        batchId,
        type: "notify_failed",
        source: "imessage",
        payload: { error: res.error },
      });
      return { ok: false, error: res.error };
    }
  }

  await ctx.db
    .update(postBatches)
    .set({ notifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(postBatches.id, batchId));
  await ctx.db.insert(postEvents).values({
    batchId,
    type: "notified",
    source: "imessage",
    payload: { to, ideaCount: ideas.length },
  });
  return { ok: true };
}
