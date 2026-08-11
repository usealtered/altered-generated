/**
 * Per-thread outbound send serialization.
 *
 * Chat SDK Redis locks serialize inbound handlers. This lock serializes
 * outbound posts so status bubbles, replies, and background completion
 * notices cannot interleave on the same Sendblue thread.
 *
 * Uses an in-process promise chain (same isolate) plus an Upstash Redis
 * SET NX lock (cross-isolate on Vercel). Redis is required for correctness
 * when webhook + notify-flush hit different isolates.
 */

import { Redis } from "@upstash/redis";
import { getServerEnv } from "@altered/env";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

const gates = new Map<string, Promise<unknown>>();

const LOCK_TTL_SEC = 45;
const LOCK_WAIT_MS = 40_000;
/** Suppress duplicate kind=status bubbles on the same thread (short window). */
export const STATUS_ACK_TTL_SEC = 12;

let redisSingleton: Redis | null | undefined;
let memoryOnly = false;

function getRedis(): Redis | null {
  if (memoryOnly) return null;
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

/** Test helper: in-process locks only (no Upstash). */
export function useMemoryThreadLocksForTests() {
  memoryOnly = true;
  redisSingleton = null;
  gates.clear();
}

/** Test helper. */
export function resetThreadLockRedisForTests() {
  memoryOnly = false;
  redisSingleton = undefined;
  gates.clear();
}

function sendLockKey(threadKey: string) {
  return `send-lock:${threadKey}`;
}

function statusAckKey(threadKey: string) {
  return `status-ack:${threadKey}`;
}

async function acquireRedisLock(
  redis: Redis,
  key: string,
  token: string,
  ttlSec: number,
): Promise<boolean> {
  const ok = await redis.set(key, token, { nx: true, ex: ttlSec });
  return typeof ok === "string" && ok.toUpperCase() === "OK";
}

async function releaseRedisLock(redis: Redis, key: string, token: string) {
  // Compare-and-del so we never drop another isolate's lock after TTL reuse.
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
    [key],
    [token],
  );
}

async function withInProcessLock<T>(
  threadKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = gates.get(threadKey) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(
    () => held,
    () => held,
  );
  gates.set(threadKey, tail);

  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (gates.get(threadKey) === tail) {
      gates.delete(threadKey);
    }
  }
}

/**
 * Claim the right to send one short status bubble on this thread.
 * Returns false if a status was already claimed within STATUS_ACK_TTL_SEC.
 */
export async function claimThreadStatusAck(
  threadKey: string,
  ttlSec: number = STATUS_ACK_TTL_SEC,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const ok = await redis.set(statusAckKey(threadKey), "1", {
      nx: true,
      ex: ttlSec,
    });
    return typeof ok === "string" && ok.toUpperCase() === "OK";
  } catch (err) {
    console.warn("[altered-ops] status ack claim failed", {
      threadKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

export async function withThreadSendLock<T>(
  threadKey: string,
  fn: () => Promise<T>,
  trace?: TraceContext,
): Promise<T> {
  return withInProcessLock(threadKey, async () => {
    const redis = getRedis();
    if (!redis) return fn();

    const key = sendLockKey(threadKey);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const started = Date.now();
    let waitedLogged = false;

    while (Date.now() - started < LOCK_WAIT_MS) {
      try {
        if (await acquireRedisLock(redis, key, token, LOCK_TTL_SEC)) {
          const waitMs = Date.now() - started;
          if (trace) {
            traceLog(trace, "send_lock_acquired", { waitMs, threadKey });
          }
          try {
            return await fn();
          } finally {
            await releaseRedisLock(redis, key, token).catch(() => undefined);
            if (trace) {
              traceLog(trace, "send_lock_released", {
                heldMs: Date.now() - started - waitMs,
                threadKey,
              });
            }
          }
        }
      } catch (err) {
        console.warn("[altered-ops] send lock acquire error", {
          threadKey,
          error: err instanceof Error ? err.message : String(err),
        });
        // Fall through to retry / eventual fallback.
      }
      if (!waitedLogged && Date.now() - started > 100) {
        waitedLogged = true;
        if (trace) {
          traceLog(trace, "send_lock_wait", {
            waitedMs: Date.now() - started,
            threadKey,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
    }

    console.warn("[altered-ops] send lock wait timeout; sending unlocked", {
      threadKey,
    });
    return fn();
  });
}
