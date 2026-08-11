import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import {
  createOperatorContext,
  createTrace,
  flushCompletionNotices,
  getAlteredChat,
  parseSendblueDateSent,
  pollCursorJob,
  sendblueThreadIdForContact,
  sendMarkReadDirect,
  traceLog,
  webhookAgeMs,
} from "@altered/chat";
import { createDb, cursorJobs } from "@altered/db";
import { getServerEnv, normalizePhone } from "@altered/env";
import { waitUntil } from "@vercel/functions";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { router } from "./router";

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
    rpc: "/rpc/*",
    webhooks: [
      "/webhooks/sendblue",
      "/webhooks/qstash/cursor-poll",
      "/webhooks/qstash/cursor-retry",
      "/webhooks/qstash/notify-flush",
    ],
  }),
);

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
  const { matched, response } = await openapi.handle(c.req.raw, {
    context: {},
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

type SendblueInboundBody = Record<string, unknown>;

/**
 * Earliest possible read receipt: direct Sendblue HTTP, no Chat SDK init.
 * Registered with waitUntil so cold-start initialize cannot delay mark-read.
 */
function earlySendblueReadReceipt(
  body: SendblueInboundBody,
  receivedAt: number,
) {
  const env = getServerEnv();
  if (!env.SENDBLUE_FROM_NUMBER) return;

  if (body.is_outbound === true) return;
  if (body.status !== "RECEIVED") return;
  if (typeof body.message_handle !== "string") return;

  const contact = normalizePhone(
    String(body.number ?? body.from_number ?? ""),
  );
  const from = normalizePhone(
    String(body.sendblue_number ?? body.to_number ?? env.SENDBLUE_FROM_NUMBER),
  );
  if (!contact || !from || contact === from) return;

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
    typeof body.content === "string" ? body.content.slice(0, 80) : undefined;

  traceLog(trace, "webhook_received", {
    dateSent: dateSentMs ? new Date(dateSentMs).toISOString() : null,
    dateSentRaw: body.date_sent ?? body.dateSent ?? body.sent_at ?? null,
    webhookAgeMs: webhookAgeMs(dateSentMs, receivedAt),
    textPreview: content,
    service: body.service ?? null,
  });

  // Fire mark-read immediately - do not await Chat SDK initialize.
  trackWaitUntil(
    sendMarkReadDirect({
      contactNumber: contact,
      fromNumber: from,
      trace,
      source: "webhook_early",
    }),
  );
}

app.post("/webhooks/sendblue", async (c) => {
  const receivedAt = Date.now();
  let body: SendblueInboundBody = {};
  try {
    body = (await c.req.raw.clone().json()) as SendblueInboundBody;
  } catch {
    body = {};
  }

  // Receipt first (waitUntil-tracked), before Chat SDK init / handler lock.
  earlySendblueReadReceipt(body, receivedAt);

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

export default app;
export { app };
