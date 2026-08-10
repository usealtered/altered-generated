import { retrieveLocal, type KnowledgeChunk } from "./chunk";

export type RagAnswer = {
  answer: string;
  citations: Array<{ path: string; title: string; score: number }>;
};

function formatLocalAnswer(
  query: string,
  hits: Array<KnowledgeChunk & { score: number }>,
) {
  const top = hits[0]!;
  const extras = hits
    .slice(1, 3)
    .map((h) => `• ${h.title}`)
    .join("\n");
  return [
    `Q: ${query}`,
    "",
    top.content.slice(0, 900),
    extras ? `\nAlso: \n${extras}` : "",
  ]
    .join("\n")
    .trim();
}

export async function answerWithRag(opts: {
  query: string;
  chunks: KnowledgeChunk[];
  modelId?: string;
  hasLlm: boolean;
  openAiApiKey?: string;
}): Promise<RagAnswer> {
  const hits = retrieveLocal(opts.query, opts.chunks, 5);
  const citations = hits.map((h) => ({
    path: h.path,
    title: h.title,
    score: h.score,
  }));

  if (hits.length === 0) {
    return {
      answer:
        "No matching knowledge yet. Add notes under knowledge/ or ask me to store a decision.",
      citations,
    };
  }

  if (!opts.hasLlm || !opts.openAiApiKey) {
    return {
      answer: formatLocalAnswer(opts.query, hits),
      citations,
    };
  }

  try {
    const [{ generateText }, { createOpenAI }] = await Promise.all([
      import("ai"),
      import("@ai-sdk/openai"),
    ]);
    const openai = createOpenAI({ apiKey: opts.openAiApiKey });
    const modelName = (opts.modelId ?? "gpt-4.1-mini").replace(/^openai\//, "");
    const context = hits
      .map((h, i) => `[${i + 1}] ${h.title} (${h.path})\n${h.content}`)
      .join("\n\n---\n\n");
    const { text } = await generateText({
      model: openai(modelName),
      system:
        "You are the ALTERED operator copilot. Answer briefly for iMessage. Use only provided context. Prefer concrete next actions for early-access deposit revenue.",
      prompt: `Context:\n${context}\n\nQuestion: ${opts.query}`,
    });
    return { answer: text.trim(), citations };
  } catch {
    return {
      answer: formatLocalAnswer(opts.query, hits),
      citations,
    };
  }
}
