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

const ACK_CLAIMED = new Set<string>();
const ACK_SENT = new Set<string>();

function ackClaimedKey(messageHandle: string) {
  return `ack-claimed:${messageHandle}`;
}

function ackSentKey(messageHandle: string) {
  return `ack-sent:${messageHandle}`;
}

/**
 * Claimed as soon as webhook-early ack starts (before Haiku/Sendblue).
 * Prevents the Chat SDK handler from starting a backup ack while the
 * webhook path is still in flight on another waitUntil.
 */
export async function markWebhookAckClaimed(
  messageHandle: string,
): Promise<void> {
  ACK_CLAIMED.add(messageHandle);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(ackClaimedKey(messageHandle), "1", { ex: TTL_SEC });
  } catch {
    /* best-effort */
  }
}

/** Mark that webhook-early already delivered the fast-ack bubble. */
export async function markWebhookAckSent(messageHandle: string): Promise<void> {
  ACK_SENT.add(messageHandle);
  ACK_CLAIMED.add(messageHandle);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(ackSentKey(messageHandle), "1", { ex: TTL_SEC });
  } catch {
    /* best-effort */
  }
}

export async function wasWebhookAckSent(
  messageHandle: string | undefined,
): Promise<boolean> {
  if (!messageHandle) return false;
  if (ACK_CLAIMED.has(messageHandle) || ACK_SENT.has(messageHandle)) {
    return true;
  }
  const redis = getRedis();
  if (!redis) return false;
  try {
    const claimed = await redis.get<string>(ackClaimedKey(messageHandle));
    if (claimed != null) return true;
    const raw = await redis.get<string>(ackSentKey(messageHandle));
    return raw != null;
  } catch {
    return false;
  }
}
