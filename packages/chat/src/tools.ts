import { tool } from "ai";
import { eq, desc, or, and, sql } from "drizzle-orm";
import {
  CursorApiError,
  formatRunStatus,
  truncateForImessage,
} from "@altered/cursor-bridge";
import {
  cursorJobs,
  dailyMetrics,
  leads,
  memories,
  settings,
  threads,
} from "@altered/db";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { z } from "zod";
import type { OperatorContext } from "./operator-context";
import { depositLabel, resolveDepositAmountCents } from "./offer";

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function bumpMetric(
  ctx: OperatorContext,
  field: "leadsCreated" | "depositsCount" | "imessageInbound" | "cursorRuns",
  amount = 1,
) {
  if (!ctx.db) return;
  const day = todayKey();
  await ctx.db
    .insert(dailyMetrics)
    .values({ day, [field]: amount })
    .onConflictDoUpdate({
      target: dailyMetrics.day,
      set: {
        [field]: sql`${dailyMetrics[field]} + ${amount}`,
        updatedAt: new Date(),
      },
    });
}

async function resolveOperatingAgentId(ctx: OperatorContext, phone: string) {
  if (ctx.db) {
    const row = await ctx.db.query.settings.findFirst({
      where: eq(settings.key, "operating_agent_id"),
    });
    if (row?.value) return row.value;
  }
  const fromRedis = await ctx.redis?.get<string>("settings:operating_agent_id");
  if (fromRedis) return fromRedis;
  const threadBind = await ctx.redis?.get<string>(`thread:${phone}:agentId`);
  if (threadBind) return threadBind;
  return ctx.env.CURSOR_OPERATING_AGENT_ID;
}

async function scheduleRunPoll(
  ctx: OperatorContext,
  input: {
    jobId: string;
    agentId: string;
    runId: string;
    notifyPhone?: string;
  },
) {
  if (!ctx.qstash || !ctx.env.APP_BASE_URL) return;
  await ctx.qstash.publishJSON({
    url: `${ctx.env.APP_BASE_URL}/webhooks/qstash/cursor-poll`,
    body: input,
    delay: 20,
    retries: 8,
  });
}

let knowledgeCache: Awaited<ReturnType<typeof loadKnowledgeDir>> | null = null;
let knowledgeLoadedAt = 0;

async function getChunks(root: string) {
  const now = Date.now();
  if (!knowledgeCache || now - knowledgeLoadedAt > 60_000) {
    knowledgeCache = await loadKnowledgeDir(root);
    knowledgeLoadedAt = now;
  }
  return knowledgeCache;
}

export type SessionRefs = {
  phone: string;
  threadDbId?: string;
};

