import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import {
  createOperatorContext,
  createTrace,
  dispatchWebhookFastAck,
  flushCompletionNotices,
  getAlteredChat,
  parseSendblueDateSent,
  pollCursorJob,
  rememberWebhookReceivedAt,
  sendblueThreadIdForContact,
  sendMarkReadDirect,
  setBackgroundScheduler,
  traceLog,
  webhookAgeMs,
  runGenerateTick,
  runPublishTick,
  applyBatchApproval,
  verifyBatchActionToken,
  ensurePostingSchedules,
  enqueuePublish,
  listPendingBatchIdeas,
  getLatestPendingBatch,
  buildApprovalLinks,
  zernioConfigured,
  postingEnabled,
  applyIdeaAction,
  buildOpsDashboard,
  checkSendblueDeviceHealth,
  runDailyAnalyticsSnapshot,
  runHourlyConversationReview,
  runLeadGenSweep,
  ensureOpsCadenceSchedules,
} from "@altered/chat";
import { createDb, cursorJobs, leads, leadEvents } from "@altered/db";
import { getServerEnv, normalizePhone } from "@altered/env";
import { waitUntil } from "@vercel/functions";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { router } from "./router";
import { reserveRedirectHandler } from "./reserve-page";

const app = new Hono();
const rpc = new RPCHandler(router);
const openapi = new OpenAPIHandler(router);

function trackWaitUntil(task: Promise<unknown>) {
  try {
    waitUntil(task);
  } catch {
    void Promise.resolve(task).catch((err) => {
      console.error("[altered-ops] background task failed", err);
    });
  }
}

// Keeps webhook-early fast-ack / mark-read alive past the HTTP response.
setBackgroundScheduler(trackWaitUntil);

const MARK_READ_AWAIT_MS = 2000;

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) =>
  c.json({
    name: "altered-api",
    health: "/health",
    reserve: "/reserve",
    rpc: "/rpc/*",
    posting: {
      approve: "/ops/posts/approve",
      pending: "/ops/posts/pending",
      status: "/ops/posts/status",
    },
    webhooks: [
      "/webhooks/sendblue",
      "/webhooks/qstash/cursor-poll",
      "/webhooks/qstash/cursor-retry",
      "/webhooks/qstash/notify-flush",
      "/webhooks/qstash/posts/generate",
      "/webhooks/qstash/posts/publish",
      "/webhooks/qstash/ops/hourly-review",
      "/webhooks/qstash/ops/daily-analytics",
      "/webhooks/qstash/ops/lead-gen-sweep",
    ],
    cron: ["/cron/posts/generate", "/cron/posts/publish"],
    ops: {
      dashboard: "/ops/dashboard",
      ideaAction: "/ops/posts/idea/:id/action",
      ensureCadence: "/ops/ensure-cadence-schedules",
      sendblueHealth: "/ops/sendblue-health",
    },
  }),
);

