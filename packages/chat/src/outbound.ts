import {
  sanitizeImessageText,
  splitImessageParts,
  truncateForImessage,
} from "@altered/cursor-bridge";
import {
  claimThreadStatusAck,
  withThreadSendLock,
} from "./thread-lock";
import type { TraceContext } from "./trace";
import { traceLog } from "./trace";

export type ThreadTransport = {
  id: string;
  post: (text: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
  sendReadReceipt?: () => Promise<unknown>;
  trace?: TraceContext;
};

export type SendKind = "status" | "reply";

/**
 * Multi-send iMessage session: typing before each outbound, optional status ping
 * before slow tool work, paragraph-aware splitting, code-level sanitizer.
 *
 * Status bubbles are Redis-claimed per thread so overlapping turns / isolates
 * cannot spam duplicate acks. There is no canned deterministic ack phrase.
 */
export function createOutboundSession(transport: ThreadTransport) {
  const sent: string[] = [];
  let statusSent = false;
  let statusInFlight: Promise<void> | null = null;
  let typingGate: Promise<unknown> = Promise.resolve();

  async function typing() {
    if (!transport.startTyping) return;
    typingGate = transport.startTyping().catch(() => undefined);
    await typingGate;
  }

  async function sendRaw(text: string, kind: SendKind) {
    const cleaned = sanitizeImessageText(text);
    if (!cleaned) return;

    if (kind === "status") {
      // Cross-isolate / cross-turn dedupe for status pings.
      const claimed = await claimThreadStatusAck(transport.id);
      if (!claimed) return;
    }

    const parts =
      kind === "status"
        ? [truncateForImessage(cleaned, 80)]
        : splitImessageParts(cleaned);

    await withThreadSendLock(transport.id, async () => {
      for (const part of parts) {
        if (!part.trim()) continue;
        // Status acks must be near-instant: skip typing API round-trip.
        if (kind !== "status") await typing();
        const postStarted = Date.now();
        if (transport.trace && kind !== "status") {
          traceLog(transport.trace, "outbound_send_start", {
            kind,
            chars: part.length,
          });
        }
        await transport.post(part);
        if (transport.trace && kind !== "status") {
          traceLog(transport.trace, "outbound_send_done", {
            kind,
            postMs: Date.now() - postStarted,
            chars: part.length,
          });
        }
        sent.push(part);
        if (kind === "status") statusSent = true;
      }
    }, transport.trace);
  }

  return {
    get sent() {
      return [...sent];
    },
    get statusSent() {
      return statusSent;
    },
    get hasSent() {
      return sent.length > 0;
    },
    async sendReadReceipt() {
      await transport.sendReadReceipt?.().catch(() => undefined);
    },
    async typing() {
      await typing();
    },
    async send(text: string, kind: SendKind = "reply") {
      const before = sent.length;
      await sendRaw(text, kind);
      const partsSent = sent.length - before;
      return {
        ok: true as const,
        kind,
        skipped: partsSent === 0,
        parts: partsSent,
      };
    },
    /**
     * Optional short progress ping. Safe under parallel tool execution.
     * Prefer fast-ack / model-authored status; this is a helper only.
     * Duplicate status claims within the Redis TTL are skipped.
     */
    async ensureStatus(fallback = "On it.") {
      if (statusInFlight) {
        await statusInFlight;
        return { skipped: true as const };
      }
      if (statusSent || sent.length > 0) return { skipped: true as const };
      const cleaned = sanitizeImessageText(fallback);
      if (!cleaned) return { skipped: true as const };

      const before = sent.length;
      statusInFlight = sendRaw(cleaned, "status").then(() => undefined);
      try {
        await statusInFlight;
      } finally {
        statusInFlight = null;
      }
      const didSend = sent.length > before;
      // Mark handled even when Redis claim skips - do not retry this turn.
      statusSent = true;
      return { skipped: !didSend };
    },
    /**
     * Leftover model text should rarely be used - preferred path is send_message tool.
     * Still sanitized if invoked.
     */
    async flushText(text: string) {
      const trimmed = sanitizeImessageText(text ?? "");
      if (!trimmed) return { sent: 0 };
      if (sent.some((s) => s === trimmed || s === truncateForImessage(trimmed))) {
        return { sent: 0 };
      }
      const before = sent.length;
      await sendRaw(trimmed, "reply");
      return { sent: sent.length - before };
    },
    joinedTranscript() {
      return sent.join("\n\n");
    },
  };
}

export type OutboundSession = ReturnType<typeof createOutboundSession>;