export function createOperatorTools(ctx: OperatorContext, session: SessionRefs) {
  return {
    get_cursor_status: tool({
      description:
        "Get status of the operating Cursor cloud agent (latest run, PR links).",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };
        const agentId = await resolveOperatingAgentId(ctx, session.phone);
        if (!agentId) return { error: "No operating agent linked" };
        const agent = await ctx.cursor.getAgent(agentId);
        if (!agent.latestRunId) {
          return {
            agentId: agent.id,
            name: agent.name,
            status: agent.status,
            url: agent.url,
            latestRun: null,
          };
        }
        const run = await ctx.cursor.getRun(agentId, agent.latestRunId);
        return {
          agentId: agent.id,
          name: agent.name,
          url: agent.url,
          latestRun: {
            id: run.id,
            status: run.status,
            summary: formatRunStatus(run),
          },
        };
      },
    }),

    search_knowledge: tool({
      description:
        "Search repo knowledge (offers, ops playbooks, product notes) and answer from it.",
      inputSchema: z.object({
        query: z.string().describe("What to look up in knowledge/"),
      }),
      execute: async ({ query }) => {
        const chunks = await getChunks(ctx.knowledgeRoot);
        const result = await answerWithRag({
          query,
          chunks,
          modelId: ctx.env.CHAT_AGENT_MODEL_ID,
          hasLlm: Boolean(ctx.env.OPENROUTER_API_KEY),
          openRouterApiKey: ctx.env.OPENROUTER_API_KEY,
        });
        return result;
      },
    }),

    prompt_cursor: tool({
      description:
        "Send a follow-up task to the operating Cursor cloud agent (resumes the durable agent thread). Use for build/ship/ops work in the repo.",
      inputSchema: z.object({
        task: z.string().describe("Clear instruction for the Cursor agent"),
        mode: z.enum(["agent", "plan"]).optional().default("agent"),
      }),
      execute: async ({ task, mode }) => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };
        const agentId = await resolveOperatingAgentId(ctx, session.phone);
        if (!agentId) {
          return {
            error:
              "No operating agent. Set CURSOR_OPERATING_AGENT_ID or call set_operating_agent.",
          };
        }
        const enriched = [
          "[via iMessage operator bridge — AI tools]",
          `From: ${session.phone}`,
          "Goal: early-access reservation deposits ($99–$249 band) for ALTERED.",
          "Prefer shipping revenue/lead surfaces; persist decisions into knowledge/ and memories.",
          "",
          task,
        ].join("\n");

        try {
          const { run } = await ctx.cursor.createRun(
            agentId,
            enriched,
            mode === "plan" ? "plan" : "agent",
          );
          let jobId = "ephemeral";
          if (ctx.db) {
            const [job] = await ctx.db
              .insert(cursorJobs)
              .values({
                threadId: session.threadDbId,
                agentId,
                runId: run.id,
                prompt: enriched,
                status: "running",
                notifyPhone: session.phone,
                meta: { mode },
              })
              .returning();
            jobId = job?.id ?? jobId;
            if (job) {
              await scheduleRunPoll(ctx, {
                jobId: job.id,
                agentId,
                runId: run.id,
                notifyPhone: session.phone,
              });
            }
          }
          await bumpMetric(ctx, "cursorRuns");
          await ctx.redis?.set(`thread:${session.phone}:agentId`, agentId);
          return {
            ok: true,
            agentId,
            runId: run.id,
            jobId,
            note: "I'll text when the run finishes.",
          };
        } catch (err) {
          if (err instanceof CursorApiError && err.isBusy) {
            if (ctx.db) {
              const [job] = await ctx.db
                .insert(cursorJobs)
                .values({
                  threadId: session.threadDbId,
                  agentId,
                  prompt: enriched,
                  status: "busy_retry",
                  notifyPhone: session.phone,
                  meta: { mode },
                })
                .returning();
              if (job && ctx.qstash && ctx.env.APP_BASE_URL) {
                await ctx.qstash.publishJSON({
                  url: `${ctx.env.APP_BASE_URL}/webhooks/qstash/cursor-retry`,
                  body: { jobId: job.id },
                  delay: 45,
                  retries: 6,
                });
              }
              return {
                ok: true,
                busy: true,
                agentId,
                jobId: job?.id,
                note: "Agent busy — queued retry.",
              };
            }
            return { error: "Agent busy; retry shortly.", agentId };
          }
          throw err;
        }
      },
    }),

    spawn_cursor_agent: tool({
      description:
        "Create a NEW Cursor cloud agent on this repo. Prefer prompt_cursor unless a separate workstream is needed.",
      inputSchema: z.object({
        task: z.string(),
        name: z.string().optional(),
        bindAsOperating: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, make this the new default operating agent"),
      }),
      execute: async ({ task, name, bindAsOperating }) => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };
        const created = await ctx.cursor.createAgent({
          prompt: [
            "[via iMessage operator bridge]",
            "Repo: altered-generated — ALTERED early-access deposit engine.",
            "",
            task,
          ].join("\n"),
          repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
          startingRef: ctx.env.CURSOR_DEFAULT_REF,
          name: name ?? `iMessage: ${task.slice(0, 60)}`,
          autoCreatePR: true,
        });

        await ctx.redis?.set(
          `thread:${session.phone}:agentId`,
          created.agent.id,
        );
        if (ctx.db && session.threadDbId) {
          await ctx.db
            .update(threads)
            .set({ cursorAgentId: created.agent.id, updatedAt: new Date() })
            .where(eq(threads.id, session.threadDbId));
        }
        if (bindAsOperating) {
          await persistSetting(ctx, "operating_agent_id", created.agent.id);
        }
        if (ctx.db) {
          const [job] = await ctx.db
            .insert(cursorJobs)
            .values({
              threadId: session.threadDbId,
              agentId: created.agent.id,
              runId: created.run.id,
              prompt: task,
              status: "running",
              notifyPhone: session.phone,
            })
            .returning();
          if (job) {
            await scheduleRunPoll(ctx, {
              jobId: job.id,
              agentId: created.agent.id,
              runId: created.run.id,
              notifyPhone: session.phone,
            });
          }
        }
        await bumpMetric(ctx, "cursorRuns");
        return {
          ok: true,
          agentId: created.agent.id,
          url: created.agent.url,
          runId: created.run.id,
          boundAsOperating: bindAsOperating,
        };
      },
    }),

    set_operating_agent: tool({
      description:
        "Bind a durable Cursor agent id (bc-...) as the default operating agent for future prompts. Persists in DB + Redis.",
      inputSchema: z.object({
        agentId: z.string().regex(/^bc-[a-z0-9-]+$/i),
      }),
      execute: async ({ agentId }) => {
        await persistSetting(ctx, "operating_agent_id", agentId);
        await ctx.redis?.set(`thread:${session.phone}:agentId`, agentId);
        if (ctx.db && session.threadDbId) {
          await ctx.db
            .update(threads)
            .set({ cursorAgentId: agentId, updatedAt: new Date() })
            .where(eq(threads.id, session.threadDbId));
        }
        return { ok: true, agentId };
      },
    }),

    save_lead: tool({
      description: "Capture a sales lead (email and/or phone required).",
      inputSchema: z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
        name: z.string().optional(),
        company: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        if (!ctx.db) return { error: "DATABASE_URL missing" };
        if (!input.email && !input.phone) {
          return { error: "Need email or phone" };
        }
        const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
        const [lead] = await ctx.db
          .insert(leads)
          .values({
            email: input.email,
            phone: input.phone,
            name: input.name,
            company: input.company,
            notes: input.notes,
            source: "imessage",
            status: "new",
            depositAmountCents: amountCents,
            depositCurrency: ctx.env.EARLY_ACCESS_DEPOSIT_CURRENCY,
          })
          .returning();
        await bumpMetric(ctx, "leadsCreated");
        return {
          ok: true,
          leadId: lead?.id,
          checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL,
        };
      },
    }),

    get_metrics: tool({
      description: "Today's leads/deposit progress toward the daily cash goal.",
      inputSchema: z.object({}),
      execute: async () => {
        const day = todayKey();
        const goalCents = 25000;
        const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
        const amountLabel = depositLabel(amountCents);
        if (!ctx.db) {
          return {
            day,
            offline: true,
            depositAmount: amountLabel,
            goalCents,
          };
        }
        const row = await ctx.db.query.dailyMetrics.findFirst({
          where: eq(dailyMetrics.day, day),
        });
        const cents = row?.depositsCents ?? 0;
        return {
          day,
          leadsCreated: row?.leadsCreated ?? 0,
          depositsCount: row?.depositsCount ?? 0,
          depositsCents: cents,
          progressPct: Math.min(100, Math.round((cents / goalCents) * 100)),
          goalCents,
          depositAmount: amountLabel,
          imessageInbound: row?.imessageInbound ?? 0,
          cursorRuns: row?.cursorRuns ?? 0,
          checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL ?? null,
        };
      },
    }),

    get_checkout_link: tool({
      description:
        "Return the early-access deposit checkout URL (PRIMARY_CHECKOUT_URL).",
      inputSchema: z.object({}),
      execute: async () => {
        const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
        if (!ctx.env.PRIMARY_CHECKOUT_URL) {
          return {
            error:
              "PRIMARY_CHECKOUT_URL not set yet. Add a Stripe Payment Link when ready.",
            amountCents,
          };
        }
        return {
          url: ctx.env.PRIMARY_CHECKOUT_URL,
          amountCents,
        };
      },
    }),

    save_memory: tool({
      description:
        "Persist durable memory that survives Cursor compaction and agent switches. Use for decisions, preferences, offer terms, open loops.",
      inputSchema: z.object({
        content: z.string().min(1),
        key: z
          .string()
          .optional()
          .describe("Optional stable key to upsert, e.g. offer.deposit"),
        scope: z
          .enum(["global", "operator", "agent", "thread"])
          .optional()
          .default("global"),
      }),
      execute: async ({ content, key, scope }) => {
        const scopeId =
          scope === "operator"
            ? session.phone
            : scope === "thread"
              ? session.threadDbId
              : scope === "agent"
                ? await resolveOperatingAgentId(ctx, session.phone)
                : null;

        if (ctx.db) {
          if (key) {
            const existing = await ctx.db.query.memories.findFirst({
              where: and(
                eq(memories.key, key),
                eq(memories.scope, scope ?? "global"),
              ),
            });
            if (existing) {
              await ctx.db
                .update(memories)
                .set({
                  content,
                  scopeId: scopeId ?? undefined,
                  updatedAt: new Date(),
                })
                .where(eq(memories.id, existing.id));
              await mirrorMemoryRedis(ctx, key, content);
              return { ok: true, id: existing.id, upserted: true };
            }
          }
          const [row] = await ctx.db
            .insert(memories)
            .values({
              content,
              key,
              scope: scope ?? "global",
              scopeId: scopeId ?? undefined,
            })
            .returning();
          if (key) await mirrorMemoryRedis(ctx, key, content);
          return { ok: true, id: row?.id, upserted: false };
        }

        if (ctx.redis) {
          const id = `mem_${Date.now()}`;
          await ctx.redis.lpush(
            "memories:global",
            JSON.stringify({ id, key, content, at: Date.now() }),
          );
          await ctx.redis.ltrim("memories:global", 0, 199);
          if (key) await mirrorMemoryRedis(ctx, key, content);
          return { ok: true, id, redisOnly: true };
        }
        return { error: "No DB or Redis to store memory" };
      },
    }),

    recall_memories: tool({
      description: "Recall recent durable memories relevant to a query.",
      inputSchema: z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional().default(8),
      }),
      execute: async ({ query, limit }) => {
        if (ctx.db) {
          const rows = await ctx.db
            .select()
            .from(memories)
            .orderBy(desc(memories.updatedAt))
            .limit(40);
          const q = (query ?? "").toLowerCase();
          const filtered = q
            ? rows.filter(
                (r) =>
                  r.content.toLowerCase().includes(q) ||
                  (r.key ?? "").toLowerCase().includes(q),
              )
            : rows;
          return {
            items: filtered.slice(0, limit).map((r) => ({
              id: r.id,
              key: r.key,
              scope: r.scope,
              content: r.content,
              updatedAt: r.updatedAt.toISOString(),
            })),
          };
        }
        if (ctx.redis) {
          const raw = (await ctx.redis.lrange("memories:global", 0, 39)) ?? [];
          const items = raw
            .map((item) => {
              try {
                return typeof item === "string" ? JSON.parse(item) : item;
              } catch {
                return { content: String(item) };
              }
            })
            .slice(0, limit);
          return { items, redisOnly: true };
        }
        return { items: [] };
      },
    }),
  };
}

