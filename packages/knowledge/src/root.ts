import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to markdown corpus (package copy, then repo root fallback). */
export function getKnowledgeRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../content"),
    path.resolve(here, "../../../knowledge"),
    path.resolve(process.cwd(), "knowledge"),
    path.resolve(process.cwd(), "../../knowledge"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}
