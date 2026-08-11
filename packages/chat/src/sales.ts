import { tool } from "ai";
import { generateText, hasToolCall, stepCountIs } from "ai";
import { z } from "zod";
import {
  sanitizeImessageText,
  truncateForImessage,
} from "@altered/cursor-bridge";
import { leadEvents, leads, messages, threads } from "@altered/db";
import { eq } from "drizzle-orm";
import {
  depositLabel,
  netAfterDepositLabel,
  programPriceLabel,
  resolveDepositAmountCents,
} from "./offer";
import type { OperatorContext } from "./operator-context";
import type { OutboundSession } from "./outbound";
import { chatAgentModelId, createOpenRouter } from "./model";
import { recordAiEvent } from "./observability";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

/**
 * Sales-line behavior for non-operator phones on +13054098546.
 * Qualify → pitch → objections → close → checkout link → save_lead.
 */
export const SALES_SYSTEM = `You are ALTERED's sales agent on iMessage (line +13054098546).
You talk to prospect founders. Your job is to qualify, pitch, handle objections, and close a $100 program reservation deposit.

PRODUCT / OFFER (locked - do not renegotiate):
- ALTERED (ALTERED Koa / Layer 1): always-on iMessage agent for detail-obsessed technical founders. Remembers their thinking. Kills pressure pivots and redundant thinking. Keeps them locked on the goal until it ships.
- Tagline: Never lose your best thinking again.
- $100 reservation deposit credits $100 off the $499 program (net $399). Call it refundable toward / credits toward the program.
- Program: 6-month, AI-allowance based, part-service founder-customization inside ALTERED.
- Limited founding-cohort seats at this deposit price.
- Never say pre-sale, presale, or pre-sell. Say reservation deposit / founding cohort / reserve your seat.

ICP:
- Detail-obsessed technical founders building something real.
- If they are clearly not a fit, be honest and do not force the close.

FLOW (hard order - do not skip ahead):
1. save_lead early with phone (and email if given). Stages: new → contacted → qualified → reserved (when checkout link sent) → paid | lost.
2. Diagnose briefly. Ask what they are building and where thinking slips. Do NOT mention price or deposit yet.
3. Qualify: confirm they are a founder actively building and feel the pain. Only then set status=qualified.
4. AFTER qualified: pitch mechanism, then introduce the $100 reservation deposit that credits toward $499 (net $399). Ask for the reservation.
5. On buying signal: get_checkout_link, send the URL in its own send_message bubble, save_lead status=reserved.
6. If checkout URL is missing: still save_lead, collect email, say the link will follow - never invent a URL.
7. Proof: honest founding-cohort / pre-launch framing. No fake testimonials or logos.

PRICE TIMING (critical):
- Landing page only sends people to this chat. Never assume they saw a price.
- Do not open with $100 / $499. Earn the right by qualifying first.
- Once qualified, be direct about the deposit.

OBJECTIONS:
- Price: $100 is a seat lock + credit toward $499, not a tip.
- Need to think: isolate the real blocker (fit, trust, timing), answer it, re-ask.
- Is it real / live: founding cohort reservation while the stack hardens. Deposit reserves seat + credit.
- Busy: that is the ICP. Keep the ask at $100.

FORMATTING:
- Plain text only. No markdown. No em dashes (use hyphens).
- Tight bubbles. Multiple send_message calls OK.
- start_typing before final replies after tools.
- Call done when finished. toolChoice is required.

Do not discuss Cursor agents, repo ops, or internal tooling with prospects.`;

