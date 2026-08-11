import { and, asc, eq, inArray } from "drizzle-orm";
import { postBatches, postEvents, postIdeas } from "@altered/db";
import type { OperatorContext } from "../operator-context";
import { signApprovalToken, verifyApprovalToken } from "./zernio";

export type ApprovalAction =
  | { kind: "approve_all" }
  | { kind: "reject_all" }
  | { kind: "approve_indexes"; indexes: number[] }
  | { kind: "reject_indexes"; indexes: number[] };

/**
 * Parse one-tap iMessage approval replies.
 * Examples: APPROVE ALL | REJECT ALL | APPROVE 1 3 5 | YES | A | REJECT 2
 */
export function parseApprovalReply(text: string): ApprovalAction | null {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw) return null;
  const upper = raw.toUpperCase();

  if (
    /^(APPROVE\s+ALL|APPROVEALL|YES\s+ALL|YALL|AA|A\s*ALL)$/.test(upper) ||
    upper === "YES" ||
    upper === "Y" ||
    upper === "A"
  ) {
    return { kind: "approve_all" };
  }
  if (
    /^(REJECT\s+ALL|REJECTALL|NO\s+ALL|NA|RR|R\s*ALL)$/.test(upper) ||
    upper === "NO" ||
    upper === "N" ||
    upper === "R"
  ) {
    return { kind: "reject_all" };
  }

  const approveNums = upper.match(/^APPROVE(?:\s+|:)([\d\s,]+)$/);
  if (approveNums?.[1]) {
    const indexes = parseIndexes(approveNums[1]);
    if (indexes.length) return { kind: "approve_indexes", indexes };
  }
  const rejectNums = upper.match(/^REJECT(?:\s+|:)([\d\s,]+)$/);
  if (rejectNums?.[1]) {
    const indexes = parseIndexes(rejectNums[1]);
    if (indexes.length) return { kind: "reject_indexes", indexes };
  }
  return null;
}

