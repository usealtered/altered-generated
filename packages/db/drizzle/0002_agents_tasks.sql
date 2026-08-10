CREATE TYPE "public"."cursor_agent_status" AS ENUM('active', 'archived');
CREATE TYPE "public"."dev_task_status" AS ENUM('open', 'in_progress', 'blocked', 'done', 'cancelled');

CREATE TABLE IF NOT EXISTS "cursor_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" text NOT NULL UNIQUE,
  "name" text,
  "workstream" varchar(128) DEFAULT 'general' NOT NULL,
  "status" "cursor_agent_status" DEFAULT 'active' NOT NULL,
  "url" text,
  "last_run_id" text,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cursor_agents_workstream_idx" ON "cursor_agents" ("workstream");
CREATE INDEX IF NOT EXISTS "cursor_agents_status_idx" ON "cursor_agents" ("status");

CREATE TABLE IF NOT EXISTS "dev_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" "dev_task_status" DEFAULT 'open' NOT NULL,
  "workstream" varchar(128) DEFAULT 'general' NOT NULL,
  "agent_id" text,
  "priority" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "source" varchar(64) DEFAULT 'imessage' NOT NULL,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "dev_tasks_status_idx" ON "dev_tasks" ("status");
CREATE INDEX IF NOT EXISTS "dev_tasks_workstream_idx" ON "dev_tasks" ("workstream");
CREATE INDEX IF NOT EXISTS "dev_tasks_agent_idx" ON "dev_tasks" ("agent_id");

-- Soft default key rename compat: copy operating_agent_id → active_agent_id if present
INSERT INTO "settings" ("key", "value", "updated_at")
SELECT 'active_agent_id', "value", now()
FROM "settings"
WHERE "key" = 'operating_agent_id'
ON CONFLICT ("key") DO NOTHING;
