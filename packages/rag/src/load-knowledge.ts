import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chunkMarkdown, parseMarkdownDoc, type KnowledgeChunk } from "./chunk";

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

export async function loadKnowledgeDir(
  knowledgeRoot: string,
): Promise<KnowledgeChunk[]> {
  const files = await walkMarkdown(knowledgeRoot);
  const chunks: KnowledgeChunk[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const rel = path.relative(knowledgeRoot, file).replace(/\\/g, "/");
    const doc = parseMarkdownDoc(rel, raw);
    chunks.push(...chunkMarkdown(doc));
  }
  return chunks;
}
