import { and, desc, eq } from "drizzle-orm";
import { cursorAgents, settings } from "@altered/db";
import type { OperatorContext } from "./operator-context";

export const ACTIVE_AGENT_SETTING_KEY = "active_agent_id";
/** Legacy key - still read for backward compatibility. */
export const LEGACY_OPERATING_AGENT_SETTING_KEY = "operating_agent_id";

export function slugifyWorkstream(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "general";
}

export async function persistSetting(
  ctx: OperatorContext,
  key: string,
  value: string,
) {
  if (ctx.db) {
    await ctx.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
  await ctx.redis?.set(`settings:${key}`, value);
}

export async function readSetting(
  ctx: OperatorContext,
  key: string,
): Promise<string | undefined> {
  if (ctx.db) {
    const row = await ctx.db.query.settings.findFirst({
      where: eq(settings.key, key),
    });
    if (row?.value) return row.value;
  }
  const fromRedis = await ctx.redis?.get<string>(`settings:${key}`);
  return fromRedis ?? undefined;
}

/** Soft default agent (last pinned / last used). Not a hard singleton. */
export async function getSoftDefaultAgentId(
  ctx: OperatorContext,
): Promise<string | undefined> {
  return (
    (await readSetting(ctx, ACTIVE_AGENT_SETTING_KEY)) ??
    (await readSetting(ctx, LEGACY_OPERATING_AGENT_SETTING_KEY)) ??
    ctx.env.CURSOR_OPERATING_AGENT_ID
  );
}

export async function setSoftDefaultAgentId(
  ctx: OperatorContext,
  agentId: string,
) {
  await persistSetting(ctx, ACTIVE_AGENT_SETTING_KEY, agentId);
  // Keep legacy key in sync for older readers
  await persistSetting(ctx, LEGACY_OPERATING_AGENT_SETTING_KEY, agentId);
}

export async function findActiveAgentForWorkstream(
  ctx: OperatorContext,
  workstream: string,
) {
  if (!ctx.db) return null;
  const rows = await ctx.db
    .select()
    .from(cursorAgents)
    .where(
      and(
        eq(cursorAgents.workstream, workstream),
        eq(cursorAgents.status, "active"),
      ),
    )
    .orderBy(desc(cursorAgents.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function registerCursorAgent(
  ctx: OperatorContext,
  input: {
    agentId: string;
    name?: string;
    workstream: string;
    url?: string;
    lastRunId?: string;
    meta?: Record<string, unknown>;
  },
) {
  if (!ctx.db) return null;
  const existing = await ctx.db.query.cursorAgents.findFirst({
    where: eq(cursorAgents.agentId, input.agentId),
  });
  if (existing) {
    const [row] = await ctx.db
      .update(cursorAgents)
      .set({
        name: input.name ?? existing.name,
        workstream: input.workstream,
        status: "active",
        url: input.url ?? existing.url,
        lastRunId: input.lastRunId ?? existing.lastRunId,
        meta: input.meta ?? existing.meta,
        updatedAt: new Date(),
      })
      .where(eq(cursorAgents.id, existing.id))
      .returning();
    return row ?? existing;
  }
  const [row] = await ctx.db
    .insert(cursorAgents)
    .values({
      agentId: input.agentId,
      name: input.name,
      workstream: input.workstream,
      url: input.url,
      lastRunId: input.lastRunId,
      meta: input.meta,
      status: "active",
    })
    .returning();
  return row ?? null;
}

export async function touchCursorAgentRun(
  ctx: OperatorContext,
  agentId: string,
  runId?: string,
) {
  if (!ctx.db) return;
  await ctx.db
    .update(cursorAgents)
    .set({
      lastRunId: runId,
      updatedAt: new Date(),
      status: "active",
    })
    .where(eq(cursorAgents.agentId, agentId));
}

/**
 * Resolve which Cloud Agent chat to resume.
 * Precedence: explicit agentId → workstream active agent → soft default → env bootstrap.
 * Does not auto-spawn; caller decides when to create a new agent.
 */
export async function resolveAgentId(
  ctx: OperatorContext,
  opts: {
    phone: string;
    agentId?: string;
    workstream?: string;
  },
): Promise<{ agentId?: string; source: string; workstream?: string }> {
  if (opts.agentId) {
    return { agentId: opts.agentId, source: "explicit", workstream: opts.workstream };
  }

  if (opts.workstream) {
    const bound = await findActiveAgentForWorkstream(ctx, opts.workstream);
    if (bound?.agentId) {
      return {
        agentId: bound.agentId,
        source: "workstream",
        workstream: opts.workstream,
      };
    }
  }

  const soft = await getSoftDefaultAgentId(ctx);
  if (soft) {
    return {
      agentId: soft,
      source: "soft_default",
      workstream: opts.workstream,
    };
  }

  const threadBind = await ctx.redis?.get<string>(`thread:${opts.phone}:agentId`);
  if (threadBind) {
    return {
      agentId: threadBind,
      source: "thread",
      workstream: opts.workstream,
    };
  }

  return { agentId: undefined, source: "none", workstream: opts.workstream };
}

/** @deprecated Use resolveAgentId - kept for older imports. */
export async function resolveOperatingAgentId(
  ctx: OperatorContext,
  phone: string,
) {
  const resolved = await resolveAgentId(ctx, { phone });
  return resolved.agentId;
}
