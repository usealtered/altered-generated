import { oc } from "@orpc/contract";
import { z } from "zod";

export const healthContract = oc
  .route({ method: "GET", path: "/health" })
  .output(
    z.object({
      ok: z.boolean(),
      service: z.string(),
      missingEnv: z.array(z.string()),
      time: z.string(),
    }),
  );

export const createLeadContract = oc
  .route({ method: "POST", path: "/leads" })
  .input(
    z.object({
      email: z.string().email().optional(),
      phone: z.string().min(7).optional(),
      name: z.string().min(1).optional(),
      company: z.string().optional(),
      source: z.string().default("web"),
      notes: z.string().optional(),
      utm: z.record(z.string()).optional(),
      wantDepositCheckout: z.boolean().optional(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      status: z.string(),
      checkoutUrl: z.string().url().optional(),
    }),
  );

export const listLeadsContract = oc
  .route({ method: "GET", path: "/leads" })
  .input(
    z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .optional(),
  )
  .output(
    z.object({
      items: z.array(
        z.object({
          id: z.string(),
          email: z.string().nullable(),
          phone: z.string().nullable(),
          name: z.string().nullable(),
          company: z.string().nullable(),
          status: z.string(),
          source: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  );

export const metricsTodayContract = oc
  .route({ method: "GET", path: "/metrics/today" })
  .output(
    z.object({
      day: z.string(),
      leadsCreated: z.number(),
      depositsCount: z.number(),
      depositsCents: z.number(),
      goalCents: z.number(),
      progress: z.number(),
    }),
  );

export const askRagContract = oc
  .route({ method: "POST", path: "/rag/ask" })
  .input(z.object({ query: z.string().min(1) }))
  .output(
    z.object({
      answer: z.string(),
      citations: z.array(
        z.object({
          path: z.string(),
          title: z.string(),
          score: z.number(),
        }),
      ),
    }),
  );

export const cursorStatusContract = oc
  .route({ method: "GET", path: "/cursor/status" })
  .output(
    z.object({
      agentId: z.string().nullable(),
      agentUrl: z.string().nullable(),
      latestRun: z
        .object({
          id: z.string(),
          status: z.string(),
          result: z.string().optional(),
        })
        .nullable(),
    }),
  );

export const promptCursorContract = oc
  .route({ method: "POST", path: "/cursor/prompt" })
  .input(
    z.object({
      prompt: z.string().min(1),
      agentId: z.string().optional(),
      mode: z.enum(["agent", "plan"]).optional(),
      notifyPhone: z.string().optional(),
    }),
  )
  .output(
    z.object({
      jobId: z.string(),
      agentId: z.string(),
      runId: z.string().nullable(),
      status: z.string(),
    }),
  );

export const appContract = {
  health: healthContract,
  createLead: createLeadContract,
  listLeads: listLeadsContract,
  metricsToday: metricsTodayContract,
  askRag: askRagContract,
  cursorStatus: cursorStatusContract,
  promptCursor: promptCursorContract,
};

export type AppContract = typeof appContract;
