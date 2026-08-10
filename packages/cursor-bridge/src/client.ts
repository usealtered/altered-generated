import { z } from "zod";

const BASE_URL = "https://api.cursor.com/v1";

const runSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  status: z.enum([
    "CREATING",
    "RUNNING",
    "FINISHED",
    "ERROR",
    "CANCELLED",
    "EXPIRED",
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
  durationMs: z.number().optional(),
  result: z.string().optional(),
  git: z
    .object({
      branches: z
        .array(
          z.object({
            repoUrl: z.string(),
            branch: z.string().optional(),
            prUrl: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  url: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  latestRunId: z.string().optional(),
});

export type CursorRun = z.infer<typeof runSchema>;
export type CursorAgent = z.infer<typeof agentSchema>;

export class CursorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "CursorApiError";
  }

  get isBusy() {
    return this.status === 409;
  }
}

export class CursorClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = BASE_URL,
  ) {}

  private authHeader() {
    const token = Buffer.from(`${this.apiKey}:`).toString("base64");
    return `Basic ${token}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!res.ok) {
      throw new CursorApiError(
        `Cursor API ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`,
        res.status,
        json,
      );
    }

    if (!schema) return json as T;
    return schema.parse(json);
  }

  async getAgent(agentId: string) {
    return this.request(`/agents/${agentId}`, {}, agentSchema);
  }

  async listAgents(limit = 20) {
    return this.request(
      `/agents?limit=${limit}`,
      {},
      z.object({ items: z.array(agentSchema), nextCursor: z.string().optional() }),
    );
  }

  async createAgent(input: {
    prompt: string;
    repoUrl: string;
    startingRef?: string;
    name?: string;
    autoCreatePR?: boolean;
    workOnCurrentBranch?: boolean;
  }) {
    return this.request(
      "/agents",
      {
        method: "POST",
        body: JSON.stringify({
          prompt: { text: input.prompt },
          name: input.name,
          repos: [
            {
              url: input.repoUrl,
              startingRef: input.startingRef ?? "main",
            },
          ],
          autoCreatePR: input.autoCreatePR ?? true,
          workOnCurrentBranch: input.workOnCurrentBranch ?? false,
        }),
      },
      z.object({
        agent: agentSchema,
        run: runSchema,
      }),
    );
  }

  async createRun(agentId: string, prompt: string, mode?: "agent" | "plan") {
    return this.request(
      `/agents/${agentId}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          prompt: { text: prompt },
          ...(mode ? { mode } : {}),
        }),
      },
      z.object({ run: runSchema }),
    );
  }

  async getRun(agentId: string, runId: string) {
    return this.request(`/agents/${agentId}/runs/${runId}`, {}, runSchema);
  }

  async listRuns(agentId: string, limit = 10) {
    return this.request(
      `/agents/${agentId}/runs?limit=${limit}`,
      {},
      z.object({ items: z.array(runSchema), nextCursor: z.string().optional() }),
    );
  }

  async cancelRun(agentId: string, runId: string) {
    return this.request(
      `/agents/${agentId}/runs/${runId}/cancel`,
      { method: "POST" },
      runSchema.partial(),
    );
  }
}

export function createCursorClient(apiKey: string) {
  return new CursorClient(apiKey);
}

export function truncateForImessage(text: string, max = 1400): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export function formatRunStatus(run: CursorRun): string {
  const parts = [`status=${run.status}`];
  if (run.durationMs) parts.push(`duration=${Math.round(run.durationMs / 1000)}s`);
  const pr = run.git?.branches?.find((b) => b.prUrl)?.prUrl;
  if (pr) parts.push(`pr=${pr}`);
  if (run.result) parts.push(`result=${truncateForImessage(run.result, 600)}`);
  return parts.join(" | ");
}
