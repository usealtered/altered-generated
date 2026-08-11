import { eq } from "drizzle-orm";
import { postEvents, postIdeas } from "@altered/db";
import type { OperatorContext } from "../operator-context";
import { enqueuePublish } from "./schedule";

export type IdeaModAction = "approve" | "reject" | "request_modification";

export async function applyIdeaAction(
  ctx: OperatorContext,
  input: {
    ideaId: string;
    action: IdeaModAction;
    note?: string;
    source?: string;
  },
): Promise<{ ok: boolean; status?: string; error?: string }> {
  if (!ctx.db) return { ok: false, error: "no db" };
  const idea = await ctx.db.query.postIdeas.findFirst({
    where: eq(postIdeas.id, input.ideaId),
  });
  if (!idea) return { ok: false, error: "idea not found" };

  const now = new Date();
  const source = input.source ?? "ops-dashboard";

  if (input.action === "approve") {
    await ctx.db
      .update(postIdeas)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
        error: null,
      })
      .where(eq(postIdeas.id, idea.id));
    await ctx.db.insert(postEvents).values({
      postIdeaId: idea.id,
      batchId: idea.batchId,
      type: "approved",
      source,
      payload: { note: input.note },
    });
    await enqueuePublish(ctx, 5);
    return { ok: true, status: "approved" };
  }

  if (input.action === "reject") {
    await ctx.db
      .update(postIdeas)
      .set({
        status: "rejected",
        rejectedAt: now,
        updatedAt: now,
      })
      .where(eq(postIdeas.id, idea.id));
    await ctx.db.insert(postEvents).values({
      postIdeaId: idea.id,
      batchId: idea.batchId,
      type: "rejected",
      source,
      payload: { note: input.note },
    });
    return { ok: true, status: "rejected" };
  }

  // request_modification → back to draft with note
  await ctx.db
    .update(postIdeas)
    .set({
      status: "draft",
      updatedAt: now,
      error: input.note?.slice(0, 500) ?? "modification requested",
    })
    .where(eq(postIdeas.id, idea.id));
  await ctx.db.insert(postEvents).values({
    postIdeaId: idea.id,
    batchId: idea.batchId,
    type: "modification_requested",
    source,
    payload: { note: input.note },
  });
  return { ok: true, status: "draft" };
}
