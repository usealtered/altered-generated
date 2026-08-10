import { and, desc, eq, inArray } from "drizzle-orm";
import { devTasks } from "@altered/db";
import type { OperatorContext } from "./operator-context";

export type DevTaskStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

export async function listDevTasks(
  ctx: OperatorContext,
  opts: {
    status?: DevTaskStatus | "active";
    workstream?: string;
    limit?: number;
  } = {},
) {
  if (!ctx.db) return [];
  const limit = opts.limit ?? 20;
  const rows = await ctx.db
    .select()
    .from(devTasks)
    .orderBy(desc(devTasks.updatedAt))
    .limit(80);

  return rows
    .filter((r) => {
      if (opts.workstream && r.workstream !== opts.workstream) return false;
      if (opts.status === "active") {
        return r.status === "open" || r.status === "in_progress" || r.status === "blocked";
      }
      if (opts.status && r.status !== opts.status) return false;
      return true;
    })
    .slice(0, limit);
}

export async function upsertDevTask(
  ctx: OperatorContext,
  input: {
    id?: string;
    title: string;
    description?: string;
    status?: DevTaskStatus;
    workstream: string;
    agentId?: string;
    priority?: number;
    notes?: string;
    source?: string;
    meta?: Record<string, unknown>;
  },
) {
  if (!ctx.db) return null;
  const status = input.status ?? "open";
  const completedAt =
    status === "done" || status === "cancelled" ? new Date() : null;

  if (input.id) {
    const [row] = await ctx.db
      .update(devTasks)
      .set({
        title: input.title,
        description: input.description,
        status,
        workstream: input.workstream,
        agentId: input.agentId,
        priority: input.priority ?? 0,
        notes: input.notes,
        source: input.source ?? "imessage",
        meta: input.meta,
        updatedAt: new Date(),
        completedAt: completedAt ?? undefined,
      })
      .where(eq(devTasks.id, input.id))
      .returning();
    return row ?? null;
  }

  // Upsert by title+workstream when open/in_progress already exists
  const existing = await ctx.db.query.devTasks.findFirst({
    where: and(
      eq(devTasks.title, input.title),
      eq(devTasks.workstream, input.workstream),
      inArray(devTasks.status, ["open", "in_progress", "blocked"]),
    ),
  });
  if (existing) {
    const [row] = await ctx.db
      .update(devTasks)
      .set({
        description: input.description ?? existing.description,
        status,
        agentId: input.agentId ?? existing.agentId,
        priority: input.priority ?? existing.priority,
        notes: input.notes ?? existing.notes,
        meta: input.meta ?? existing.meta,
        updatedAt: new Date(),
        completedAt: completedAt ?? undefined,
      })
      .where(eq(devTasks.id, existing.id))
      .returning();
    return row ?? existing;
  }

  const [row] = await ctx.db
    .insert(devTasks)
    .values({
      title: input.title,
      description: input.description,
      status,
      workstream: input.workstream,
      agentId: input.agentId,
      priority: input.priority ?? 0,
      notes: input.notes,
      source: input.source ?? "imessage",
      meta: input.meta,
      completedAt: completedAt ?? undefined,
    })
    .returning();
  return row ?? null;
}

export async function bindTaskAgent(
  ctx: OperatorContext,
  taskId: string,
  agentId: string,
) {
  if (!ctx.db) return;
  await ctx.db
    .update(devTasks)
    .set({
      agentId,
      status: "in_progress",
      updatedAt: new Date(),
    })
    .where(eq(devTasks.id, taskId));
}
