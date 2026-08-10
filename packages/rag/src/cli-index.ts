import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadKnowledgeDir } from "./load-knowledge";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../knowledge",
);

const chunks = await loadKnowledgeDir(root);
console.log(`Indexed ${chunks.length} chunks from ${root}`);
for (const c of chunks.slice(0, 10)) {
  console.log(`- ${c.id} (${c.content.length} chars)`);
}
