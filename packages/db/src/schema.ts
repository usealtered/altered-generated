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

/** operator = Riley/ops copilot chat; prospect = real sales DMs */
export const threadKindEnum = pgEnum("thread_kind", ["operator", "prospect"]);

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
    /** operator = internal ops; prospect = real lead funnel */
    kind: threadKindEnum("kind").notNull().default("prospect"),
    phone: varchar("phone", { length: 32 }).notNull(),
    cursorAgentId: text("cursor_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("threads_phone_idx").on(t.phone),
    index("threads_kind_idx").on(t.kind),
  ],
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
    /** True for operator/ops chat; never merge into prospect funnel metrics. */
    isInternal: boolean("is_internal").notNull().default(false),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("messages_thread_idx").on(t.threadId),
    index("messages_internal_idx").on(t.isInternal),
  ],
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
    /** Audit/dev/test rows — excluded from prospect funnel metrics. */
    isTest: boolean("is_test").notNull().default(false),
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
    index("leads_is_test_idx").on(t.isTest),
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

/** Social post idea lifecycle for HITL-minimal outbound pipeline. */
export const postIdeaStatusEnum = pgEnum("post_idea_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
  "cancelled",
]);

/** Batch of ideas queued for one-tap Riley approval. */
export const postBatches = pgTable(
  "post_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    channelHint: varchar("channel_hint", { length: 64 }).notNull().default("twitter"),
    ideaCount: integer("idea_count").notNull().default(0),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("post_batches_status_idx").on(t.status),
    index("post_batches_created_idx").on(t.createdAt),
  ],
);

export const postIdeas = pgTable(
  "post_ideas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").references(() => postBatches.id, {
      onDelete: "set null",
    }),
    /** 1-based index within the batch for APPROVE 1 3 replies. */
    batchIndex: integer("batch_index"),
    status: postIdeaStatusEnum("status").notNull().default("draft"),
    platform: varchar("platform", { length: 32 }).notNull().default("twitter"),
    hook: text("hook"),
    body: text("body").notNull(),
    cta: text("cta"),
    /** Full post text that will be published (body + CTA + UTM landing). */
    content: text("content").notNull(),
    landingUrl: text("landing_url"),
    utm: jsonb("utm"),
    zernioPostId: text("zernio_post_id"),
    zernioPlatformUrl: text("zernio_platform_url"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    error: text("error"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("post_ideas_status_idx").on(t.status),
    index("post_ideas_batch_idx").on(t.batchId),
    index("post_ideas_platform_idx").on(t.platform),
    index("post_ideas_created_idx").on(t.createdAt),
  ],
);

/** Append-only log for generate / approve / publish outcomes. */
export const postEvents = pgTable(
  "post_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postIdeaId: uuid("post_idea_id").references(() => postIdeas.id, {
      onDelete: "set null",
    }),
    batchId: uuid("batch_id").references(() => postBatches.id, {
      onDelete: "set null",
    }),
    type: varchar("type", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("post_events_idea_idx").on(t.postIdeaId),
    index("post_events_batch_idx").on(t.batchId),
    index("post_events_type_idx").on(t.type),
    index("post_events_created_idx").on(t.createdAt),
  ],
);

/** Daily / hourly analytics snapshots for the ops dashboard (never blend prospect+ops). */
export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    day: varchar("day", { length: 10 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull().default("daily"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("analytics_snapshots_created_idx").on(t.createdAt),
    index("analytics_snapshots_day_kind_idx").on(t.day, t.kind),
  ],
);

/** Hourly Koa tone / missed-opportunity review findings. */
export const conversationReviews = pgTable(
  "conversation_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id"),
    phone: varchar("phone", { length: 32 }),
    kind: varchar("kind", { length: 32 }).notNull().default("hourly_tone"),
    severity: varchar("severity", { length: 16 }).notNull().default("info"),
    findings: text("findings").notNull(),
    missedOpportunity: boolean("missed_opportunity").notNull().default(false),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("conversation_reviews_created_idx").on(t.createdAt),
    index("conversation_reviews_phone_idx").on(t.phone),
    index("conversation_reviews_severity_idx").on(t.severity),
  ],
);

/** Proactive lead-gen drafts (posts/DMs) from the standing cadence sweep. */
export const leadGenDrafts = pgTable(
  "lead_gen_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: varchar("channel", { length: 32 }).notNull().default("x_post"),
    hook: text("hook").notNull(),
    body: text("body").notNull(),
    cta: text("cta"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lead_gen_drafts_status_idx").on(t.status),
    index("lead_gen_drafts_created_idx").on(t.createdAt),
  ],
);
