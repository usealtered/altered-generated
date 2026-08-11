import { Redis } from "@upstash/redis";
import { getServerEnv } from "@altered/env";

const MEMORY = new Map<string, number>();
const TTL_SEC = 600;

let redisSingleton: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisSingleton !== undefined) return redisSingleton;
  try {
    const env = getServerEnv();
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      redisSingleton = null;
      return null;
    }
    redisSingleton = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redisSingleton;
  } catch {
    redisSingleton = null;
    return null;
  }
}

function key(messageHandle: string) {
  return `trace:wh:${messageHandle}`;
}

/** Persist webhook receive time so handler can measure queue/lock delay. */
export async function rememberWebhookReceivedAt(
  messageHandle: string,
  receivedAtMs: number,
): Promise<void> {
  MEMORY.set(messageHandle, receivedAtMs);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key(messageHandle), String(receivedAtMs), { ex: TTL_SEC });
  } catch {
    /* best-effort */
  }
}

export async function lookupWebhookReceivedAt(
  messageHandle: string | undefined,
): Promise<number | null> {
  if (!messageHandle) return null;
  const local = MEMORY.get(messageHandle);
  if (local != null) return local;
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(key(messageHandle));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
