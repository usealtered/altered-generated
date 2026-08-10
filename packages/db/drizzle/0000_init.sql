CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'reserved', 'paid', 'lost');
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');
CREATE TYPE "public"."cursor_job_status" AS ENUM('queued', 'running', 'finished', 'error', 'cancelled', 'busy_retry');

CREATE TABLE "operators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" varchar(32) NOT NULL UNIQUE,
  "name" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chat_thread_id" text NOT NULL UNIQUE,
  "channel" varchar(32) DEFAULT 'sendblue' NOT NULL,
  "phone" varchar(32) NOT NULL,
  "cursor_agent_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "threads_phone_idx" ON "threads" ("phone");

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "threads"("id") ON DELETE cascade,
  "direction" "message_direction" NOT NULL,
  "body" text NOT NULL,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "messages_thread_idx" ON "messages" ("thread_id");

CREATE TABLE "knowledge_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "path" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "tokens" integer,
  "embedding" jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "knowledge_path_idx" ON "knowledge_chunks" ("path");

CREATE TABLE "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320),
  "phone" varchar(32),
  "name" text,
  "company" text,
  "source" varchar(64) DEFAULT 'web' NOT NULL,
  "status" "lead_status" DEFAULT 'new' NOT NULL,
  "notes" text,
  "utm" jsonb,
  "deposit_amount_cents" integer,
  "deposit_currency" varchar(8),
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "reserved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "leads_email_idx" ON "leads" ("email");
CREATE INDEX "leads_status_idx" ON "leads" ("status");

CREATE TABLE "cursor_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid REFERENCES "threads"("id") ON DELETE set null,
  "agent_id" text NOT NULL,
  "run_id" text,
  "prompt" text NOT NULL,
  "status" "cursor_job_status" DEFAULT 'queued' NOT NULL,
  "result_summary" text,
  "notify_phone" varchar(32),
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "cursor_jobs_agent_idx" ON "cursor_jobs" ("agent_id");
CREATE INDEX "cursor_jobs_status_idx" ON "cursor_jobs" ("status");

CREATE TABLE "daily_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day" varchar(10) NOT NULL UNIQUE,
  "leads_created" integer DEFAULT 0 NOT NULL,
  "deposits_count" integer DEFAULT 0 NOT NULL,
  "deposits_cents" integer DEFAULT 0 NOT NULL,
  "imessage_inbound" integer DEFAULT 0 NOT NULL,
  "cursor_runs" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
