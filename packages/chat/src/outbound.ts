import {
  sanitizeImessageText,
  splitImessageParts,
  enforceShortStatusBubble,
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
  /** Send image/file bubble via Sendblue media_url (public URL). */
  postMedia?: (mediaUrl: string, caption?: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
  sendReadReceipt?: () => Promise<unknown>;
  trace?: TraceContext;
  /** Sendblue message_handle for this inbound turn (status-ack dedupe key). */
  messageHandle?: string;
};

export type SendKind = "status" | "reply";

/**
 * Multi-send iMessage session: typing before each outbound, optional status ping
 * before slow tool work, paragraph-aware splitting, code-level sanitizer.
 *
 * Status/fast-ack bubbles:
 * - Dedupe per inbound message_handle only (never per-thread).
 * - Bypass the Redis/in-process send lock so they never wait on main-gen sends.
 *
 * Reply bubbles still take the send lock so A/B final replies stay ordered.
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

  async function postPart(part: string, kind: SendKind) {
    const postStarted = Date.now();
    const stageStart = kind === "status" ? "ack_send_start" : "main_send_start";
    const stageDone = kind === "status" ? "ack_send_done" : "main_send_done";
    if (transport.trace) {
      traceLog(transport.trace, stageStart as "ack_send_start" | "main_send_start", {
        kind,
        chars: part.length,
      });
    }
    await transport.post(part);
    if (transport.trace) {
      traceLog(transport.trace, stageDone as "ack_send_done" | "main_send_done", {
        kind,
        postMs: Date.now() - postStarted,
        chars: part.length,
      });
    }
    sent.push(part);
    if (kind === "status") statusSent = true;
  }

  async function sendRaw(text: string, kind: SendKind) {
    const cleaned = sanitizeImessageText(text);
    if (!cleaned) return;

    if (kind === "status") {
      // Same-turn guard.
      if (statusSent) return;
      // Per-messageHandle only — never block overlap-B because A acked.
      const claimed = await claimThreadStatusAck(
        transport.id,
        transport.messageHandle ?? transport.trace?.messageHandle,
      );
      if (!claimed) return;
    }

    const parts =
      kind === "status"
        ? (() => {
            const enforced = enforceShortStatusBubble(cleaned, {
              maxChars: 80,
              maxWords: 12,
            });
            if (enforced.rejected) {
              console.warn("[altered-ops] outbound status rejected (no ellipsis clip)", {
                threadId: transport.id,
                reason: enforced.reason,
                originalLength: enforced.originalLength,
              });
            }
            return [enforced.text];
          })()
        : splitImessageParts(cleaned);

    if (kind === "status") {
      // CRITICAL: do not take send lock. Main-gen replies must never delay acks.
      for (const part of parts) {
        if (!part.trim()) continue;
        await postPart(part, "status");
      }
      return;
    }

    await withThreadSendLock(
      transport.id,
      async () => {
        for (const part of parts) {
          if (!part.trim()) continue;
          await typing();
          await postPart(part, "reply");
        }
      },
      transport.trace,
    );
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
      const started = Date.now();
      if (transport.trace && kind === "status") {
        traceLog(transport.trace, "status_send_start", {});
      }
      await sendRaw(text, kind);
      const partsSent = sent.length - before;
      if (transport.trace && kind === "status") {
        traceLog(transport.trace, "status_send_done", {
          sendMs: Date.now() - started,
          skipped: partsSent === 0,
          parts: partsSent,
        });
      }
      return {
        ok: true as const,
        kind,
        skipped: partsSent === 0,
        parts: partsSent,
      };
    },
    /**
     * Send a rich media bubble (image/file) via Sendblue media_url.
     * Takes the reply send lock + typing, same as final text replies.
     */
    async sendMedia(mediaUrl: string, caption?: string) {
      if (!transport.postMedia) {
        return { ok: false as const, error: "No media transport bound" };
      }
      const url = mediaUrl.trim();
      if (!url) return { ok: false as const, error: "mediaUrl required" };
      const cleaned = caption ? sanitizeImessageText(caption) : undefined;

      await withThreadSendLock(
        transport.id,
        async () => {
          await typing();
          const postStarted = Date.now();
          if (transport.trace) {
            traceLog(transport.trace, "main_send_start", {
              kind: "media",
              chars: cleaned?.length ?? 0,
            });
          }
          await transport.postMedia!(url, cleaned);
          if (transport.trace) {
            traceLog(transport.trace, "main_send_done", {
              kind: "media",
              postMs: Date.now() - postStarted,
              chars: cleaned?.length ?? 0,
            });
          }
          if (cleaned) sent.push(cleaned);
          else sent.push(`[media:${url.slice(0, 64)}]`);
        },
        transport.trace,
      );
      return { ok: true as const, mediaUrl: url };
    },
    /**
     * Optional short progress ping. Safe under parallel tool execution.
     * Prefer fast-ack / model-authored status; this is a helper only.
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
      statusSent = true;
      return { skipped: !didSend };
    },
    async flushText(text: string) {
      const trimmed = sanitizeImessageText(text ?? "");
      if (!trimmed) return { sent: 0 };
      if (sent.some((s) => s === trimmed)) {
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
