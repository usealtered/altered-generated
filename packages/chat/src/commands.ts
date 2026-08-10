export type Command =
  | { type: "help" }
  | { type: "status" }
  | { type: "ask"; query: string }
  | { type: "cursor"; prompt: string; mode?: "agent" | "plan" }
  | { type: "new"; prompt: string }
  | { type: "lead"; text: string }
  | { type: "metrics" }
  | { type: "remember"; text: string }
  | { type: "link"; agentId: string }
  | { type: "raw"; text: string };

const HELP = `ALTERED ops bridge
Commands:
• status — operating Cursor agent status
• ask <q> — RAG answer from knowledge/
• cursor <task> — resume operating agent (default)
• plan <task> — same, Plan mode
• new <task> — spawn a new Cursor agent
• link <bc-...> — bind this thread to an agent
• lead <email|phone|note> — capture a lead
• metrics — today's deposit progress
• remember <note> — store ops note into knowledge (queued)
• help — this menu

Plain texts (no command) go to the operating Cursor agent.`;

export function helpText() {
  return HELP;
}

export function parseCommand(input: string): Command {
  const text = input.trim();
  if (!text) return { type: "help" };

  const lower = text.toLowerCase();
  if (lower === "help" || lower === "?" || lower === "commands") {
    return { type: "help" };
  }
  if (lower === "status" || lower === "s") return { type: "status" };
  if (lower === "metrics" || lower === "m" || lower === "goal") {
    return { type: "metrics" };
  }

  const ask = text.match(/^(ask|rag)\s+([\s\S]+)/i);
  if (ask?.[2]) return { type: "ask", query: ask[2].trim() };

  const plan = text.match(/^plan\s+([\s\S]+)/i);
  if (plan?.[1]) return { type: "cursor", prompt: plan[1].trim(), mode: "plan" };

  const cursor = text.match(/^(cursor|do|run)\s+([\s\S]+)/i);
  if (cursor?.[2]) return { type: "cursor", prompt: cursor[2].trim() };

  const neu = text.match(/^(new|spawn)\s+([\s\S]+)/i);
  if (neu?.[2]) return { type: "new", prompt: neu[2].trim() };

  const link = text.match(/^link\s+(bc-[a-z0-9-]+)/i);
  if (link?.[1]) return { type: "link", agentId: link[1] };

  const lead = text.match(/^lead\s+([\s\S]+)/i);
  if (lead?.[1]) return { type: "lead", text: lead[1].trim() };

  const remember = text.match(/^(remember|note)\s+([\s\S]+)/i);
  if (remember?.[2]) return { type: "remember", text: remember[2].trim() };

  // Default: forward to Cursor operating agent
  return { type: "cursor", prompt: text };
}

export function extractLeadFields(text: string): {
  email?: string;
  phone?: string;
  notes?: string;
} {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/[^\d+]/g, "");
  const notes = text
    .replace(email ?? "", "")
    .replace(phone ?? "", "")
    .trim();
  return {
    email,
    phone,
    notes: notes || undefined,
  };
}
