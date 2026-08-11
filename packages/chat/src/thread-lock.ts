/**
 * In-process per-thread send serialization.
 * Chat SDK locks inbound handlers; this serializes outbound posts so a status
 * bubble and a background completion cannot interleave on the same thread.
 */

const gates = new Map<string, Promise<unknown>>();

export async function withThreadSendLock<T>(
  threadKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = gates.get(threadKey) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain: wait for prev, then hold until we release.
  gates.set(
    threadKey,
    prev.then(() => held).catch(() => held),
  );

  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (gates.get(threadKey) === held) {
      gates.delete(threadKey);
    }
  }
}
