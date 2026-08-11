import { tool } from "ai";
import { desc, eq, or, and, isNotNull, sql } from "drizzle-orm";
import {
  CursorApiError,
  collapseWhitespace,
  formatRunStatus,
  truncateForImessage,
} from "@altered/cursor-bridge";
import {
  cursorAgents,
  cursorJobs,
  dailyMetrics,
  leadEvents,
  leads,
  memories,
  messages,
  threads,
} from "@altered/db";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { z } from "zod";
import type { OperatorContext } from "./operator-context";
import type { OutboundSession } from "./outbound";
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
import {
  resolveUiMedia,
  type UiMessagePayload,
} from "@altered/ui-message";

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Standing preamble injected into every Cursor agent prompt from iMessage. */
export function buildCursorPrompt(input: {
  task: string;
  workstream: string;
  phone?: string;
  spawn?: boolean;
}): string {
  return [
    input.spawn
      ? "[via iMessage operator bridge]"
      : "[via iMessage operator bridge - AI tools]",
    input.phone ? `From: ${input.phone}` : null,
    `Workstream: ${input.workstream}`,
    "Repo: altered-generated - ALTERED early-access deposit engine.",
    "Read AGENTS.md and knowledge/ops/preferences.md before acting.",
    "Goal: early-access reservation deposits ($99-$249 band) for ALTERED.",
    "Prefer shipping revenue/lead surfaces; persist decisions into knowledge/ and memories + DB tasks.",
    "Git: ship to main (Riley does not manage PRs/branches). Prefer commit+push to main; if you used a branch/PR, merge it yourself when done.",
    "",
    "STANDING AUDIT DEFAULT: For any diagnosis/bug/runtime task, YOU own pulling Vercel logs (api-generated only), querying relevant Neon tables, checking Redis state, and OpenRouter/AI usage as needed. Do not wait for Riley to spell that out.",
    "SELF-FIX: Treat Riley's concerns as implicit change requests. Ship fixes; track open loops in dev_tasks. If you notice instruction drift (markdown/em dashes/raw dumps), file a self-correction task.",
    "",
    input.task,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
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
  outbound?: OutboundSession;
};

/**
 * Previously wrapped every tool to auto-send a canned "Checking that now."
 * status. That caused duplicate/deterministic acks under parallel tool calls
 * and is banned. Status pings are model-authored via send_message(kind=status)
 * and Redis-deduped in the outbound session.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapToolsForOutbound<T extends Record<string, any>>(
  tools: T,
  _outbound?: OutboundSession,
): T {
  return tools;
}

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
  const tools = {
    send_message: tool({
      description:
        "Send one plain-text iMessage bubble to Riley now. Call multiple times for multi-part replies. The runtime already sent a fast LLM status ack - use kind=reply for answers (do not send another status ack or the canned phrase Checking that now). Prefer \\n\\n inside a bubble or multiple calls for structure. No markdown. No em dashes.",
      inputSchema: z.object({
        text: z.string().min(1).max(1400),
        kind: z.enum(["status", "reply"]).optional().default("reply"),
      }),
      execute: async ({ text, kind }) => {
        if (!session.outbound) {
          return { ok: false, error: "No outbound transport bound" };
        }
        return session.outbound.send(text, kind ?? "reply");
      },
    }),

    send_ui_message: tool({
      description:
        "Send a rich iMessage image/attachment bubble (not plain text). Provide a public mediaUrl ending with a file extension, OR set proof=true to generate and upload a local proof PNG via Sendblue CDN. Use for charts/cards/images.",
      inputSchema: z.object({
        mediaUrl: z
          .string()
          .url()
          .optional()
          .describe("Public HTTPS URL with file extension (e.g. .png)"),
        caption: z.string().max(1400).optional(),
        proof: z
          .boolean()
          .optional()
          .describe("If true, generate + upload a proof PNG via Sendblue"),
      }),
      execute: async ({ mediaUrl, caption, proof }) => {
        if (!session.outbound) {
          return { ok: false, error: "No outbound transport bound" };
        }
        if (!ctx.env.SENDBLUE_API_KEY || !ctx.env.SENDBLUE_API_SECRET) {
          return { ok: false, error: "SENDBLUE_API_KEY/SECRET missing" };
        }

        let payload: UiMessagePayload;
        if (proof) {
          // Lazy: keeps sharp/native bindings off the webhook cold path.
          const { generateProofPng } = await import(
            "@altered/ui-message/proof-image"
          );
          const img = await generateProofPng({
            subtitle: "ui-message via operator tool",
          });
          payload = {
            type: "image",
            source: {
              kind: "bytes",
              bytes: img.bytes,
              filename: img.filename,
              contentType: img.contentType,
            },
            caption,
          };
        } else if (mediaUrl) {
          payload = {
            type: "image",
            source: { kind: "url", url: mediaUrl },
            caption,
          };
        } else {
          return {
            ok: false,
            error: "Provide mediaUrl or set proof=true",
          };
        }

        const resolved = await resolveUiMedia(payload, {
          auth: {
            apiKey: ctx.env.SENDBLUE_API_KEY,
            apiSecret: ctx.env.SENDBLUE_API_SECRET,
          },
        });
        if (!resolved.ok) {
          return { ok: false, error: resolved.error };
        }

        const sent = await session.outbound.sendMedia(
          resolved.media.mediaUrl,
          resolved.media.caption,
        );
        return {
          ...sent,
          hosting: resolved.media.hosting,
          mediaObjectId: resolved.media.mediaObjectId,
        };
      },
    }),

    start_typing: tool({
      description:
        "Show the iMessage typing indicator shortly before a pending send_message. Call after tool work finishes and before the final reply.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!session.outbound) {
          return { ok: false, error: "No outbound transport bound" };
        }
        await session.outbound.typing();
        return { ok: true };
      },
    }),

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
        "Create or update a development task in the DB. Use for open loops / multi-step workstreams. Title must be a short human label (max ~120 chars), never paste the full prompt.",
      inputSchema: z.object({
        id: z.string().uuid().optional(),
        title: z
          .string()
          .min(1)
          .max(160)
          .describe("Short task title only. Do not paste full prompts."),
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
          title: collapseWhitespace(input.title).slice(0, 120),
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
            prompt: buildCursorPrompt({
              task,
              workstream,
              phone: session.phone,
              spawn: true,
            }),
            repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
            startingRef: ctx.env.CURSOR_DEFAULT_REF,
            name: `ws:${workstream} - ${collapseWhitespace(task).slice(0, 48)}`,
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
              title: taskTitle ?? collapseWhitespace(task).slice(0, 80),
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

        const enriched = buildCursorPrompt({
          task,
          workstream,
          phone: session.phone,
        });

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
              title: taskTitle ?? collapseWhitespace(task).slice(0, 80),
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
                note: "Agent busy - queued retry.",
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
          prompt: buildCursorPrompt({
            task,
            workstream,
            phone: session.phone,
            spawn: true,
          }),
          repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
          startingRef: ctx.env.CURSOR_DEFAULT_REF,
          name: name ?? `ws:${workstream} - ${collapseWhitespace(task).slice(0, 48)}`,
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
            title: collapseWhitespace(task).slice(0, 80),
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
      description:
        "Capture or update a sales lead (email and/or phone required). Records a lead_events row for funnel analytics.",
      inputSchema: z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
        name: z.string().optional(),
        company: z.string().optional(),
        notes: z.string().optional(),
        status: z
          .enum(["new", "contacted", "qualified", "reserved", "paid", "lost"])
          .optional()
          .describe("Funnel stage / status"),
      }),
      execute: async (input) => {
        if (!ctx.db) return { error: "DATABASE_URL missing" };
        if (!input.email && !input.phone) {
          return { error: "Need email or phone" };
        }
        const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
        const existing = await ctx.db.query.leads.findFirst({
          where: input.email
            ? eq(leads.email, input.email)
            : eq(leads.phone, input.phone!),
        });

        if (existing) {
          const nextStatus = input.status ?? existing.status;
          const [updated] = await ctx.db
            .update(leads)
            .set({
              email: input.email ?? existing.email,
              phone: input.phone ?? existing.phone,
              name: input.name ?? existing.name,
              company: input.company ?? existing.company,
              notes: input.notes ?? existing.notes,
              status: nextStatus,
              updatedAt: new Date(),
            })
            .where(eq(leads.id, existing.id))
            .returning();
          await ctx.db.insert(leadEvents).values({
            leadId: existing.id,
            type: nextStatus !== existing.status ? "status_changed" : "updated",
            fromStatus: existing.status,
            toStatus: nextStatus,
            source: "imessage",
            phone: updated?.phone ?? existing.phone ?? session.phone,
            payload: { notes: input.notes },
          });
          return {
            ok: true,
            leadId: existing.id,
            updated: true,
            status: nextStatus,
            checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL,
          };
        }

        const status = input.status ?? "new";
        const [lead] = await ctx.db
          .insert(leads)
          .values({
            email: input.email,
            phone: input.phone,
            name: input.name,
            company: input.company,
            notes: input.notes,
            source: "imessage",
            status,
            depositAmountCents: amountCents,
            depositCurrency: ctx.env.EARLY_ACCESS_DEPOSIT_CURRENCY,
          })
          .returning();
        if (lead) {
          await ctx.db.insert(leadEvents).values({
            leadId: lead.id,
            type: "created",
            toStatus: status,
            source: "imessage",
            phone: lead.phone ?? session.phone,
            payload: { notes: input.notes },
          });
        }
        await bumpMetric(ctx, "leadsCreated");
        return {
          ok: true,
          leadId: lead?.id,
          updated: false,
          status,
          checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL,
        };
      },
    }),

    get_metrics: tool({
      description:
        "Today's funnel metrics with breakdown: unique phones, inbound message count, leads, and stage counts. Do not treat imessageInbound alone as unique conversations.",
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
        const aiCostMicros = row?.aiCostMicros ?? 0;
        const leadsCreated = row?.leadsCreated ?? 0;

        const dayStart = new Date(`${day}T00:00:00.000Z`);
        const [inboundAgg] = await ctx.db
          .select({
            inboundMessages: sql<number>`count(*)::int`,
            uniquePhones: sql<number>`count(distinct ${threads.phone})::int`,
          })
          .from(messages)
          .innerJoin(threads, eq(messages.threadId, threads.id))
          .where(
            and(
              eq(messages.direction, "inbound"),
              sql`${messages.createdAt} >= ${dayStart}`,
            ),
          );

        const stageRows = await ctx.db
          .select({
            status: leads.status,
            n: sql<number>`count(*)::int`,
          })
          .from(leads)
          .groupBy(leads.status);
        const funnelStages = Object.fromEntries(
          stageRows.map((r) => [r.status, r.n]),
        ) as Record<string, number>;

        const [leadsTodayRow] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(leads)
          .where(sql`${leads.createdAt} >= ${dayStart}`);

        return {
          day,
          leadsCreated,
          leadsCreatedToday: leadsTodayRow?.n ?? leadsCreated,
          depositsCount: row?.depositsCount ?? 0,
          depositsCents: cents,
          progressPct: Math.min(100, Math.round((cents / goalCents) * 100)),
          goalCents,
          depositAmount: amountLabel,
          /** @deprecated Prefer inboundMessagesToday + uniquePhonesMessagedToday */
          imessageInbound: row?.imessageInbound ?? 0,
          inboundMessagesToday:
            inboundAgg?.inboundMessages ?? row?.imessageInbound ?? 0,
          uniquePhonesMessagedToday: inboundAgg?.uniquePhones ?? 0,
          funnelStages: {
            new: funnelStages.new ?? 0,
            contacted: funnelStages.contacted ?? 0,
            qualified: funnelStages.qualified ?? 0,
            reserved: funnelStages.reserved ?? 0,
            paid: funnelStages.paid ?? 0,
            lost: funnelStages.lost ?? 0,
          },
          cursorRuns: row?.cursorRuns ?? 0,
          aiCalls: row?.aiCalls ?? 0,
          aiInputTokens: row?.aiInputTokens ?? 0,
          aiOutputTokens: row?.aiOutputTokens ?? 0,
          aiCostUsd: Number((aiCostMicros / 1_000_000).toFixed(6)),
          aiCostPerLeadUsd:
            leadsCreated > 0
              ? Number((aiCostMicros / 1_000_000 / leadsCreated).toFixed(6))
              : null,
          checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL ?? null,
        };
      },
    }),

    get_checkout_link: tool({
      description:
        "Return the $100 program reservation deposit checkout URL (PRIMARY_CHECKOUT_URL). Credits toward \$499 program (net \$399).",
      inputSchema: z.object({}),
      execute: async () => {
        const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
        if (!ctx.env.PRIMARY_CHECKOUT_URL) {
          return {
            error:
              "PRIMARY_CHECKOUT_URL not set yet. Add a Stripe Payment Link for $100 when ready.",
            amountCents,
            programCents: 49900,
            netCents: 39900,
          };
        }
        return {
          url: ctx.env.PRIMARY_CHECKOUT_URL,
          amountCents,
          programCents: 49900,
          netCents: 39900,
        };
      },
    }),

    save_memory: tool({
      description:
        "Persist a durable KEYED fact (offer terms, prefs, decisions). Key required - use namespaces like offer.deposit, ops.decision.*, prefs.*, lead.stage.*.",
      inputSchema: z.object({
        content: z.string().min(1),
        key: z
          .string()
          .min(1)
          .describe("Stable key to upsert, e.g. offer.deposit"),
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
            return { ok: true, id: existing.id, upserted: true, key };
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
          await mirrorMemoryRedis(ctx, key, content);
          return { ok: true, id: row?.id, upserted: false, key };
        }

        if (ctx.redis) {
          const id = `mem_${Date.now()}`;
          await ctx.redis.lpush(
            "memories:global",
            JSON.stringify({ id, key, content, at: Date.now() }),
          );
          await ctx.redis.ltrim("memories:global", 0, 199);
          await mirrorMemoryRedis(ctx, key, content);
          return { ok: true, id, redisOnly: true, key };
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

    generate_post_ideas: tool({
      description:
        "Generate a batch of social post ideas (X/LinkedIn), queue them for one-tap HITL approval, and text Riley the batch.",
      inputSchema: z.object({
        count: z.number().int().min(3).max(7).optional().default(5),
      }),
      execute: async ({ count }) => {
        const { runGenerateTick } = await import("./posting");
        const result = await runGenerateTick(ctx, {
          source: "imessage-tool",
          count,
        });
        return {
          ok: result.generated.ok,
          batchId: result.generated.batchId,
          ideaIds: result.generated.ideaIds,
          notified: result.notified,
          schedules: result.schedules,
          error: result.generated.error ?? result.generated.skipped,
        };
      },
    }),

    list_post_ideas: tool({
      description:
        "List recent post ideas by status (pending_approval, approved, published, failed).",
      inputSchema: z.object({
        status: z
          .enum([
            "pending_approval",
            "approved",
            "published",
            "failed",
            "rejected",
          ])
          .optional()
          .default("pending_approval"),
        limit: z.number().int().min(1).max(20).optional().default(10),
      }),
      execute: async ({ status, limit }) => {
        if (!ctx.db) return { items: [], error: "no db" };
        const { postIdeas } = await import("@altered/db");
        const { desc, eq } = await import("drizzle-orm");
        const rows = await ctx.db.query.postIdeas.findMany({
          where: eq(postIdeas.status, status),
          orderBy: [desc(postIdeas.createdAt)],
          limit,
        });
        return {
          items: rows.map((r) => ({
            id: r.id,
            batchIndex: r.batchIndex,
            status: r.status,
            platform: r.platform,
            hook: r.hook,
            landingUrl: r.landingUrl,
            zernioPostId: r.zernioPostId,
            error: r.error,
          })),
        };
      },
    }),

    approve_posts: tool({
      description:
        "Approve or reject the latest pending post batch (or a specific batch id). Prefer APPROVE ALL for minimal friction.",
      inputSchema: z.object({
        batchId: z.string().uuid().optional(),
        action: z
          .enum(["approve_all", "reject_all"])
          .optional()
          .default("approve_all"),
        indexes: z.array(z.number().int().positive()).optional(),
      }),
      execute: async ({ batchId, action, indexes }) => {
        const {
          applyBatchApproval,
          getLatestPendingBatch,
          enqueuePublish,
        } = await import("./posting");
        const batch =
          batchId != null
            ? { id: batchId }
            : await getLatestPendingBatch(ctx);
        if (!batch) return { ok: false, error: "no pending batch" };
        const decision =
          indexes?.length && action === "approve_all"
            ? ({ kind: "approve_indexes", indexes } as const)
            : action === "reject_all"
              ? ({ kind: "reject_all" } as const)
              : ({ kind: "approve_all" } as const);
        const result = await applyBatchApproval(ctx, {
          batchId: batch.id,
          action: decision,
          source: "imessage-tool",
        });
        if (result.ok && result.approved > 0) {
          await enqueuePublish(ctx, 5);
        }
        return result;
      },
    }),

    run_post_publish: tool({
      description:
        "Publish approved post ideas via Zernio now (same as the publish cron tick).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).optional().default(10),
      }),
      execute: async ({ limit }) => {
        const { runPublishTick } = await import("./posting");
        return runPublishTick(ctx, { source: "imessage-tool", limit });
      },
    }),

    posting_status: tool({
      description:
        "Posting pipeline status: Zernio config, pending/approved counts, schedule state.",
      inputSchema: z.object({}),
      execute: async () => {
        const {
          zernioConfigured,
          postingEnabled,
          ensurePostingSchedules,
        } = await import("./posting");
        const { postIdeas } = await import("@altered/db");
        const { sql } = await import("drizzle-orm");
        let counts: Record<string, number> = {};
        if (ctx.db) {
          const rows = await ctx.db
            .select({
              status: postIdeas.status,
              n: sql<number>`count(*)::int`,
            })
            .from(postIdeas)
            .groupBy(postIdeas.status);
          counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
        }
        const schedules = await ensurePostingSchedules(ctx);
        return {
          postingEnabled: postingEnabled(ctx.env),
          zernioConfigured: zernioConfigured(ctx.env),
          hasApiKey: Boolean(ctx.env.ZERNIO_API_KEY),
          hasTwitterAccount: Boolean(ctx.env.ZERNIO_TWITTER_ACCOUNT_ID),
          hasProfile: Boolean(ctx.env.ZERNIO_PROFILE_ID),
          counts,
          schedules,
          landing: `${(ctx.env.SITE_BASE_URL ?? "https://generated.usealtered.com").replace(/\/$/, "")}/early-access`,
        };
      },
    }),
  };

  return wrapToolsForOutbound(tools, session.outbound);
}

