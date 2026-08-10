import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl =
  process.env.DATABASE_URL ?? process.env.SHARED_STORAGE_DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL (or SHARED_STORAGE_DATABASE_URL) is required");
  process.exit(1);
}

const sql = neon(databaseUrl);
const drizzleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

await sql`
  CREATE TABLE IF NOT EXISTS "__altered_migrations" (
    id text PRIMARY KEY,
    applied_at timestamptz DEFAULT now() NOT NULL
  )
`;

const appliedRows = await sql`SELECT id FROM "__altered_migrations"`;
const applied = new Set(appliedRows.map((r) => String(r.id)));

const files = (await readdir(drizzleDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const id = file.replace(/\.sql$/, "");
  if (applied.has(id)) {
    console.log(`skip ${id}`);
    continue;
  }
  const body = await readFile(path.join(drizzleDir, file), "utf8");
  // neon http driver runs one statement; split on breakpoints / semicolons carefully
  const statements = body
    .split(/-->\s*statement-breakpoint|;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql`INSERT INTO "__altered_migrations" (id) VALUES (${id})`;
  console.log(`applied ${id}`);
}

console.log("migrations complete");
