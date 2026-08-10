CREATE TYPE "public"."memory_scope" AS ENUM('global', 'operator', 'agent', 'thread');

CREATE TABLE IF NOT EXISTS "settings" (
  "key" varchar(128) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" "memory_scope" DEFAULT 'global' NOT NULL,
  "scope_id" varchar(128),
  "key" varchar(256),
  "content" text NOT NULL,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "memories_scope_idx" ON "memories" ("scope", "scope_id");
CREATE INDEX IF NOT EXISTS "memories_key_idx" ON "memories" ("key");