async function mirrorMemoryRedis(
  ctx: OperatorContext,
  key: string,
  content: string,
) {
  await ctx.redis?.set(`memory:key:${key}`, content);
}

/**
 * Tight always-on context: soft-default + ≤3 open tasks + ≤6 keyed facts.
 * Narrative notes stay out of preamble - use recall_memories / search_knowledge.
 */
export async function loadMemoryPreamble(
  ctx: OperatorContext,
  phone: string,
): Promise<string> {
  const parts: string[] = [];
  const soft = await getSoftDefaultAgentId(ctx);
  if (soft) parts.push(`Soft-default Cursor agent: ${soft}`);

  if (ctx.db) {
    const openTasks = await listDevTasks(ctx, { status: "active", limit: 3 });
    if (openTasks.length) {
      parts.push("Open dev tasks:");
      for (const t of openTasks) {
        parts.push(
          `- [${t.status}] ${t.workstream}: ${truncateForImessage(t.title, 80)}${t.agentId ? ` (${t.agentId})` : ""}`,
        );
      }
    }

    const rows = await ctx.db
      .select()
      .from(memories)
      .where(
        and(
          isNotNull(memories.key),
          or(
            eq(memories.scope, "global"),
            and(eq(memories.scope, "operator"), eq(memories.scopeId, phone)),
          ),
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(6);
    if (rows.length) {
      parts.push("Keyed facts:");
      for (const r of rows) {
        parts.push(
          `- ${r.key}: ${truncateForImessage(r.content, 160)}`,
        );
      }
    }
  } else if (ctx.redis) {
    const raw = (await ctx.redis.lrange("memories:global", 0, 5)) ?? [];
    for (const item of raw) {
      try {
        const parsed =
          typeof item === "string"
            ? JSON.parse(item)
            : (item as { content?: string; key?: string });
        if (!parsed.key) continue;
        parts.push(
          `- ${parsed.key}: ${truncateForImessage(String(parsed.content ?? ""), 160)}`,
        );
      } catch {
        /* skip */
      }
    }
  }

  return parts.length
    ? `Durable memory:\n${parts.join("\n")}`
    : "Durable memory: (empty)";
}

export { bumpMetric, resolveOperatingAgentId, resolveAgentId };