app.get("/reserve", (c) => reserveRedirectHandler(c));
app.get("/early-access", (c) => reserveRedirectHandler(c));

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/rpc",
    context: {},
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/webhooks")) return next();
  if (c.req.path.startsWith("/cron")) return next();
  if (c.req.path.startsWith("/ops/posts")) return next();
  if (c.req.path.startsWith("/ops/leads")) return next();
  const { matched, response } = await openapi.handle(c.req.raw, {
    context: {},
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

type SendblueInboundBody = Record<string, unknown>;

type EarlyInbound = {
  receipt: Promise<unknown>;
  fastAck: Promise<unknown>;
};

/**
 * Side effects that must NOT wait on Chat SDK inbound lock / burst debounce:
 * mark-read + Haiku fast-ack send. Fast-ack is waitUntil'd so overlap-B can
 * ack while overlap-A still holds the handler lock.
 */
function startEarlyInbound(
  body: SendblueInboundBody,
  receivedAt: number,
): EarlyInbound | null {
  const env = getServerEnv();
  if (!env.SENDBLUE_FROM_NUMBER) return null;

  if (body.is_outbound === true) return null;
  if (body.status !== "RECEIVED") return null;
  if (typeof body.message_handle !== "string") return null;

  const contact = normalizePhone(
    String(body.number ?? body.from_number ?? ""),
  );
  const from = normalizePhone(
    String(body.sendblue_number ?? body.to_number ?? env.SENDBLUE_FROM_NUMBER),
  );
  if (!contact || !from || contact === from) return null;

  const messageHandle = body.message_handle;
  const dateSentMs = parseSendblueDateSent(
    body.date_sent ?? body.dateSent ?? body.sent_at,
  );
  const threadId = sendblueThreadIdForContact(from, contact);
  const trace = createTrace({
    messageHandle,
    phone: contact,
    threadId,
    t0: receivedAt,
  });

  const content =
    typeof body.content === "string" ? body.content : undefined;

  traceLog(trace, "webhook_parsed", {
    dateSent: dateSentMs ? new Date(dateSentMs).toISOString() : null,
    dateSentRaw: body.date_sent ?? body.dateSent ?? body.sent_at ?? null,
    webhookAgeMs: webhookAgeMs(dateSentMs, receivedAt),
    textPreview: content?.slice(0, 80),
    service: body.service ?? null,
  });
  traceLog(trace, "webhook_received", {
    dateSent: dateSentMs ? new Date(dateSentMs).toISOString() : null,
    dateSentRaw: body.date_sent ?? body.dateSent ?? body.sent_at ?? null,
    webhookAgeMs: webhookAgeMs(dateSentMs, receivedAt),
    textPreview: content?.slice(0, 80),
    service: body.service ?? null,
  });

  void rememberWebhookReceivedAt(messageHandle, receivedAt);

  const receipt = sendMarkReadDirect({
    contactNumber: contact,
    fromNumber: from,
    trace,
    source: "webhook_early",
  });

  const trimmed = (content ?? "").trim();
  const fastAck = trimmed
    ? dispatchWebhookFastAck({
        phone: contact,
        fromNumber: from,
        text: trimmed,
        messageHandle,
        threadId,
        trace,
      })
    : Promise.resolve({ ok: true, skipped: true });

  return { receipt, fastAck };
}

app.post("/webhooks/sendblue", async (c) => {
  const receivedAt = Date.now();
  let body: SendblueInboundBody = {};
  try {
    body = (await c.req.raw.clone().json()) as SendblueInboundBody;
  } catch {
    body = {};
  }

  // Mark-read + fast-ack start BEFORE Chat SDK lock / burst debounce.
  const early = startEarlyInbound(body, receivedAt);
  if (early) {
    trackWaitUntil(early.receipt);
    trackWaitUntil(early.fastAck);
    await Promise.race([
      early.receipt,
      new Promise<void>((resolve) =>
        setTimeout(resolve, MARK_READ_AWAIT_MS),
      ),
    ]);
  }

  const chat = getAlteredChat();
  await chat.initialize();
  const handle = chat.webhooks.sendblue;
  if (!handle) {
    return c.json({ error: "sendblue adapter not mounted" }, 500);
  }

  const response = await handle(c.req.raw, {
    waitUntil: trackWaitUntil,
  });

  if (
    body.is_outbound !== true &&
    body.status === "RECEIVED" &&
    typeof body.message_handle === "string"
  ) {
    const env = getServerEnv();
    const contact = normalizePhone(
      String(body.number ?? body.from_number ?? ""),
    );
    const from = normalizePhone(
      String(
        body.sendblue_number ?? body.to_number ?? env.SENDBLUE_FROM_NUMBER ?? "",
      ),
    );
    const trace = createTrace({
      messageHandle: body.message_handle,
      phone: contact || undefined,
      threadId:
        contact && from ? sendblueThreadIdForContact(from, contact) : undefined,
      t0: receivedAt,
    });
    traceLog(trace, "webhook_http_ok", {
      httpStatus: response.status,
      httpMs: Date.now() - receivedAt,
    });
  }

  return response;
});

async function verifyQstash(req: Request) {
  const env = getServerEnv();
  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) {
    return true;
  }
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  const signature = req.headers.get("upstash-signature") ?? "";
  const body = await req.clone().text();
  return receiver.verify({ signature, body });
}

function verifyCronRequest(req: Request): boolean {
  const env = getServerEnv();
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const auth = req.headers.get("authorization") ?? "";
  if (env.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`) return true;
  // Allow QStash token as ops bearer when CRON_SECRET unset (Hobby / bootstrap).
  if (env.QSTASH_TOKEN && auth === `Bearer ${env.QSTASH_TOKEN}`) return true;
  return false;
}

function verifyOpsDashboard(req: Request): boolean {
  const env = getServerEnv();
  const secret =
    env.OPS_DASHBOARD_SECRET || env.CRON_SECRET || env.QSTASH_TOKEN;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  return Boolean(key && key === secret);
}

app.post("/webhooks/qstash/cursor-poll", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json<{
    jobId: string;
    agentId: string;
    runId: string;
    notifyPhone?: string;
  }>();
  const ctx = createOperatorContext();
  // Queues a debounced, LLM-summarized notice - never raw markdown dumps.
  const result = await pollCursorJob(ctx, body);
  return c.json(result);
});

app.post("/webhooks/qstash/notify-flush", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json<{ phone: string; token: string }>();
  const ctx = createOperatorContext();
  const result = await flushCompletionNotices(ctx, body.phone, body.token);
  return c.json(result);
});

app.post("/webhooks/qstash/cursor-retry", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json<{ jobId: string }>();
  const env = getServerEnv();
  if (!env.DATABASE_URL || !env.CURSOR_API_KEY) {
    return c.json({ skipped: true });
  }
  const db = createDb(env.DATABASE_URL);
  const job = await db.query.cursorJobs.findFirst({
    where: eq(cursorJobs.id, body.jobId),
  });
  if (!job) return c.json({ missing: true }, 404);

  const ctx = createOperatorContext();
  if (!ctx.cursor) return c.json({ skipped: true });

  try {
    const { run } = await ctx.cursor.createRun(job.agentId, job.prompt);
    await db
      .update(cursorJobs)
      .set({ runId: run.id, status: "running", updatedAt: new Date() })
      .where(eq(cursorJobs.id, job.id));
    if (ctx.qstash && env.APP_BASE_URL) {
      await ctx.qstash.publishJSON({
        url: `${env.APP_BASE_URL}/webhooks/qstash/cursor-poll`,
        body: {
          jobId: job.id,
          agentId: job.agentId,
          runId: run.id,
          notifyPhone: job.notifyPhone ?? undefined,
        },
        delay: 20,
      });
    }
    return c.json({ started: true, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("409") || message.toLowerCase().includes("busy")) {
      if (ctx.qstash && env.APP_BASE_URL) {
        await ctx.qstash.publishJSON({
          url: `${env.APP_BASE_URL}/webhooks/qstash/cursor-retry`,
          body: { jobId: job.id },
          delay: 45,
        });
      }
      return c.json({ busy: true });
    }
    await db
      .update(cursorJobs)
      .set({ status: "error", resultSummary: message, updatedAt: new Date() })
      .where(eq(cursorJobs.id, job.id));
    return c.json({ error: message }, 500);
  }
});

app.post("/webhooks/qstash/posts/generate", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json().catch(() => ({} as { source?: string }));
  const ctx = createOperatorContext();
  const result = await runGenerateTick(ctx, {
    source: (body as { source?: string })?.source ?? "qstash",
  });
  return c.json(result);
});

app.post("/webhooks/qstash/posts/publish", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json().catch(() => ({} as { source?: string }));
  const ctx = createOperatorContext();
  const result = await runPublishTick(ctx, {
    source: (body as { source?: string })?.source ?? "qstash",
  });
  return c.json(result);
});

app.get("/cron/posts/generate", async (c) => {
  if (!verifyCronRequest(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ctx = createOperatorContext();
  const result = await runGenerateTick(ctx, { source: "vercel-cron" });
  return c.json(result);
});

app.get("/cron/posts/publish", async (c) => {
  if (!verifyCronRequest(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ctx = createOperatorContext();
  const result = await runPublishTick(ctx, { source: "vercel-cron" });
  return c.json(result);
});

/** One-tap approve/reject magic link — JSON only (no HTML on api-generated). */
app.get("/ops/posts/approve", async (c) => {
  const batchId = c.req.query("batch");
  const action = c.req.query("action") ?? "approve_all";
  const token = c.req.query("token") ?? "";
  if (!batchId || !token) {
    return c.json({ ok: false, error: "batch and token required" }, 400);
  }
  const ctx = createOperatorContext();
  if (!verifyBatchActionToken(ctx, batchId, action, token)) {
    return c.json({ ok: false, error: "invalid or expired token" }, 401);
  }
  const decision =
    action === "reject_all"
      ? ({ kind: "reject_all" } as const)
      : ({ kind: "approve_all" } as const);
  const result = await applyBatchApproval(ctx, {
    batchId,
    action: decision,
    source: "magic-link",
  });
  if (result.ok && result.approved > 0) {
    await enqueuePublish(ctx, 5);
  }
  return c.json({
    ok: result.ok,
    action: decision.kind,
    approved: result.approved,
    rejected: result.rejected,
    error: result.error,
    note:
      result.approved > 0
        ? "Approved posts enqueue for Zernio publish within seconds."
        : undefined,
  });
});

app.get("/ops/posts/pending", async (c) => {
  const ctx = createOperatorContext();
  const batch = await getLatestPendingBatch(ctx);
  if (!batch) {
    return c.json({ pending: false, ideas: [] });
  }
  const ideas = await listPendingBatchIdeas(ctx, batch.id);
  const links = buildApprovalLinks(ctx, batch.id);
  return c.json({
    pending: true,
    batch: {
      id: batch.id,
      status: batch.status,
      ideaCount: batch.ideaCount,
      createdAt: batch.createdAt,
    },
    ideas: ideas.map((i) => ({
      id: i.id,
      batchIndex: i.batchIndex,
      platform: i.platform,
      hook: i.hook,
      content: i.content,
      landingUrl: i.landingUrl,
    })),
    links,
  });
});

app.get("/ops/posts/status", async (c) => {
  const ctx = createOperatorContext();
  const env = ctx.env;
  const sendblue = await checkSendblueDeviceHealth(env, {
    lookbackMinutes: 90,
  });
  return c.json({
    postingEnabled: postingEnabled(env),
    zernioConfigured: zernioConfigured(env),
    hasZernioKey: Boolean(env.ZERNIO_API_KEY),
    hasTwitterAccount: Boolean(env.ZERNIO_TWITTER_ACCOUNT_ID),
    hasProfile: Boolean(env.ZERNIO_PROFILE_ID),
    twitterAccountIdSuffix: env.ZERNIO_TWITTER_ACCOUNT_ID
      ? env.ZERNIO_TWITTER_ACCOUNT_ID.slice(-6)
      : null,
    sendblue,
    schedules: {
      generateCron: "0 14 * * 1,3,5",
      publishCron: "*/15 * * * *",
      note: "POST /ops/posts/ensure-schedules to bootstrap QStash",
    },
  });
});

app.get("/ops/sendblue-health", async (c) => {
  if (!verifyOpsDashboard(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const env = getServerEnv();
  const sendblue = await checkSendblueDeviceHealth(env, {
    lookbackMinutes: 90,
  });
  if (sendblue.deviceDown) {
    console.error("[altered-ops] sendblue device down", {
      lastErrorAt: sendblue.lastErrorAt,
      lastErrorCode: sendblue.lastErrorCode,
      errorCount: sendblue.errorCount,
      diagnosis: sendblue.diagnosis,
    });
  }
  return c.json(sendblue);
});

app.post("/ops/posts/ensure-schedules", async (c) => {
  const env = getServerEnv();
  const auth = c.req.header("authorization") ?? "";
  const cronOk = verifyCronRequest(c.req.raw);
  const secretOk = Boolean(
    env.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`,
  );
  const qstashTokenOk = Boolean(
    env.QSTASH_TOKEN && auth === `Bearer ${env.QSTASH_TOKEN}`,
  );
  if (!cronOk && !secretOk && !qstashTokenOk) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ctx = createOperatorContext();
  const result = await ensurePostingSchedules(ctx);
  return c.json(result);
});

