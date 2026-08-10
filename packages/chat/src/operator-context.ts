import {
  createCursorClient,
  type CursorClient,
} from "@altered/cursor-bridge";
import { createDb, type Database } from "@altered/db";
import { getServerEnv, type ServerEnv } from "@altered/env";
import { getKnowledgeRoot } from "@altered/knowledge";
import { Client as QStashClient } from "@upstash/qstash";
import { Redis } from "@upstash/redis";

export type OperatorContext = {
  env: ServerEnv;
  db?: Database;
  redis?: Redis;
  cursor?: CursorClient;
  qstash?: QStashClient;
  knowledgeRoot: string;
};

export function createOperatorContext(
  overrides: Partial<OperatorContext> = {},
): OperatorContext {
  const env = overrides.env ?? getServerEnv();
  const ctx: OperatorContext = {
    env,
    knowledgeRoot: overrides.knowledgeRoot ?? getKnowledgeRoot(),
  };

  if (env.DATABASE_URL) ctx.db = overrides.db ?? createDb(env.DATABASE_URL);
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    ctx.redis =
      overrides.redis ??
      new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });
  }
  if (env.CURSOR_API_KEY) {
    ctx.cursor = overrides.cursor ?? createCursorClient(env.CURSOR_API_KEY);
  }
  if (env.QSTASH_TOKEN) {
    ctx.qstash =
      overrides.qstash ??
      new QStashClient({
        token: env.QSTASH_TOKEN,
        ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}),
      });
  }
  return ctx;
}
