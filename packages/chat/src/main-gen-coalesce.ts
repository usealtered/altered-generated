/**
 * Cross-handler / cross-isolate main-gen coalescing.
 *
 * Chat SDK `burst` only merges texts while its inbound lock is held. We release
 * that lock after fast-ack so the next inbound can ack immediately. Follow-ups
 * therefore each start a new handler (often on another Vercel isolate).
 *
 * Pending texts + schedule epoch live in Upstash Redis. The quiet-window
 * waitUntil on the latest schedule drains Redis and runs ONE Sonnet turn.
 * A Redis generation token lets an in-flight turn on another isolate see it
 * was superseded and stop (via abort polling).
 */

import { Redis } from "@upstash/redis";
import { getServerEnv } from "@altered/env";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

/** Quiet window after the latest inbound before main-gen starts. */
export const MAIN_GEN_COALESCE_MS = 2_000;

const TTL_SEC = 180;
const ABORT_POLL_MS = 400;

export type CoalescedMainGenArgs = {
  composedText: string;
  signal: AbortSignal;
  generation: number;
  partCount: number;
  parts: string[];
};

type ExecuteFn = (args: CoalescedMainGenArgs) => Promise<void>;

type MemoryThread = {
  pending: string[];
  inflight: string[] | null;
  execute: ExecuteFn | null;
  trace: TraceContext | null;
  epoch: number;
  generation: number;
  active: AbortController | null;
};

const memory = new Map<string, MemoryThread>();
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

function partsKey(threadId: string) {
  return `mgc:parts:${threadId}`;
}
function inflightKey(threadId: string) {
  return `mgc:inflight:${threadId}`;
}
function epochKey(threadId: string) {
  return `mgc:epoch:${threadId}`;
}
function genKey(threadId: string) {
  return `mgc:gen:${threadId}`;
}

function getMemory(threadId: string): MemoryThread {
  let s = memory.get(threadId);
  if (!s) {
    s = {
      pending: [],
      inflight: null,
      execute: null,
      trace: null,
      epoch: 0,
      generation: 0,
      active: null,
    };
    memory.set(threadId, s);
  }
  return s;
}

