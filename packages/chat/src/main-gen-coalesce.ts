/**
 * Cross-handler main-gen coalescing.
 *
 * Chat SDK `burst` only merges texts while its inbound lock is held. We release
 * that lock after fast-ack (~2s) so the next inbound can ack immediately. That
 * means follow-ups during Sonnet each start a new handler with burstTotal=1.
 *
 * This buffer survives across handlers: append text, reset a quiet-window timer,
 * abort any in-flight main-gen, then run ONE Sonnet turn with the full joined
 * context once the sender pauses.
 *
 * The returned `promise` MUST be passed to `runInBackground` / waitUntil so the
 * debounce + Sonnet turn survive past the webhook response on Vercel.
 */

import {
  abortMainGenIfRunning,
  beginMainGen,
  isCurrentMainGen,
} from "./main-gen-gate";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

/** Quiet window after the latest inbound before main-gen starts. */
export const MAIN_GEN_COALESCE_MS = 2_000;

export type CoalescedMainGenArgs = {
  composedText: string;
  signal: AbortSignal;
  generation: number;
  partCount: number;
  parts: string[];
};

type ExecuteFn = (args: CoalescedMainGenArgs) => Promise<void>;

type ThreadCoalesce = {
  pending: string[];
  execute: ExecuteFn | null;
  trace: TraceContext | null;
  /** Texts currently being generated (re-merged if aborted). */
  inflight: string[] | null;
  /** Bumped on every schedule so older debounce waits exit. */
  epoch: number;
};

const threads = new Map<string, ThreadCoalesce>();

function getThread(threadId: string): ThreadCoalesce {
  let s = threads.get(threadId);
  if (!s) {
    s = {
      pending: [],
      execute: null,
      trace: null,
      inflight: null,
      epoch: 0,
    };
    threads.set(threadId, s);
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

/**
 * Schedule (or re-schedule) a coalesced main-gen for this thread.
 * Fast-ack should already have been sent for this inbound.
 */
export function scheduleCoalescedMainGen(input: {
  threadId: string;
  text: string;
  execute: ExecuteFn;
  trace?: TraceContext;
  debounceMs?: number;
}): { partCount: number; debounceMs: number; promise: Promise<void> } {
  const debounceMs = input.debounceMs ?? MAIN_GEN_COALESCE_MS;
  const s = getThread(input.threadId);

  // If a prior flush is mid-Sonnet, fold its texts back so the next turn
  // still sees the full evolving thought.
  if (s.inflight?.length) {
    s.pending = dedupeConsecutive([...s.inflight, ...s.pending]);
    s.inflight = null;
  }

  s.pending = dedupeConsecutive([...s.pending, input.text]);
  s.execute = input.execute;
  if (input.trace) s.trace = input.trace;

  // Abort any live main-gen immediately (stop stale tool loops / replies).
  abortMainGenIfRunning(
    input.threadId,
    input.trace,
    "coalesce_reschedule",
  );

  s.epoch += 1;
  const epoch = s.epoch;

  if (input.trace) {
    traceLog(input.trace, "main_gen_coalesce_scheduled", {
      debounceMs,
      partCount: s.pending.length,
      epoch,
      preview: s.pending.join(" | ").slice(0, 120),
    });
  }
  console.info("[altered-ops] main-gen coalesce scheduled", {
    threadId: input.threadId,
    debounceMs,
    partCount: s.pending.length,
    epoch,
    cid: input.trace?.cid,
  });

  const promise = (async () => {
    await sleep(debounceMs);
    if (getThread(input.threadId).epoch !== epoch) {
      // Newer inbound rescheduled; that schedule's waitUntil owns the work.
      return;
    }
    await flushThread(input.threadId);
  })();

  return {
    partCount: s.pending.length,
    debounceMs,
    promise,
  };
}

async function flushThread(threadId: string): Promise<void> {
  const s = threads.get(threadId);
  if (!s || !s.execute) return;

  const parts = dedupeConsecutive(s.pending);
  s.pending = [];
  if (parts.length === 0) return;

  const execute = s.execute;
  const trace = s.trace;
  const { signal, generation } = beginMainGen(threadId, trace ?? undefined);
  s.inflight = parts;

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
      signal,
      generation,
      partCount: parts.length,
      parts,
    });
  } finally {
    if (isCurrentMainGen(threadId, generation) && s.inflight === parts) {
      s.inflight = null;
    }
  }
}

/** Test helper. */
export function resetMainGenCoalesceForTests() {
  for (const s of threads.values()) {
    s.epoch += 1;
  }
  threads.clear();
}

/** Test helper: pending part count (not including inflight). */
export function pendingMainGenPartCountForTests(threadId: string): number {
  return threads.get(threadId)?.pending.length ?? 0;
}
