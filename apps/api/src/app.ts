import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { getAlteredChat } from "@altered/chat";
import {
  createOperatorContext,
  pollCursorJob,
} from "@altered/chat";
import { createDb, cursorJobs, dailyMetrics, leads } from "@altered/db";
import { getServerEnv } from "@altered/env";
import { Receiver } from "@upstash/qstash";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import Stripe from "stripe";
import { router } from "./router";

const app = new Hono();
const rpc = new RPCHandler(router);
const openapi = new OpenAPIHandler(router);

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
    webhooks: ["/webhooks/sendblue", "/webhooks/stripe", "/webhooks/qstash/*"],
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

// Contract OpenAPI routes: /health, /leads, /metrics/today, /rag/ask, /cursor/*
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/webhooks")) return next();
  const { matched, response } = await openapi.handle(c.req.raw, {
    context: {},
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.post("/webhooks/sendblue", async (c) => {
  const chat = getAlteredChat();
  await chat.initialize();
  const handle = chat.webhooks.sendblue;
  if (!handle) {
    return c.json({ error: "sendblue adapter not mounted" }, 500);
  }
  return handle(c.req.raw);
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
  const result = await pollCursorJob(ctx, body);
  if (result.done && result.summary && result.notifyPhone && ctx.env.SENDBLUE_API_KEY) {
    const chat = getAlteredChat();
    await chat.initialize();
    // Best-effort: post via Sendblue SDK on adapter
    const adapter = chat.getAdapter("sendblue") as {
      getSdk?: () => {
        messages: {
          send: (p: {
            number: string;
            from_number: string;
            content: string;
          }) => Promise<unknown>;
        };
      };
    };
    const sdk = adapter.getSdk?.();
    if (sdk && ctx.env.SENDBLUE_FROM_NUMBER) {
      await sdk.messages.send({
        number: result.notifyPhone,
        from_number: ctx.env.SENDBLUE_FROM_NUMBER,
        content: result.summary,
      });
    }
  }
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

app.post("/webhooks/stripe", async (c) => {
  const env = getServerEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.DATABASE_URL) {
    return c.json({ error: "stripe not configured" }, 503);
  }
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "missing signature" }, 400);
  const raw = await c.req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "invalid signature" },
      400,
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const leadId = session.metadata?.leadId;
    const db = createDb(env.DATABASE_URL);
    if (leadId) {
      await db
        .update(leads)
        .set({
          status: "paid",
          reservedAt: new Date(),
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
    }
    const amount = session.amount_total ?? env.EARLY_ACCESS_DEPOSIT_AMOUNT_CENTS;
    const day = new Date().toISOString().slice(0, 10);
    await db
      .insert(dailyMetrics)
      .values({
        day,
        depositsCount: 1,
        depositsCents: amount,
      })
      .onConflictDoUpdate({
        target: dailyMetrics.day,
        set: {
          depositsCount: sql`${dailyMetrics.depositsCount} + 1`,
          depositsCents: sql`${dailyMetrics.depositsCents} + ${amount}`,
          updatedAt: new Date(),
        },
      });
  }

  return c.json({ received: true });
});

export default app;
export { app };