function parseIndexes(chunk: string): number[] {
  return [
    ...new Set(
      chunk
        .split(/[\s,]+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
}

export function buildApprovalLinks(
  ctx: OperatorContext,
  batchId: string,
): { approveAll: string; rejectAll: string } {
  const base = (ctx.env.APP_BASE_URL ?? "https://generated.api.usealtered.com").replace(
    /\/$/,
    "",
  );
  const approvePayload = `batch:${batchId}:approve_all`;
  const rejectPayload = `batch:${batchId}:reject_all`;
  const approveToken = signApprovalToken(ctx.env, approvePayload);
  const rejectToken = signApprovalToken(ctx.env, rejectPayload);
  return {
    approveAll: `${base}/ops/posts/approve?batch=${batchId}&action=approve_all&token=${approveToken}`,
    rejectAll: `${base}/ops/posts/approve?batch=${batchId}&action=reject_all&token=${rejectToken}`,
  };
}

export function verifyBatchActionToken(
  ctx: OperatorContext,
  batchId: string,
  action: string,
  token: string,
): boolean {
  return verifyApprovalToken(ctx.env, `batch:${batchId}:${action}`, token);
}

export async function listPendingBatchIdeas(
  ctx: OperatorContext,
  batchId: string,
) {
  if (!ctx.db) return [];
  return ctx.db.query.postIdeas.findMany({
    where: and(
      eq(postIdeas.batchId, batchId),
      eq(postIdeas.status, "pending_approval"),
    ),
    orderBy: [asc(postIdeas.batchIndex)],
  });
}

export async function getLatestPendingBatch(ctx: OperatorContext) {
  if (!ctx.db) return null;
  const batch = await ctx.db.query.postBatches.findFirst({
    where: eq(postBatches.status, "pending"),
    orderBy: (b, { desc }) => [desc(b.createdAt)],
  });
  return batch ?? null;
}

export async function applyBatchApproval(
  ctx: OperatorContext,
  input: {
    batchId: string;
    action: ApprovalAction;
    source: string;
  },
): Promise<{
  ok: boolean;
  approved: number;
  rejected: number;
  error?: string;
}> {
  if (!ctx.db) return { ok: false, approved: 0, rejected: 0, error: "no db" };

  const batch = await ctx.db.query.postBatches.findFirst({
    where: eq(postBatches.id, input.batchId),
  });
  if (!batch) {
    return { ok: false, approved: 0, rejected: 0, error: "batch not found" };
  }

  const ideas = await ctx.db.query.postIdeas.findMany({
    where: and(
      eq(postIdeas.batchId, input.batchId),
      inArray(postIdeas.status, ["pending_approval", "draft"]),
    ),
  });
  if (!ideas.length) {
    return { ok: false, approved: 0, rejected: 0, error: "no pending ideas" };
  }

  const now = new Date();
  let approveIds: string[] = [];
  let rejectIds: string[] = [];

  if (input.action.kind === "approve_all") {
    approveIds = ideas.map((i) => i.id);
  } else if (input.action.kind === "reject_all") {
    rejectIds = ideas.map((i) => i.id);
  } else if (input.action.kind === "approve_indexes") {
    const set = new Set(input.action.indexes);
    for (const idea of ideas) {
      if (idea.batchIndex != null && set.has(idea.batchIndex)) {
        approveIds.push(idea.id);
      } else {
        rejectIds.push(idea.id);
      }
    }
  } else if (input.action.kind === "reject_indexes") {
    const set = new Set(input.action.indexes);
    for (const idea of ideas) {
      if (idea.batchIndex != null && set.has(idea.batchIndex)) {
        rejectIds.push(idea.id);
      }
      // leave non-matching still pending
    }
  }

  if (approveIds.length) {
    await ctx.db
      .update(postIdeas)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
      })
      .where(inArray(postIdeas.id, approveIds));
    for (const id of approveIds) {
      await ctx.db.insert(postEvents).values({
        postIdeaId: id,
        batchId: input.batchId,
        type: "approved",
        source: input.source,
      });
    }
  }
  if (rejectIds.length) {
    await ctx.db
      .update(postIdeas)
      .set({
        status: "rejected",
        rejectedAt: now,
        updatedAt: now,
      })
      .where(inArray(postIdeas.id, rejectIds));
    for (const id of rejectIds) {
      await ctx.db.insert(postEvents).values({
        postIdeaId: id,
        batchId: input.batchId,
        type: "rejected",
        source: input.source,
      });
    }
  }

  const stillPending = await ctx.db.query.postIdeas.findFirst({
    where: and(
      eq(postIdeas.batchId, input.batchId),
      eq(postIdeas.status, "pending_approval"),
    ),
  });

  await ctx.db
    .update(postBatches)
    .set({
      status: stillPending ? "partial" : "decided",
      decidedAt: stillPending ? batch.decidedAt : now,
      updatedAt: now,
      meta: {
        ...(typeof batch.meta === "object" && batch.meta
          ? (batch.meta as Record<string, unknown>)
          : {}),
        lastAction: input.action,
        source: input.source,
      },
    })
    .where(eq(postBatches.id, input.batchId));

  await ctx.db.insert(postEvents).values({
    batchId: input.batchId,
    type: "batch_decision",
    source: input.source,
    payload: {
      action: input.action,
      approved: approveIds.length,
      rejected: rejectIds.length,
    },
  });

  return {
    ok: true,
    approved: approveIds.length,
    rejected: rejectIds.length,
  };
}

/**
 * If Riley's message is an approval command for the latest pending batch,
 * apply it and return a short confirmation. Otherwise return null.
 */
export async function tryHandleApprovalMessage(
  ctx: OperatorContext,
  text: string,
): Promise<string | null> {
  const action = parseApprovalReply(text);
  if (!action) return null;
  const batch = await getLatestPendingBatch(ctx);
  if (!batch) {
    return "No pending post batch to approve. Next cron will generate one.";
  }
  const result = await applyBatchApproval(ctx, {
    batchId: batch.id,
    action,
    source: "imessage",
  });
  if (!result.ok) {
    return `Could not apply approval: ${result.error ?? "unknown"}`;
  }
  if (result.approved && !result.rejected) {
    return `Approved ${result.approved} post(s). Publish cron will send via Zernio.`;
  }
  if (result.rejected && !result.approved) {
    return `Rejected ${result.rejected} post(s).`;
  }
  return `Approved ${result.approved}, rejected ${result.rejected}. Approved ones publish on the next cron tick.`;
}
