import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  index,
} from "drizzle-orm/pg-core";

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "reserved",
  "paid",
  "lost",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const cursorJobStatusEnum = pgEnum("cursor_job_status", [
  "queued",
  "running",
  "finished",
  "error",
  "cancelled",
  "busy_retry",
]);

export const memoryScopeEnum = pgEnum("memory_scope", [
  "global",
  "operator",
  "agent",
  "thread",
]);

export const cursorAgentStatusEnum = pgEnum("cursor_agent_status", [
  "active",
  "archived",
]);

export const devTaskStatusEnum = pgEnum("dev_task_status", [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const operators = pgTable("operators", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: varchar("phone", { length: 32 }).notNull().unique(),
  name: text("name"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatThreadId: text("chat_thread_id").notNull().unique(),
    channel: varchar("channel", { length: 32 }).notNull().default("sendblue"),
    phone: varchar("phone", { length: 32 }).notNull(),
    cursorAgentId: text("cursor_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("threads_phone_idx").on(t.phone)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tokens: integer("tokens"),
    embedding: jsonb("embedding"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("knowledge_path_idx").on(t.path)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 32 }),
    name: text("name"),
    company: text("company"),
    source: varchar("source", { length: 64 }).notNull().default("web"),
    /** Funnel stage: new → contacted → qualified → reserved → paid | lost */
    status: leadStatusEnum("status").notNull().default("new"),
    notes: text("notes"),
    utm: jsonb("utm"),
    depositAmountCents: integer("deposit_amount_cents"),
    depositCurrency: varchar("deposit_currency", { length: 8 }),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("leads_email_idx").on(t.email),
    index("leads_phone_idx").on(t.phone),
    index("leads_status_idx").on(t.status),
  ],
);

/** Append-only lead funnel / sales movement log. */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    fromStatus: leadStatusEnum("from_status"),
    toStatus: leadStatusEnum("to_status"),
    source: varchar("source", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lead_events_lead_idx").on(t.leadId),
    index("lead_events_type_idx").on(t.type),
    index("lead_events_created_idx").on(t.createdAt),
  ],
);

/**
 * Append-only AI usage / cost events.
 * costMicros = estimated USD * 1_000_000 (compare approaches over time).
 */
export const aiEvents = pgTable(
  "ai_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    surface: varchar("surface", { length: 64 }).notNull().default("ops_imessage"),
    threadId: uuid("thread_id"),
    phone: varchar("phone", { length: 32 }),
    leadId: uuid("lead_id"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costMicros: integer("cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms"),
    toolsCalled: jsonb("tools_called"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_events_created_idx").on(t.createdAt),
    index("ai_events_surface_idx").on(t.surface),
    index("ai_events_phone_idx").on(t.phone),
    index("ai_events_lead_idx").on(t.leadId),
  ],
);

export const cursorJobs = pgTable(
  "cursor_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    agentId: text("agent_id").notNull(),
    runId: text("run_id"),
    prompt: text("prompt").notNull(),
    status: cursorJobStatusEnum("status").notNull().default("queued"),
    resultSummary: text("result_summary"),
    notifyPhone: varchar("notify_phone", { length: 32 }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cursor_jobs_agent_idx").on(t.agentId),
    index("cursor_jobs_status_idx").on(t.status),
  ],
);

/**
 * Dynamic Cloud Agent registry — prefer workstream binding over a single env agent id.
 * Related tasks share one agent chat; unrelated workstreams get a new agent.
 */
export const cursorAgents = pgTable(
  "cursor_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id").notNull().unique(),
    name: text("name"),
    workstream: varchar("workstream", { length: 128 }).notNull().default("general"),
    status: cursorAgentStatusEnum("status").notNull().default("active"),
    url: text("url"),
    lastRunId: text("last_run_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cursor_agents_workstream_idx").on(t.workstream),
    index("cursor_agents_status_idx").on(t.status),
  ],
);

/** Development tasks tracked in DB so chats can restart without losing open work. */
export const devTasks = pgTable(
  "dev_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    status: devTaskStatusEnum("status").notNull().default("open"),
    workstream: varchar("workstream", { length: 128 }).notNull().default("general"),
    agentId: text("agent_id"),
    priority: integer("priority").notNull().default(0),
    notes: text("notes"),
    source: varchar("source", { length: 64 }).notNull().default("imessage"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("dev_tasks_status_idx").on(t.status),
    index("dev_tasks_workstream_idx").on(t.workstream),
    index("dev_tasks_agent_idx").on(t.agentId),
  ],
);

export const dailyMetrics = pgTable("daily_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  day: varchar("day", { length: 10 }).notNull().unique(),
  leadsCreated: integer("leads_created").notNull().default(0),
  depositsCount: integer("deposits_count").notNull().default(0),
  depositsCents: integer("deposits_cents").notNull().default(0),
  imessageInbound: integer("imessage_inbound").notNull().default(0),
  cursorRuns: integer("cursor_runs").notNull().default(0),
  aiCalls: integer("ai_calls").notNull().default(0),
  aiInputTokens: integer("ai_input_tokens").notNull().default(0),
  aiOutputTokens: integer("ai_output_tokens").notNull().default(0),
  aiCostMicros: integer("ai_cost_micros").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Durable key/value settings (survives agent ID changes). */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Long-term memory independent of Cursor agent compaction.
 * Use when switching agents or after compaction loses context.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: memoryScopeEnum("scope").notNull().default("global"),
    scopeId: varchar("scope_id", { length: 128 }),
    key: varchar("key", { length: 256 }),
    content: text("content").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("memories_scope_idx").on(t.scope, t.scopeId),
    index("memories_key_idx").on(t.key),
  ],
);