/** Capture anonymous reserve interest + UTM from social posts into Neon leads. */
app.post("/ops/leads/reserve-interest", async (c) => {
  const env = getServerEnv();
  if (!env.DATABASE_URL) return c.json({ ok: false, error: "no db" }, 503);
  const body = await c.req.json<{
    email?: string;
    phone?: string;
    name?: string;
    utm?: Record<string, string>;
    source?: string;
  }>();
  const db = createDb(env.DATABASE_URL);
  const email = body.email?.trim().toLowerCase() || null;
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!email && !phone) {
    return c.json({ ok: false, error: "email or phone required" }, 400);
  }
  const existing = email
    ? await db.query.leads.findFirst({ where: eq(leads.email, email) })
    : phone
      ? await db.query.leads.findFirst({ where: eq(leads.phone, phone) })
      : null;
  const source = body.source ?? "reserve-web";
  if (existing) {
    const [updated] = await db
      .update(leads)
      .set({
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        name: body.name ?? existing.name,
        utm: body.utm ?? existing.utm,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, existing.id))
      .returning();
    await db.insert(leadEvents).values({
      leadId: existing.id,
      type: "reserve_interest",
      fromStatus: existing.status,
      toStatus: existing.status,
      source,
      phone: phone ?? undefined,
      payload: { utm: body.utm },
    });
    return c.json({ ok: true, leadId: updated?.id ?? existing.id });
  }
  const [lead] = await db
    .insert(leads)
    .values({
      email: email ?? undefined,
      phone: phone ?? undefined,
      name: body.name,
      source,
      status: "new",
      utm: body.utm,
    })
    .returning();
  if (lead) {
    await db.insert(leadEvents).values({
      leadId: lead.id,
      type: "created",
      toStatus: "new",
      source,
      phone: phone ?? undefined,
      payload: { utm: body.utm },
    });
  }
  return c.json({ ok: true, leadId: lead?.id });
});