export async function handleSalesMessage(input: {
  ctx: OperatorContext;
  chatThreadId: string;
  phone: string;
  text: string;
  outbound?: OutboundSession;
  trace?: TraceContext;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { ctx, phone, text } = input;
  const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
  const amount = depositLabel(amountCents);
  const program = programPriceLabel();
  const net = netAfterDepositLabel(amountCents);

  const thread = await ensureSalesThread(ctx, input.chatThreadId, phone);
  await saveSalesMessage(ctx, thread?.id, "inbound", text);

  // Capture lead on first engage
  await upsertSalesLead(ctx, {
    phone,
    status: "contacted",
    notes: `inbound: ${text.slice(0, 240)}`,
  });

  if (!ctx.env.OPENROUTER_API_KEY) {
    const reply =
      "Thanks for texting ALTERED. Our sales line is warming up - leave your email and we will send the founding reservation link.";
    if (input.outbound) {
      await input.outbound.send(reply);
      await saveSalesMessage(
        ctx,
        thread?.id,
        "outbound",
        input.outbound.joinedTranscript(),
      );
      return input.outbound.joinedTranscript();
    }
    return reply;
  }

  const tools = {
    send_message: tool({
      description:
        "Send one plain-text iMessage bubble to the prospect. No markdown. No em dashes.",
      inputSchema: z.object({
        text: z.string().min(1).max(1400),
      }),
      execute: async ({ text: body }) => {
        if (!input.outbound) return { ok: false, error: "No outbound" };
        return input.outbound.send(body, "reply");
      },
    }),
    start_typing: tool({
      description: "Show typing indicator before a reply.",
      inputSchema: z.object({}),
      execute: async () => {
        await input.outbound?.typing();
        return { ok: true };
      },
    }),
    save_lead: tool({
      description:
        "Upsert this prospect in Neon with funnel stage. Always use their phone.",
      inputSchema: z.object({
        email: z.string().email().optional(),
        name: z.string().optional(),
        notes: z.string().optional(),
        status: z
          .enum(["new", "contacted", "qualified", "reserved", "paid", "lost"])
          .optional(),
      }),
      execute: async (args) => {
        const row = await upsertSalesLead(ctx, {
          phone,
          email: args.email,
          name: args.name,
          notes: args.notes,
          status: args.status ?? "contacted",
        });
        return {
          ok: true,
          leadId: row?.id,
          status: row?.status,
          checkoutUrl: ctx.env.PRIMARY_CHECKOUT_URL ?? null,
        };
      },
    }),
    get_checkout_link: tool({
      description: `Return the ${amount} reservation deposit checkout URL.`,
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.env.PRIMARY_CHECKOUT_URL) {
          return {
            ok: false,
            error:
              "PRIMARY_CHECKOUT_URL not set. Collect email and continue - do not invent a link.",
            amount,
            program,
            net,
          };
        }
        return {
          ok: true,
          url: ctx.env.PRIMARY_CHECKOUT_URL,
          amount,
          program,
          net,
        };
      },
    }),
    done: tool({
      description: "End the turn after all send_message calls.",
      inputSchema: z.object({ ok: z.boolean().optional().default(true) }),
    }),
  };

  const openrouter = createOpenRouter(ctx.env);
  const modelId = chatAgentModelId(ctx.env);
  const started = Date.now();
  if (input.trace) traceLog(input.trace, "main_gen_start", { model: modelId, mode: "sales" });

  try {
    const history = await recentSalesHistory(ctx, phone);
    await generateText({
      model: openrouter.chat(modelId),
      system: [
        SALES_SYSTEM,
        `Deposit ${amount}. Program ${program}. Net after credit ${net}.`,
        `Checkout configured: ${ctx.env.PRIMARY_CHECKOUT_URL ? "yes" : "NO - collect email"}`,
        `Landing: ${ctx.env.SITE_BASE_URL ?? "https://generated.usealtered.com"}/early-access`,
        `API reserve page: ${(ctx.env.APP_BASE_URL ?? "https://generated.api.usealtered.com").replace(/\/$/, "")}/reserve`,
      ].join("\n\n"),
      messages: [...history, { role: "user" as const, content: text }],
      tools,
      toolChoice: "required",
      stopWhen: [stepCountIs(8), hasToolCall("done")],
      temperature: 0.4,
      abortSignal: input.abortSignal,
    });

    const latencyMs = Date.now() - started;
    if (input.trace) {
      traceLog(input.trace, "main_gen_done", {
        model: modelId,
        genMs: latencyMs,
        ok: true,
        mode: "sales",
      });
    }
    await recordAiEvent(ctx, {
      surface: "sales_imessage",
      threadId: thread?.id,
      phone,
      model: modelId,
      latencyMs,
      ok: true,
      meta: { mode: "sales" },
    });
  } catch (err) {
    if (input.trace) {
      traceLog(input.trace, "turn_error", {
        mode: "sales",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await recordAiEvent(ctx, {
      surface: "sales_imessage",
      threadId: thread?.id,
      phone,
      model: modelId,
      latencyMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      meta: { mode: "sales" },
    });
    throw err;
  }

  const transcript = input.outbound?.joinedTranscript() ?? "";
  if (transcript) {
    await saveSalesMessage(ctx, thread?.id, "outbound", transcript);
  }
  return transcript || "(sales turn complete)";
}

async function ensureSalesThread(
  ctx: OperatorContext,
  chatThreadId: string,
  phone: string,
) {
  if (!ctx.db) return null;
  const existing = await ctx.db.query.threads.findFirst({
    where: eq(threads.chatThreadId, chatThreadId),
  });
  if (existing) {
    // Never let a prospect thread silently become operator; if mis-tagged, leave.
    if (existing.kind === "operator") return existing;
    if (existing.kind !== "prospect") {
      const [updated] = await ctx.db
        .update(threads)
        .set({ kind: "prospect", updatedAt: new Date() })
        .where(eq(threads.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [row] = await ctx.db
    .insert(threads)
    .values({
      chatThreadId,
      phone,
      channel: "sendblue",
      kind: "prospect",
    })
    .returning();
  return row ?? null;
}

async function saveSalesMessage(
  ctx: OperatorContext,
  threadId: string | undefined,
  direction: "inbound" | "outbound",
  body: string,
) {
  const cleaned = sanitizeImessageText(body);
  if (!cleaned) return;
  if (ctx.db && threadId) {
    await ctx.db.insert(messages).values({
      threadId,
      direction,
      body: cleaned,
      isInternal: false,
    });
  }
}

async function recentSalesHistory(ctx: OperatorContext, phone: string) {
  if (!ctx.db) return [] as Array<{ role: "user" | "assistant"; content: string }>;
  const thread = await ctx.db.query.threads.findFirst({
    where: eq(threads.phone, phone),
  });
  if (!thread) return [];
  const rows = await ctx.db.query.messages.findMany({
    where: eq(messages.threadId, thread.id),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 12,
  });
  return rows
    .reverse()
    .map((r) => ({
      role: (r.direction === "inbound" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: truncateForImessage(r.body, 800),
    }));
}

async function upsertSalesLead(
  ctx: OperatorContext,
  input: {
    phone: string;
    email?: string;
    name?: string;
    notes?: string;
    status: "new" | "contacted" | "qualified" | "reserved" | "paid" | "lost";
  },
) {
  if (!ctx.db) return null;
  const amountCents = await resolveDepositAmountCents(ctx.knowledgeRoot);
  const existing = await ctx.db.query.leads.findFirst({
    where: eq(leads.phone, input.phone),
  });
  if (existing) {
    const nextStatus = input.status ?? existing.status;
    const [updated] = await ctx.db
      .update(leads)
      .set({
        email: input.email ?? existing.email,
        name: input.name ?? existing.name,
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
      source: "imessage-sales",
      phone: input.phone,
      payload: { notes: input.notes },
    });
    return updated ?? existing;
  }
  const [lead] = await ctx.db
    .insert(leads)
    .values({
      phone: input.phone,
      email: input.email,
      name: input.name,
      notes: input.notes,
      source: "imessage-sales",
      status: input.status,
      isTest: false,
      depositAmountCents: amountCents,
      depositCurrency: ctx.env.EARLY_ACCESS_DEPOSIT_CURRENCY,
    })
    .returning();
  if (lead) {
    await ctx.db.insert(leadEvents).values({
      leadId: lead.id,
      type: "created",
      toStatus: input.status,
      source: "imessage-sales",
      phone: input.phone,
      payload: { notes: input.notes },
    });
  }
  return lead ?? null;
}
