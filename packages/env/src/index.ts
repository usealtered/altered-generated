import { z } from "zod";

const optionalUrl = z.string().url().optional();

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  /** redis:// URL for Chat SDK state (Upstash redis protocol URL works) */
  REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  SENDBLUE_API_KEY: z.string().optional(),
  SENDBLUE_API_SECRET: z.string().optional(),
  SENDBLUE_FROM_NUMBER: z.string().optional(),
  SENDBLUE_WEBHOOK_SECRET: z.string().optional(),
  CURSOR_API_KEY: z.string().optional(),
  /** Durable Cursor agent this iMessage bridge resumes by default */
  CURSOR_OPERATING_AGENT_ID: z.string().optional(),
  CURSOR_DEFAULT_REPO_URL: z
    .string()
    .default("https://github.com/usealtered/altered-generated"),
  CURSOR_DEFAULT_REF: z.string().default("main"),
  /** Comma-separated E.164 phones allowed to drive the operator bridge */
  OPERATOR_PHONE_ALLOWLIST: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("openai/gpt-4.1-mini"),
  APP_BASE_URL: z.string().url().optional(),
  EARLY_ACCESS_DEPOSIT_AMOUNT_CENTS: z.coerce.number().int().positive().default(25000),
  EARLY_ACCESS_DEPOSIT_CURRENCY: z.string().default("usd"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_EARLY_ACCESS_PRICE_ID: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;
  cached = serverEnvSchema.parse(env);
  return cached;
}

export function resetEnvCache() {
  cached = null;
}

export function parseAllowlist(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isOperatorPhone(phone: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = phone.replace(/\s+/g, "");
  return allowlist.some((entry) => entry.replace(/\s+/g, "") === normalized);
}

export function missingCriticalEnv(env: ServerEnv = getServerEnv()): string[] {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.SENDBLUE_API_KEY) missing.push("SENDBLUE_API_KEY");
  if (!env.SENDBLUE_API_SECRET) missing.push("SENDBLUE_API_SECRET");
  if (!env.SENDBLUE_FROM_NUMBER) missing.push("SENDBLUE_FROM_NUMBER");
  if (!env.CURSOR_API_KEY) missing.push("CURSOR_API_KEY");
  if (!env.CURSOR_OPERATING_AGENT_ID) missing.push("CURSOR_OPERATING_AGENT_ID");
  if (!env.REDIS_URL && !env.UPSTASH_REDIS_REST_URL) {
    missing.push("REDIS_URL (or UPSTASH_REDIS_REST_URL)");
  }
  return missing;
}