async function persistSetting(ctx: OperatorContext, key: string, value: string) {
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

async function mirrorMemoryRedis(
  ctx: OperatorContext,
  key: string,
  content: string,
) {
  await ctx.redis?.set(`memory:key:${key}`, content);
}

export async function loadMemoryPreamble(
  ctx: OperatorContext,
  phone: string,
): Promise<string> {
  const parts: string[] = [];
  const agentId = await resolveOperatingAgentId(ctx, phone);
  if (agentId) parts.push(`Operating Cursor agent: ${agentId}`);

  if (ctx.db) {
    const rows = await ctx.db
      .select()
      .from(memories)
      .where(
        or(
          eq(memories.scope, "global"),
          and(eq(memories.scope, "operator"), eq(memories.scopeId, phone)),
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(12);
    for (const r of rows) {
      parts.push(
        `- [${r.key ?? r.scope}] ${truncateForImessage(r.content, 280)}`,
      );
    }
  } else if (ctx.redis) {
    const raw = (await ctx.redis.lrange("memories:global", 0, 11)) ?? [];
    for (const item of raw) {
      try {
        const parsed =
          typeof item === "string" ? JSON.parse(item) : (item as { content?: string; key?: string });
        parts.push(
          `- [${parsed.key ?? "memory"}] ${truncateForImessage(String(parsed.content ?? item), 280)}`,
        );
      } catch {
        parts.push(`- ${truncateForImessage(String(item), 280)}`);
      }
    }
  }

  return parts.length
    ? `Durable memory:\n${parts.join("\n")}`
    : "Durable memory: (empty)";
}

export { resolveOperatingAgentId, bumpMetric };
