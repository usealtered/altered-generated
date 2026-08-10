CREATE TABLE IF NOT EXISTS "ai_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surface" varchar(64) DEFAULT 'ops_imessage' NOT NULL,
  "thread_id" uuid,
  "phone" varchar(32),
  "lead_id" uuid,
  "model" text,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer,
  "tools_called" jsonb,
  "ok" boolean DEFAULT true NOT NULL,
  "error" text,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_events_created_idx" ON "ai_events" ("created_at");
CREATE INDEX IF NOT EXISTS "ai_events_surface_idx" ON "ai_events" ("surface");
CREATE INDEX IF NOT EXISTS "ai_events_phone_idx" ON "ai_events" ("phone");
CREATE INDEX IF NOT EXISTS "ai_events_lead_idx" ON "ai_events" ("lead_id");

CREATE TABLE IF NOT EXISTS "lead_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "type" varchar(64) NOT NULL,
  "from_status" "lead_status",
  "to_status" "lead_status",
  "source" varchar(64),
  "phone" varchar(32),
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "lead_events_lead_idx" ON "lead_events" ("lead_id");
CREATE INDEX IF NOT EXISTS "lead_events_type_idx" ON "lead_events" ("type");
CREATE INDEX IF NOT EXISTS "lead_events_created_idx" ON "lead_events" ("created_at");

ALTER TABLE "daily_metrics" ADD COLUMN IF NOT EXISTS "ai_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "daily_metrics" ADD COLUMN IF NOT EXISTS "ai_input_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "daily_metrics" ADD COLUMN IF NOT EXISTS "ai_output_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "daily_metrics" ADD COLUMN IF NOT EXISTS "ai_cost_micros" integer DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS "leads_phone_idx" ON "leads" ("phone");
