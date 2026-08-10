import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to markdown corpus (package copy, then repo root fallback). */
export function getKnowledgeRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.KNOWLEDGE_ROOT,
    path.resolve(here, "../content"),
    path.resolve(here, "../../../knowledge"),
    // Vercel Build Output function bundles knowledge at /var/task/content
    path.resolve(process.cwd(), "content"),
    path.resolve(process.cwd(), "knowledge"),
    path.resolve(process.cwd(), "../../knowledge"),
  ].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}
