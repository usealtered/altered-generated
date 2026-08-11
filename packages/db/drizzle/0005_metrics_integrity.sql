CREATE TYPE "public"."thread_kind" AS ENUM('operator', 'prospect');
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "kind" "thread_kind" DEFAULT 'prospect' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_kind_idx" ON "threads" ("kind");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_internal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_internal_idx" ON "messages" ("is_internal");
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_is_test_idx" ON "leads" ("is_test");
--> statement-breakpoint
-- Seed Riley as operator (allowlist phone).
INSERT INTO "operators" ("phone", "name", "active")
VALUES ('+12368370221', 'Riley', true)
ON CONFLICT ("phone") DO UPDATE SET "active" = true, "name" = COALESCE("operators"."name", EXCLUDED."name");
--> statement-breakpoint
-- Backfill threads: known operator phones → operator kind.
UPDATE "threads"
SET "kind" = 'operator'
WHERE "phone" IN (SELECT "phone" FROM "operators" WHERE "active" = true)
   OR "phone" = '+12368370221';
--> statement-breakpoint
-- Backfill messages from operator threads.
UPDATE "messages" m
SET "is_internal" = true
FROM "threads" t
WHERE m."thread_id" = t."id" AND t."kind" = 'operator';
--> statement-breakpoint
-- Backfill test/audit leads (no real prospect phone / audit sources).
UPDATE "leads"
SET "is_test" = true
WHERE "is_test" = false
  AND (
    "source" ILIKE '%audit%'
    OR "source" ILIKE '%test%'
    OR "source" ILIKE '%smoke%'
    OR "phone" IN (SELECT "phone" FROM "operators" WHERE "active" = true)
    OR "phone" = '+12368370221'
  );
