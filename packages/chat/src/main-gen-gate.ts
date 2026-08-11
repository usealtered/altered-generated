/**
 * Per-thread main-gen cancellation.
 *
 * After fast-ack we detach Sonnet via waitUntil and release the Chat SDK lock.
 * Rapid follow-up texts must abort the prior main-gen so we do not answer the
 * same burst four times in a row.
 */

import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

type Gate = {
  controller: AbortController;
  generation: number;
  startedAt: number;
};

const gates = new Map<string, Gate>();

/** Abort in-flight main-gen without starting a replacement (coalesce reschedule). */
export function abortMainGenIfRunning(
  threadId: string,
  trace?: TraceContext,
  reason: string = "superseded_by_new_inbound",
): boolean {
  const prev = gates.get(threadId);
  if (!prev || prev.controller.signal.aborted) return false;
  prev.controller.abort();
  if (trace) {
    traceLog(trace, "main_gen_aborted", {
      abortedGeneration: prev.generation,
      ranMs: Date.now() - prev.startedAt,
      reason,
    });
  }
  console.info("[altered-ops] main gen aborted (superseded)", {
    threadId,
    abortedGeneration: prev.generation,
    ranMs: Date.now() - prev.startedAt,
    reason,
  });
  return true;
}

export function beginMainGen(
  threadId: string,
  trace?: TraceContext,
): { signal: AbortSignal; generation: number } {
  const prev = gates.get(threadId);
  abortMainGenIfRunning(threadId, trace, "superseded_by_new_inbound");

  const controller = new AbortController();
  const generation = (prev?.generation ?? 0) + 1;
  gates.set(threadId, {
    controller,
    generation,
    startedAt: Date.now(),
  });
  return { signal: controller.signal, generation };
}

export function isCurrentMainGen(threadId: string, generation: number): boolean {
  return gates.get(threadId)?.generation === generation;
}

/** Test helper. */
export function resetMainGenGatesForTests() {
  for (const g of gates.values()) g.controller.abort();
  gates.clear();
}
