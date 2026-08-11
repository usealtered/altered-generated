CREATE TYPE "public"."post_idea_status" AS ENUM(
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'publishing',
  'published',
  'failed',
  'cancelled'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "channel_hint" varchar(64) DEFAULT 'twitter' NOT NULL,
  "idea_count" integer DEFAULT 0 NOT NULL,
  "notified_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_batches_status_idx" ON "post_batches" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_batches_created_idx" ON "post_batches" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_ideas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid REFERENCES "post_batches"("id") ON DELETE SET NULL,
  "batch_index" integer,
  "status" "post_idea_status" DEFAULT 'draft' NOT NULL,
  "platform" varchar(32) DEFAULT 'twitter' NOT NULL,
  "hook" text,
  "body" text NOT NULL,
  "cta" text,
  "content" text NOT NULL,
  "landing_url" text,
  "utm" jsonb,
  "zernio_post_id" text,
  "zernio_platform_url" text,
  "scheduled_for" timestamp with time zone,
  "published_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "error" text,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_ideas_status_idx" ON "post_ideas" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_ideas_batch_idx" ON "post_ideas" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_ideas_platform_idx" ON "post_ideas" ("platform");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_ideas_created_idx" ON "post_ideas" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "post_idea_id" uuid REFERENCES "post_ideas"("id") ON DELETE SET NULL,
  "batch_id" uuid REFERENCES "post_batches"("id") ON DELETE SET NULL,
  "type" varchar(64) NOT NULL,
  "source" varchar(64),
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_events_idea_idx" ON "post_events" ("post_idea_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_events_batch_idx" ON "post_events" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_events_type_idx" ON "post_events" ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_events_created_idx" ON "post_events" ("created_at");