app.post("/webhooks/qstash/ops/hourly-review", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json().catch(() => ({} as { source?: string }));
  const ctx = createOperatorContext();
  const result = await runHourlyConversationReview(ctx, {
    source: (body as { source?: string }).source ?? "qstash",
  });
  return c.json(result);
});

app.post("/webhooks/qstash/ops/daily-analytics", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json().catch(() => ({} as { source?: string }));
  const ctx = createOperatorContext();
  const result = await runDailyAnalyticsSnapshot(ctx, {
    source: (body as { source?: string }).source ?? "qstash",
  });
  return c.json(result);
});

app.post("/webhooks/qstash/ops/lead-gen-sweep", async (c) => {
  const ok = await verifyQstash(c.req.raw);
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  const body = await c.req.json().catch(() => ({} as { source?: string }));
  const ctx = createOperatorContext();
  const result = await runLeadGenSweep(ctx, {
    source: (body as { source?: string }).source ?? "qstash",
  });
  return c.json(result);
});

app.get("/ops/dashboard", async (c) => {
  if (!verifyOpsDashboard(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ctx = createOperatorContext();
  const data = await buildOpsDashboard(ctx);
  return c.json(data);
});

app.post("/ops/posts/idea/:id/action", async (c) => {
  if (!verifyOpsDashboard(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ideaId = c.req.param("id");
  const body = await c.req.json<{
    action: "approve" | "reject" | "request_modification";
    note?: string;
  }>();
  if (
    !body?.action ||
    !["approve", "reject", "request_modification"].includes(body.action)
  ) {
    return c.json({ error: "action required" }, 400);
  }
  const ctx = createOperatorContext();
  const result = await applyIdeaAction(ctx, {
    ideaId,
    action: body.action,
    note: body.note,
    source: "ops-dashboard",
  });
  return c.json(result, result.ok ? 200 : 400);
});

app.post("/ops/ensure-cadence-schedules", async (c) => {
  if (!verifyCronRequest(c.req.raw) && !verifyOpsDashboard(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ctx = createOperatorContext();
  const posting = await ensurePostingSchedules(ctx);
  const cadence = await ensureOpsCadenceSchedules(ctx);
  return c.json({ posting, cadence });
});

export default app;
export { app };
