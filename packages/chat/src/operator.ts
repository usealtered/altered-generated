import { eq, sql } from "drizzle-orm";
import {
  createCursorClient,
  CursorApiError,
  formatRunStatus,
  truncateForImessage,
  type CursorClient,
} from "@altered/cursor-bridge";
import {
  createDb,
  cursorJobs,
  dailyMetrics,
  leads,
  messages,
  threads,
  type Database,
} from "@altered/db";
import {
  getServerEnv,
  isOperatorPhone,
  parseAllowlist,
  type ServerEnv,
} from "@altered/env";
import { getKnowledgeRoot } from "@altered/knowledge";
import { answerWithRag, loadKnowledgeDir } from "@altered/rag";
import { Client as QStashClient } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import {
  extractLeadFields,
  helpText,
  parseCommand,
  type Command,
} from "./commands";

export type OperatorContext = {
  env: ServerEnv;
  db?: Database;
  redis?: Redis;
  cursor?: CursorClient;
  qstash?: QStashClient;
  knowledgeRoot: string;
};

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

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function createOperatorContext(
  overrides: Partial<OperatorContext> = {},
): OperatorContext {
  const env = overrides.env ?? getServerEnv();
  const ctx: OperatorContext = {
    env,
    knowledgeRoot: overrides.knowledgeRoot ?? getKnowledgeRoot(),
  };

  if (env.DATABASE_URL) ctx.db = overrides.db ?? createDb(env.DATABASE_URL);
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    ctx.redis =
      overrides.redis ??
      new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });
  }
  if (env.CURSOR_API_KEY) {
    ctx.cursor = overrides.cursor ?? createCursorClient(env.CURSOR_API_KEY);
  }
  if (env.QSTASH_TOKEN) {
    ctx.qstash = overrides.qstash ?? new QStashClient({ token: env.QSTASH_TOKEN });
  }
  return ctx;
}

