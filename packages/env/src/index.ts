import { z } from "zod";

/** Treat "", null as unset so Vercel empty env vars don't fail Zod. */
const emptyToUndefined = (value: unknown) =>
  value === "" || value === null || value === undefined ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url().optional(),
);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalString,

  /** redis:// / rediss:// for Chat SDK state (Upstash redis protocol URL) */
  REDIS_URL: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,

  QSTASH_TOKEN: optionalString,
  QSTASH_URL: optionalUrl,
  QSTASH_CURRENT_SIGNING_KEY: optionalString,
  QSTASH_NEXT_SIGNING_KEY: optionalString,

  SENDBLUE_API_KEY: optionalString,
  SENDBLUE_API_SECRET: optionalString,
  /** Agent iMessage line, e.g. +13054098546 */
  SENDBLUE_FROM_NUMBER: optionalString,
  SENDBLUE_WEBHOOK_SECRET: optionalString,

  CURSOR_API_KEY: optionalString,
  /**
   * Optional bootstrap only. Runtime uses dynamic agent IDs in DB
   * (`cursor_agents` + soft-default `settings.active_agent_id`) by workstream.
   */
  CURSOR_OPERATING_AGENT_ID: optionalString,
  CURSOR_DEFAULT_REPO_URL: z
    .string()
    .default("https://github.com/usealtered/altered-generated"),
  CURSOR_DEFAULT_REF: z.string().default("main"),

  /** Comma-separated E.164 phones allowed to drive the operator bridge */
  OPERATOR_PHONE_ALLOWLIST: optionalString,

  /** OpenRouter for AI SDK tool-calling operator */
  OPENROUTER_API_KEY: optionalString,
  CHAT_AGENT_MODEL_ID: z.string().default("anthropic/claude-sonnet-5"),

  /** Public API origin, e.g. https://generated.api.usealtered.com */
  APP_BASE_URL: optionalUrl,
  /** Public site origin, e.g. https://generated.usealtered.com */
  SITE_BASE_URL: optionalUrl,

  EARLY_ACCESS_DEPOSIT_CURRENCY: z.string().default("usd"),
  /** Static Stripe Payment Link / Checkout URL — optional until offer locked */
  PRIMARY_CHECKOUT_URL: optionalUrl,
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

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function parseAllowlist(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((p) => normalizePhone(p.trim()))
    .filter(Boolean);
}

export function isOperatorPhone(phone: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = normalizePhone(phone);
  return allowlist.some((entry) => normalizePhone(entry) === normalized);
}

export function missingCriticalEnv(env: ServerEnv = getServerEnv()): string[] {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.SENDBLUE_API_KEY) missing.push("SENDBLUE_API_KEY");
  if (!env.SENDBLUE_API_SECRET) missing.push("SENDBLUE_API_SECRET");
  if (!env.SENDBLUE_FROM_NUMBER) missing.push("SENDBLUE_FROM_NUMBER");
  if (!env.CURSOR_API_KEY) missing.push("CURSOR_API_KEY");
  if (!env.OPENROUTER_API_KEY) missing.push("OPENROUTER_API_KEY");
  if (!env.REDIS_URL) missing.push("REDIS_URL");
  if (!env.APP_BASE_URL) missing.push("APP_BASE_URL");
  return missing;
}