function dedupeConsecutive(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachRedisAbort(
  threadId: string,
  generation: number,
  local: AbortController,
): () => void {
  const redis = getRedis();
  if (!redis) return () => undefined;
  const iv = setInterval(() => {
    void (async () => {
      try {
        const cur = await redis.get<string | number>(genKey(threadId));
        if (cur != null && Number(cur) !== generation && !local.signal.aborted) {
          local.abort();
        }
      } catch {
        /* best-effort */
      }
    })();
  }, ABORT_POLL_MS);
  return () => clearInterval(iv);
}

async function enqueuePart(
  threadId: string,
  text: string,
): Promise<{ epoch: number; partCount: number }> {
  const mem = getMemory(threadId);
  const redis = getRedis();
  if (redis) {
    try {
      // Re-queue any aborted in-flight texts before appending the new one.
      const aborted =
        (await redis.lrange<string>(inflightKey(threadId), 0, -1)) ?? [];
      if (aborted.length) {
        await redis.del(inflightKey(threadId));
        const existing =
          (await redis.lrange<string>(partsKey(threadId), 0, -1)) ?? [];
        await redis.del(partsKey(threadId));
        const merged = dedupeConsecutive([
          ...aborted.map(String),
          ...existing.map(String),
          text.trim(),
        ]);
        if (merged.length) {
          await redis.rpush(partsKey(threadId), ...merged);
        }
      } else {
        await redis.rpush(partsKey(threadId), text.trim());
      }
      await redis.expire(partsKey(threadId), TTL_SEC);
      const epoch = Number(await redis.incr(epochKey(threadId)));
      await redis.expire(epochKey(threadId), TTL_SEC);
      await redis.incr(genKey(threadId));
      await redis.expire(genKey(threadId), TTL_SEC);
      const partCount = Number(await redis.llen(partsKey(threadId)));
      return { epoch, partCount };
    } catch (err) {
      console.warn("[altered-ops] coalesce redis schedule failed; memory fallback", {
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (mem.inflight?.length) {
    mem.pending = dedupeConsecutive([...mem.inflight, ...mem.pending]);
    mem.inflight = null;
  }
  mem.pending = dedupeConsecutive([...mem.pending, text]);
  mem.epoch += 1;
  return { epoch: mem.epoch, partCount: mem.pending.length };
}

/**
 * Schedule (or re-schedule) a coalesced main-gen for this thread.
 * Fast-ack should already have been sent for this inbound.
 */
export async function scheduleCoalescedMainGen(input: {
  threadId: string;
  text: string;
  execute: ExecuteFn;
  trace?: TraceContext;
  debounceMs?: number;
}): Promise<{ partCount: number; debounceMs: number; promise: Promise<void> }> {
  const debounceMs = input.debounceMs ?? MAIN_GEN_COALESCE_MS;
  const mem = getMemory(input.threadId);
  mem.execute = input.execute;
  if (input.trace) mem.trace = input.trace;

  if (mem.active && !mem.active.signal.aborted) {
    mem.active.abort();
    if (input.trace) {
      traceLog(input.trace, "main_gen_aborted", {
        reason: "coalesce_reschedule",
      });
    }
  }

  const { epoch, partCount } = await enqueuePart(input.threadId, input.text);

  if (input.trace) {
    traceLog(input.trace, "main_gen_coalesce_scheduled", {
      debounceMs,
      partCount,
      epoch,
      preview: input.text.slice(0, 80),
    });
  }
  console.info("[altered-ops] main-gen coalesce scheduled", {
    threadId: input.threadId,
    debounceMs,
    partCount,
    epoch,
    cid: input.trace?.cid,
  });

  const promise = (async () => {
    await sleep(debounceMs);
    const redis = getRedis();
    if (redis) {
      try {
        const cur = Number(await redis.get<string | number>(epochKey(input.threadId)));
        if (cur !== epoch) return;
      } catch {
        /* proceed */
      }
    } else if (getMemory(input.threadId).epoch !== epoch) {
      return;
    }
    await flushThread(input.threadId, epoch);
  })();

  return { partCount, debounceMs, promise };
}

async function flushThread(threadId: string, expectedEpoch: number): Promise<void> {
  const mem = getMemory(threadId);
  const execute = mem.execute;
  const trace = mem.trace;
  if (!execute) return;

  const redis = getRedis();
  let parts: string[] = [];
  let generation = 0;

  if (redis) {
    try {
      const curEpoch = Number(await redis.get<string | number>(epochKey(threadId)));
      if (curEpoch !== expectedEpoch) return;

      const raw = (await redis.lrange<string>(partsKey(threadId), 0, -1)) ?? [];
      const curEpoch2 = Number(await redis.get<string | number>(epochKey(threadId)));
      if (curEpoch2 !== expectedEpoch) return;
      await redis.del(partsKey(threadId));

      parts = dedupeConsecutive(raw.map(String));
      if (parts.length) {
        await redis.rpush(inflightKey(threadId), ...parts);
        await redis.expire(inflightKey(threadId), TTL_SEC);
      }
      generation = Number(await redis.incr(genKey(threadId)));
      await redis.expire(genKey(threadId), TTL_SEC);
    } catch (err) {
      console.warn("[altered-ops] coalesce redis flush failed; memory fallback", {
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
      parts = dedupeConsecutive(mem.pending);
      mem.pending = [];
      mem.inflight = parts;
      mem.generation += 1;
      generation = mem.generation;
    }
  } else {
    if (mem.epoch !== expectedEpoch) return;
    parts = dedupeConsecutive(mem.pending);
    mem.pending = [];
    mem.inflight = parts;
    mem.generation += 1;
    generation = mem.generation;
  }

  if (parts.length === 0) return;

  const local = new AbortController();
  mem.active = local;
  const stopPoll = attachRedisAbort(threadId, generation, local);

  if (trace) {
    traceLog(trace, "main_gen_coalesce_flush", {
      generation,
      partCount: parts.length,
      preview: parts.join(" | ").slice(0, 120),
    });
  }
  console.info("[altered-ops] main-gen coalesce flush", {
    threadId,
    generation,
    partCount: parts.length,
    cid: trace?.cid,
  });

  try {
    await execute({
      composedText: parts.join("\n\n"),
      signal: local.signal,
      generation,
      partCount: parts.length,
      parts,
    });
    if (!local.signal.aborted) {
      // Success — drop inflight recovery buffer.
      if (redis) {
        await redis.del(inflightKey(threadId)).catch(() => undefined);
      }
      if (mem.inflight === parts) mem.inflight = null;
    }
  } finally {
    stopPoll();
    if (mem.active === local) mem.active = null;
  }
}

/** Test helper: force in-process coalesce (no Upstash). */
export function useMemoryMainGenCoalesceForTests() {
  memoryOnly = true;
  redisSingleton = null;
  memory.clear();
}

/** Test helper. */
export function resetMainGenCoalesceForTests() {
  memoryOnly = true;
  redisSingleton = null;
  for (const s of memory.values()) {
    s.active?.abort();
  }
  memory.clear();
}

/** Test helper: pending part count (memory mode). */
export function pendingMainGenPartCountForTests(threadId: string): number {
  return memory.get(threadId)?.pending.length ?? 0;
}