async function bumpMetric(
  db: Database | undefined,
  field: "leadsCreated" | "depositsCount" | "imessageInbound" | "cursorRuns",
  amount = 1,
) {
  if (!db) return;
  const day = todayKey();
  await db
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

async function ensureThread(
  db: Database | undefined,
  chatThreadId: string,
  phone: string,
) {
  if (!db) return null;
  const existing = await db.query.threads.findFirst({
    where: eq(threads.chatThreadId, chatThreadId),
  });
  if (existing) return existing;
  const [row] = await db
    .insert(threads)
    .values({ chatThreadId, phone, channel: "sendblue" })
    .returning();
  return row ?? null;
}

async function saveMessage(
  db: Database | undefined,
  threadId: string | undefined,
  direction: "inbound" | "outbound",
  body: string,
) {
  if (!db || !threadId) return;
  await db.insert(messages).values({ threadId, direction, body });
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

async function handleCursorPrompt(
  ctx: OperatorContext,
  opts: {
    prompt: string;
    mode?: "agent" | "plan";
    phone: string;
    threadDbId?: string;
    agentId?: string;
  },
) {
  if (!ctx.cursor) {
    return "CURSOR_API_KEY missing. Add it in Vercel env, then retry.";
  }
  const agentId =
    opts.agentId ??
    ctx.env.CURSOR_OPERATING_AGENT_ID ??
    (await ctx.redis?.get<string>(`thread:${opts.phone}:agentId`)) ??
    undefined;

  if (!agentId) {
    return "No operating agent linked. Set CURSOR_OPERATING_AGENT_ID or text: link bc-...";
  }

  const enriched = [
    "[via iMessage operator bridge]",
    `From: ${opts.phone}`,
    "Goal: generate $250+/day ALTERED early-access reservation deposits.",
    "Prefer shipping lead/sales surfaces and asking for missing secrets over speculative refactors.",
    "",
    opts.prompt,
  ].join("\n");

  let runId: string | null = null;
  let status = "queued";
  try {
    const { run } = await ctx.cursor.createRun(agentId, enriched, opts.mode);
    runId = run.id;
    status = run.status.toLowerCase();
  } catch (err) {
    if (err instanceof CursorApiError && err.isBusy) {
      status = "busy_retry";
      if (ctx.db) {
        const [job] = await ctx.db
          .insert(cursorJobs)
          .values({
            threadId: opts.threadDbId,
            agentId,
            prompt: enriched,
            status: "busy_retry",
            notifyPhone: opts.phone,
            meta: { mode: opts.mode },
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
      }
      return `Agent busy. Queued retry for ${agentId}. I'll text when the run starts.`;
    }
    throw err;
  }

  let jobId = "ephemeral";
  if (ctx.db) {
    const [job] = await ctx.db
      .insert(cursorJobs)
      .values({
        threadId: opts.threadDbId,
        agentId,
        runId: runId ?? undefined,
        prompt: enriched,
        status: status === "busy_retry" ? "busy_retry" : "running",
        notifyPhone: opts.phone,
        meta: { mode: opts.mode },
      })
      .returning();
    jobId = job?.id ?? jobId;
    if (job && runId) {
      await scheduleRunPoll(ctx, {
        jobId: job.id,
        agentId,
        runId,
        notifyPhone: opts.phone,
      });
    }
  }

  await bumpMetric(ctx.db, "cursorRuns");
  await ctx.redis?.set(`thread:${opts.phone}:agentId`, agentId);
  return `Sent to Cursor ${agentId}\nrun=${runId ?? "n/a"}\njob=${jobId}\nI'll text the result when finished.`;
}

async function handleCommand(
  ctx: OperatorContext,
  command: Command,
  phone: string,
  threadDbId?: string,
  boundAgentId?: string | null,
): Promise<string> {
  switch (command.type) {
    case "help":
      return helpText();
    case "status": {
      if (!ctx.cursor || !ctx.env.CURSOR_OPERATING_AGENT_ID) {
        return "Cursor not configured (need CURSOR_API_KEY + CURSOR_OPERATING_AGENT_ID).";
      }
      const agentId = boundAgentId ?? ctx.env.CURSOR_OPERATING_AGENT_ID;
      const agent = await ctx.cursor.getAgent(agentId);
      if (!agent.latestRunId) {
        return `Agent ${agent.id} (${agent.status}) — no runs yet.\n${agent.url ?? ""}`;
      }
      const run = await ctx.cursor.getRun(agentId, agent.latestRunId);
      return truncateForImessage(
        `Agent ${agent.name}\n${agent.url ?? agent.id}\n${formatRunStatus(run)}`,
      );
    }
    case "ask": {
      const chunks = await getChunks(ctx.knowledgeRoot);
      const hasLlm = Boolean(ctx.env.OPENAI_API_KEY);
      const result = await answerWithRag({
        query: command.query,
        chunks,
        modelId: ctx.env.AI_MODEL,
        hasLlm,
        openAiApiKey: ctx.env.OPENAI_API_KEY,
      });
      const cites = result.citations
        .slice(0, 3)
        .map((c) => `• ${c.title}`)
        .join("\n");
      return truncateForImessage(`${result.answer}\n\nSources:\n${cites || "—"}`);
    }
    case "cursor":
      return handleCursorPrompt(ctx, {
        prompt: command.prompt,
        mode: command.mode,
        phone,
        threadDbId,
        agentId: boundAgentId ?? undefined,
      });
    case "new": {
      if (!ctx.cursor) return "CURSOR_API_KEY missing.";
      const created = await ctx.cursor.createAgent({
        prompt: [
          "[via iMessage operator bridge]",
          "Repo: altered-generated — Hormozi-style agents for ALTERED early-access deposits ($250+/day).",
          "",
          command.prompt,
        ].join("\n"),
        repoUrl: ctx.env.CURSOR_DEFAULT_REPO_URL,
        startingRef: ctx.env.CURSOR_DEFAULT_REF,
        name: `iMessage: ${command.prompt.slice(0, 60)}`,
        autoCreatePR: true,
      });
      await ctx.redis?.set(`thread:${phone}:agentId`, created.agent.id);
      if (ctx.db && threadDbId) {
        await ctx.db
          .update(threads)
          .set({ cursorAgentId: created.agent.id, updatedAt: new Date() })
          .where(eq(threads.id, threadDbId));
        const [job] = await ctx.db
          .insert(cursorJobs)
          .values({
            threadId: threadDbId,
            agentId: created.agent.id,
            runId: created.run.id,
            prompt: command.prompt,
            status: "running",
            notifyPhone: phone,
          })
          .returning();
        if (job) {
          await scheduleRunPoll(ctx, {
            jobId: job.id,
            agentId: created.agent.id,
            runId: created.run.id,
            notifyPhone: phone,
          });
        }
      }
      await bumpMetric(ctx.db, "cursorRuns");
      return `Spawned ${created.agent.id}\n${created.agent.url ?? ""}\nrun=${created.run.id}`;
    }
    case "link": {
      await ctx.redis?.set(`thread:${phone}:agentId`, command.agentId);
      if (ctx.db && threadDbId) {
        await ctx.db
          .update(threads)
          .set({ cursorAgentId: command.agentId, updatedAt: new Date() })
          .where(eq(threads.id, threadDbId));
      }
      return `Linked this chat to ${command.agentId}`;
    }
    case "lead": {
      if (!ctx.db) return "DATABASE_URL missing — can't store leads yet.";
      const fields = extractLeadFields(command.text);
      if (!fields.email && !fields.phone) {
        return "Need an email or phone. Example: lead jane@co.com +15551212 interested in RAG";
      }
      const [lead] = await ctx.db
        .insert(leads)
        .values({
          email: fields.email,
          phone: fields.phone,
          notes: fields.notes,
          source: "imessage",
          status: "new",
          depositAmountCents: ctx.env.EARLY_ACCESS_DEPOSIT_AMOUNT_CENTS,
          depositCurrency: ctx.env.EARLY_ACCESS_DEPOSIT_CURRENCY,
        })
        .returning();
      await bumpMetric(ctx.db, "leadsCreated");
      return `Lead saved ${lead?.id}\n${fields.email ?? ""} ${fields.phone ?? ""}\nFollow up + send deposit link from /early-access`;
    }
    case "metrics": {
      const goal = ctx.env.EARLY_ACCESS_DEPOSIT_AMOUNT_CENTS; // per deposit; daily goal $250
      const dailyGoal = 25000;
      if (!ctx.db) {
        return `Goal $${(dailyGoal / 100).toFixed(0)}/day. DB offline — metrics unavailable.`;
      }
      const day = todayKey();
      const row = await ctx.db.query.dailyMetrics.findFirst({
        where: eq(dailyMetrics.day, day),
      });
      const cents = row?.depositsCents ?? 0;
      const pct = Math.min(100, Math.round((cents / dailyGoal) * 100));
      return `Today ${day}\nLeads: ${row?.leadsCreated ?? 0}\nDeposits: ${row?.depositsCount ?? 0} ($${(cents / 100).toFixed(0)})\nProgress: ${pct}% of $250\niMessage in: ${row?.imessageInbound ?? 0}\nCursor runs: ${row?.cursorRuns ?? 0}\nDefault deposit: $${(goal / 100).toFixed(0)}`;
    }
    case "remember": {
      // Persist a short-lived note in Redis; agent can flush to knowledge/ on next Cursor run
      const key = `ops:notes:${todayKey()}`;
      if (ctx.redis) {
        await ctx.redis.rpush(key, `${new Date().toISOString()} ${command.text}`);
      }
      if (ctx.env.CURSOR_OPERATING_AGENT_ID && ctx.cursor) {
        await handleCursorPrompt(ctx, {
          prompt: `Store this operator note into knowledge/ops/inbox.md (append, keep concise):\n\n${command.text}`,
          phone,
          threadDbId,
          agentId: boundAgentId ?? undefined,
        });
        return "Noted — queued Cursor to append into knowledge/ops/inbox.md";
      }
      return ctx.redis
        ? "Noted in Redis ops inbox. Link Cursor to flush into knowledge/."
        : "Redis unavailable; note not stored.";
    }
    case "raw":
      return handleCursorPrompt(ctx, {
        prompt: command.text,
        phone,
        threadDbId,
        agentId: boundAgentId ?? undefined,
      });
  }
}

export async function handleOperatorMessage(input: {
  ctx?: OperatorContext;
  chatThreadId: string;
  phone: string;
  text: string;
}): Promise<string> {
  const ctx = input.ctx ?? createOperatorContext();
  const allowlist = parseAllowlist(ctx.env.OPERATOR_PHONE_ALLOWLIST);
  if (!isOperatorPhone(input.phone, allowlist)) {
    return "Unauthorized phone for ALTERED ops bridge.";
  }

  const thread = await ensureThread(ctx.db, input.chatThreadId, input.phone);
  await saveMessage(ctx.db, thread?.id, "inbound", input.text);
  await bumpMetric(ctx.db, "imessageInbound");

  const bound =
    thread?.cursorAgentId ??
    (await ctx.redis?.get<string>(`thread:${input.phone}:agentId`));

  const command = parseCommand(input.text);
  try {
    const reply = await handleCommand(
      ctx,
      command,
      input.phone,
      thread?.id,
      bound,
    );
    await saveMessage(ctx.db, thread?.id, "outbound", reply);
    await ctx.redis?.lpush(
      `chat:history:${input.phone}`,
      JSON.stringify({ at: Date.now(), in: input.text, out: reply }),
    );
    await ctx.redis?.ltrim(`chat:history:${input.phone}`, 0, 49);
    return reply;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reply = truncateForImessage(`Error: ${msg}`);
    await saveMessage(ctx.db, thread?.id, "outbound", reply);
    return reply;
  }
}

export async function pollCursorJob(
  ctx: OperatorContext,
  input: { jobId: string; agentId: string; runId: string; notifyPhone?: string },
): Promise<{ done: boolean; summary?: string; notifyPhone?: string }> {
  if (!ctx.cursor) return { done: true, summary: "No Cursor client" };
  const run = await ctx.cursor.getRun(input.agentId, input.runId);
  const terminal = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(
    run.status,
  );

  if (!terminal) {
    if (ctx.qstash && ctx.env.APP_BASE_URL) {
      await ctx.qstash.publishJSON({
        url: `${ctx.env.APP_BASE_URL}/webhooks/qstash/cursor-poll`,
        body: input,
        delay: 25,
        retries: 3,
      });
    }
    return { done: false };
  }

  if (ctx.db) {
    await ctx.db
      .update(cursorJobs)
      .set({
        status: run.status === "FINISHED" ? "finished" : "error",
        resultSummary: run.result ?? run.status,
        updatedAt: new Date(),
      })
      .where(eq(cursorJobs.id, input.jobId));
  }

  return {
    done: true,
    notifyPhone: input.notifyPhone,
    summary: truncateForImessage(
      `Cursor done (${run.status})\nagent=${input.agentId}\n${formatRunStatus(run)}`,
    ),
  };
}
