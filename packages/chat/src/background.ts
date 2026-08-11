/**
 * Schedule work that must outlive the Chat SDK inbound handler return
 * (so we can release the per-thread lock after fast-ack).
 *
 * Wired to Vercel `waitUntil` from apps/api; falls back to fire-and-forget.
 */

type Scheduler = (task: Promise<unknown>) => void;

let scheduler: Scheduler = (task) => {
  void Promise.resolve(task).catch((err) => {
    console.error("[altered-ops] background task failed", err);
  });
};

export function setBackgroundScheduler(fn: Scheduler) {
  scheduler = fn;
}

export function runInBackground(task: Promise<unknown>): void {
  try {
    scheduler(task);
  } catch {
    void Promise.resolve(task).catch(() => undefined);
  }
}
