import { tool } from "ai";
import { desc, eq, or, and } from "drizzle-orm";
import {
  CursorApiError,
  formatRunStatus,
  truncateForImessage,
} from "@altered/cursor-bridge";
import { cursorAgents, cursorJobs, dailyMetrics, leads, memories, threads } from "@altered/db";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { OperatorContext } from "./operator-context";
import { depositLabel, resolveDepositAmountCents } from "./offer";
import {
  findActiveAgentForWorkstream,
  getSoftDefaultAgentId,
  registerCursorAgent,
  resolveAgentId,
  resolveOperatingAgentId,
  setSoftDefaultAgentId,
  slugifyWorkstream,
  touchCursorAgentRun,
} from "./agents";
import { listDevTasks, upsertDevTask } from "./tasks";

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

async function bindThreadAgent(
  ctx: OperatorContext,
  phone: string,
  threadDbId: string | undefined,
  agentId: string,
) {
  await ctx.redis?.set(`thread:${phone}:agentId`, agentId);
  if (ctx.db && threadDbId) {
    await ctx.db
      .update(threads)
      .set({ cursorAgentId: agentId, updatedAt: new Date() })
      .where(eq(threads.id, threadDbId));
  }
}

export function createOperatorTools(ctx: OperatorContext, session: SessionRefs) {
  return {
    get_cursor_status: tool({
      description:
        "Get status of a Cursor cloud agent. Pass agentId, or omit to use the soft-default / workstream agent.",
      inputSchema: z.object({
        agentId: z.string().optional(),
        workstream: z.string().optional(),
      }),
      execute: async ({ agentId, workstream }) => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };
        const resolved = await resolveAgentId(ctx, {
          phone: session.phone,
          agentId,
          workstream: workstream ? slugifyWorkstream(workstream) : undefined,
        });
        if (!resolved.agentId) {
          return {
            error: "No agent linked. Spawn one or pass agentId/workstream.",
            agents: ctx.db
              ? await ctx.db
                  .select()
                  .from(cursorAgents)
                  .where(eq(cursorAgents.status, "active"))
                  .orderBy(desc(cursorAgents.updatedAt))
                  .limit(5)
              : [],
          };
        }
        const agent = await ctx.cursor.getAgent(resolved.agentId);
        if (!agent.latestRunId) {
          return {
            agentId: agent.id,
            name: agent.name,
            status: agent.status,
            url: agent.url,
            source: resolved.source,
            latestRun: null,
          };
        }
        const run = await ctx.cursor.getRun(resolved.agentId, agent.latestRunId);
        return {
          agentId: agent.id,
          name: agent.name,
          url: agent.url,
          source: resolved.source,
          latestRun: {
            id: run.id,
            status: run.status,
            summary: formatRunStatus(run),
          },
        };
      },
    }),

    list_cursor_agents: tool({
      description:
        "List known Cursor cloud agents from the DB registry (dynamic IDs by workstream).",
      inputSchema: z.object({
        includeArchived: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: async ({ includeArchived, limit }) => {
        if (!ctx.db) return { items: [], note: "DATABASE_URL missing" };
        const rows = await ctx.db
          .select()
          .from(cursorAgents)
          .orderBy(desc(cursorAgents.updatedAt))
          .limit(limit);
        const items = rows
          .filter((r) => includeArchived || r.status === "active")
          .map((r) => ({
            agentId: r.agentId,
            name: r.name,
            workstream: r.workstream,
            status: r.status,
            url: r.url,
            lastRunId: r.lastRunId,
            updatedAt: r.updatedAt.toISOString(),
          }));
        const softDefault = await getSoftDefaultAgentId(ctx);
        return { softDefault: softDefault ?? null, items };
      },
    }),

    list_dev_tasks: tool({
      description:
        "List development tasks stored in the DB (survives chat restarts).",
      inputSchema: z.object({
        status: z
          .enum(["open", "in_progress", "blocked", "done", "cancelled", "active"])
          .optional()
          .default("active"),
        workstream: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: async ({ status, workstream, limit }) => {
        const items = await listDevTasks(ctx, {
          status,
          workstream: workstream ? slugifyWorkstream(workstream) : undefined,
          limit,
        });
        return {
          items: items.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            workstream: t.workstream,
            agentId: t.agentId,
            priority: t.priority,
            notes: t.notes,
            updatedAt: t.updatedAt.toISOString(),
          })),
        };
      },
    }),

    upsert_dev_task: tool({
      description:
        "Create or update a development task in the DB. Use for open loops / multi-step workstreams.",
      inputSchema: z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        status: z
          .enum(["open", "in_progress", "blocked", "done", "cancelled"])
          .optional(),
        workstream: z.string().optional().default("general"),
        agentId: z.string().optional(),
        priority: z.number().int().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        if (!ctx.db) return { error: "DATABASE_URL missing" };
        const workstream = slugifyWorkstream(input.workstream ?? "general");
        const row = await upsertDevTask(ctx, {
          ...input,
          workstream,
          source: "imessage",
        });
        return {
          ok: true,
          task: row
            ? {
                id: row.id,
                title: row.title,
                status: row.status,
                workstream: row.workstream,
                agentId: row.agentId,
              }
            : null,
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
        "Send a follow-up task to a Cursor cloud agent. Groups related work into one agent chat via workstream. Auto-spawns a new agent when none exists for that workstream. Persist a DB task when trackTask is true (default).",
      inputSchema: z.object({
        task: z.string().describe("Clear instruction for the Cursor agent"),
        mode: z.enum(["agent", "plan"]).optional().default("agent"),
        workstream: z
          .string()
          .optional()
          .describe(
            "Workstream slug/name. Related tasks should share one workstream → one agent chat.",
          ),
        agentId: z
          .string()
          .optional()
          .describe("Force a specific bc-... agent id"),
        trackTask: z
          .boolean()
          .optional()
          .default(true)
          .describe("Upsert an in_progress dev_task in the DB"),
        taskTitle: z
          .string()
          .optional()
          .describe("Short title for the DB task (defaults to truncated task)"),
      }),
      execute: async ({
        task,
        mode,
        workstream: rawWorkstream,
        agentId: explicitAgentId,
        trackTask,
        taskTitle,
      }) => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };

        const workstream = slugifyWorkstream(rawWorkstream ?? "general");
        const workstreamExplicit = Boolean(rawWorkstream?.trim());
        let resolved = await resolveAgentId(ctx, {
          phone: session.phone,
          agentId: explicitAgentId,
          workstream: workstreamExplicit ? workstream : undefined,
        });

        // Prefer an active agent already bound to this workstream.
        // If Riley named a distinct workstream and soft-default belongs elsewhere, spawn new.
        if (!explicitAgentId) {
          const workstreamAgent = await findActiveAgentForWorkstream(ctx, workstream);
          if (workstreamAgent?.agentId) {
            resolved = {
              agentId: workstreamAgent.agentId,
              source: "workstream",
              workstream,
            };
          } else if (
            workstreamExplicit &&
            workstream !== "general" &&
            resolved.source === "soft_default" &&
            resolved.agentId &&
            ctx.db
          ) {
            const softRow = await ctx.db.query.cursorAgents.findFirst({
              where: eq(cursorAgents.agentId, resolved.agentId),
            });
            if (softRow && softRow.workstream !== workstream) {
              resolved = { agentId: undefined, source: "none", workstream };
            }
          }
        }

        let agentId = resolved.agentId;
        let spawned = false;

        if (!agentId) {
          const created = await ctx.cursor.createAgent({
            prompt: [
              "[via iMessage operator bridge]",
              `Workstream: ${workstream}`,
              "Repo: altered-generated — ALTERED early-access deposit engine.",
              "Read AGENTS.md and knowledge/ops/preferences.md before acting.",
              "",
              task,
            ].join("\n"),
            repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
            startingRef: ctx.env.CURSOR_DEFAULT_REF,
            name: `ws:${workstream} — ${task.slice(0, 48)}`,
            autoCreatePR: false,
            workOnCurrentBranch: true,
          });
          agentId = created.agent.id;
          spawned = true;
          await registerCursorAgent(ctx, {
            agentId,
            name: created.agent.name,
            workstream,
            url: created.agent.url,
            lastRunId: created.run.id,
          });
          await setSoftDefaultAgentId(ctx, agentId);
          await bindThreadAgent(ctx, session.phone, session.threadDbId, agentId);

          let taskId: string | undefined;
          if (trackTask && ctx.db) {
            const row = await upsertDevTask(ctx, {
              title: taskTitle ?? truncateForImessage(task, 80),
              description: task,
              status: "in_progress",
              workstream,
              agentId,
              source: "imessage",
            });
            taskId = row?.id;
          }

          await bumpMetric(ctx, "cursorRuns");
          let jobId = "ephemeral";
          if (ctx.db) {
            const [job] = await ctx.db
              .insert(cursorJobs)
              .values({
                threadId: session.threadDbId,
                agentId,
                runId: created.run.id,
                prompt: task,
                status: "running",
                notifyPhone: session.phone,
                meta: { mode, workstream, spawned: true },
              })
              .returning();
            jobId = job?.id ?? jobId;
            if (job) {
              await scheduleRunPoll(ctx, {
                jobId: job.id,
                agentId,
                runId: created.run.id,
                notifyPhone: session.phone,
              });
            }
          }
          return {
            ok: true,
            spawned: true,
            agentId,
            runId: created.run.id,
            jobId,
            workstream,
            taskId,
            url: created.agent.url,
            note: "New agent chat started for this workstream. I'll text when the run finishes.",
          };
        }

        const enriched = [
          "[via iMessage operator bridge — AI tools]",
          `From: ${session.phone}`,
          `Workstream: ${workstream}`,
          "Goal: early-access reservation deposits ($99–$249 band) for ALTERED.",
          "Prefer shipping revenue/lead surfaces; persist decisions into knowledge/ and memories + DB tasks.",
          "Git: ship to main (Riley does not manage PRs/branches). Prefer commit+push to main; if you used a branch/PR, merge it yourself when done.",
          "",
          task,
        ].join("\n");

        try {
          const { run } = await ctx.cursor.createRun(
            agentId,
            enriched,
            mode === "plan" ? "plan" : "agent",
          );
          await touchCursorAgentRun(ctx, agentId, run.id);
          await setSoftDefaultAgentId(ctx, agentId);
          await bindThreadAgent(ctx, session.phone, session.threadDbId, agentId);

          let taskId: string | undefined;
          if (trackTask && ctx.db) {
            const row = await upsertDevTask(ctx, {
              title: taskTitle ?? truncateForImessage(task, 80),
              description: task,
              status: "in_progress",
              workstream,
              agentId,
              source: "imessage",
            });
            taskId = row?.id;
          }

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
                meta: { mode, workstream, spawned },
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
          return {
            ok: true,
            spawned: false,
            agentId,
            runId: run.id,
            jobId,
            workstream,
            taskId,
            source: resolved.source,
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
                  meta: { mode, workstream },
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
                workstream,
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
        "Create a NEW Cursor cloud agent for a workstream. Prefer prompt_cursor (auto-spawns) unless you explicitly want a fresh chat.",
      inputSchema: z.object({
        task: z.string(),
        name: z.string().optional(),
        workstream: z.string().optional().default("general"),
        bindAsDefault: z
          .boolean()
          .optional()
          .default(true)
          .describe("If true, pin as soft-default active agent"),
        trackTask: z.boolean().optional().default(true),
      }),
      execute: async ({ task, name, workstream: rawWorkstream, bindAsDefault, trackTask }) => {
        if (!ctx.cursor) return { error: "CURSOR_API_KEY missing" };
        const workstream = slugifyWorkstream(rawWorkstream ?? "general");
        const created = await ctx.cursor.createAgent({
          prompt: [
            "[via iMessage operator bridge]",
            `Workstream: ${workstream}`,
            "Repo: altered-generated — ALTERED early-access deposit engine.",
            "Read AGENTS.md and knowledge/ops/preferences.md before acting.",
            "",
            task,
          ].join("\n"),
          repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
          startingRef: ctx.env.CURSOR_DEFAULT_REF,
          name: name ?? `ws:${workstream} — ${task.slice(0, 48)}`,
          autoCreatePR: false,
          workOnCurrentBranch: true,
        });

        await registerCursorAgent(ctx, {
          agentId: created.agent.id,
          name: created.agent.name,
          workstream,
          url: created.agent.url,
          lastRunId: created.run.id,
        });
        await bindThreadAgent(ctx, session.phone, session.threadDbId, created.agent.id);
        if (bindAsDefault) {
          await setSoftDefaultAgentId(ctx, created.agent.id);
        }

        let taskId: string | undefined;
        if (trackTask && ctx.db) {
          const row = await upsertDevTask(ctx, {
            title: truncateForImessage(task, 80),
            description: task,
            status: "in_progress",
            workstream,
            agentId: created.agent.id,
            source: "imessage",
          });
          taskId = row?.id;
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
              meta: { workstream, spawned: true },
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
          workstream,
          taskId,
          boundAsDefault: bindAsDefault,
        };
      },
    }),

    set_operating_agent: tool({
      description:
        "Pin a Cursor agent id (bc-...) as the soft-default for future prompts when no workstream match exists. Persists in DB + Redis. Prefer workstreams over a permanent singleton.",
      inputSchema: z.object({
        agentId: z.string().regex(/^bc-[a-z0-9-]+$/i),
        workstream: z.string().optional(),
      }),
      execute: async ({ agentId, workstream: rawWorkstream }) => {
        const workstream = slugifyWorkstream(rawWorkstream ?? "general");
        await registerCursorAgent(ctx, { agentId, workstream });
        await setSoftDefaultAgentId(ctx, agentId);
        await bindThreadAgent(ctx, session.phone, session.threadDbId, agentId);
        return { ok: true, agentId, workstream };
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
        const soft = await getSoftDefaultAgentId(ctx);
        const scopeId =
          scope === "operator"
            ? session.phone
            : scope === "thread"
              ? session.threadDbId
              : scope === "agent"
                ? soft
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
  const soft = await getSoftDefaultAgentId(ctx);
  if (soft) parts.push(`Soft-default Cursor agent: ${soft}`);

  if (ctx.db) {
    const activeAgents = await ctx.db
      .select()
      .from(cursorAgents)
      .where(eq(cursorAgents.status, "active"))
      .orderBy(desc(cursorAgents.updatedAt))
      .limit(5);
    if (activeAgents.length) {
      parts.push(
        `Active agents: ${activeAgents
          .map((a) => `${a.workstream}=${a.agentId}`)
          .join(", ")}`,
      );
    }

    const openTasks = await listDevTasks(ctx, { status: "active", limit: 6 });
    if (openTasks.length) {
      parts.push("Open dev tasks:");
      for (const t of openTasks) {
        parts.push(
          `- [${t.status}] ${t.workstream}: ${truncateForImessage(t.title, 100)}${t.agentId ? ` (${t.agentId})` : ""}`,
        );
      }
    }

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

export { bumpMetric, resolveOperatingAgentId, resolveAgentId };
