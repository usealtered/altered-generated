CREATE TABLE IF NOT EXISTS "analytics_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day" varchar(10) NOT NULL,
  "kind" varchar(32) DEFAULT 'daily' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_snapshots_day_kind_uidx" ON "analytics_snapshots" ("day", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_snapshots_created_idx" ON "analytics_snapshots" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid,
  "phone" varchar(32),
  "kind" varchar(32) DEFAULT 'hourly_tone' NOT NULL,
  "severity" varchar(16) DEFAULT 'info' NOT NULL,
  "findings" text NOT NULL,
  "missed_opportunity" boolean DEFAULT false NOT NULL,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_reviews_created_idx" ON "conversation_reviews" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_reviews_phone_idx" ON "conversation_reviews" ("phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_reviews_severity_idx" ON "conversation_reviews" ("severity");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_gen_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" varchar(32) DEFAULT 'x_post' NOT NULL,
  "hook" text NOT NULL,
  "body" text NOT NULL,
  "cta" text,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_gen_drafts_status_idx" ON "lead_gen_drafts" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_gen_drafts_created_idx" ON "lead_gen_drafts" ("created_at");
