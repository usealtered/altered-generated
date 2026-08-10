export type KnowledgeDoc = {
  path: string;
  title: string;
  content: string;
};

export type KnowledgeChunk = KnowledgeDoc & {
  id: string;
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export function parseMarkdownDoc(path: string, raw: string): KnowledgeDoc {
  let body = raw;
  let title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  const fm = raw.match(FRONTMATTER);
  if (fm?.[1]) {
    body = raw.slice(fm[0].length);
    const titleLine = fm[1].split("\n").find((l) => l.startsWith("title:"));
    if (titleLine) {
      title = titleLine.replace(/^title:\s*/, "").replace(/^["']|["']$/g, "").trim();
    }
  }
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) title = h1[1].trim();
  return { path, title, content: body.trim() };
}

export function chunkMarkdown(doc: KnowledgeDoc, maxChars = 1200): KnowledgeChunk[] {
  const sections = doc.content.split(/\n(?=#{1,3}\s)/g).filter((s) => s.trim());
  const chunks: KnowledgeChunk[] = [];
  let buffer = "";
  let idx = 0;

  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({
      id: `${doc.path}#${idx++}`,
      path: doc.path,
      title: doc.title,
      content: buffer.trim(),
    });
    buffer = "";
  };

  for (const section of sections.length ? sections : [doc.content]) {
    if ((buffer + "\n\n" + section).length > maxChars && buffer) {
      flush();
    }
    buffer = buffer ? `${buffer}\n\n${section}` : section;
    if (buffer.length >= maxChars) flush();
  }
  flush();
  return chunks;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function scoreChunk(query: string, chunk: KnowledgeChunk): number {
  const q = new Set(tokenize(query));
  if (q.size === 0) return 0;
  const tokens = tokenize(`${chunk.title} ${chunk.content}`);
  let hits = 0;
  for (const t of tokens) {
    if (q.has(t)) hits += 1;
  }
  const titleBonus = tokenize(chunk.title).some((t) => q.has(t)) ? 2 : 0;
  return hits + titleBonus;
}

export function retrieveLocal(
  query: string,
  chunks: KnowledgeChunk[],
  limit = 5,
): Array<KnowledgeChunk & { score: number }> {
  return chunks
    .map((c) => ({ ...c, score: scoreChunk(query, c) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
