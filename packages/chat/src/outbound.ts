import {
  sanitizeImessageText,
  splitImessageParts,
  truncateForImessage,
} from "@altered/cursor-bridge";
import { withThreadSendLock } from "./thread-lock";

export type ThreadTransport = {
  id: string;
  post: (text: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
  sendReadReceipt?: () => Promise<unknown>;
};

export type SendKind = "status" | "reply";

/**
 * Multi-send iMessage session: typing before each outbound, optional status ping
 * before slow tool work, paragraph-aware splitting, code-level sanitizer.
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

    const parts =
      kind === "status"
        ? [truncateForImessage(cleaned, 80)]
        : splitImessageParts(cleaned);

    await withThreadSendLock(transport.id, async () => {
      for (const part of parts) {
        if (!part.trim()) continue;
        await typing();
        await transport.post(part);
        sent.push(part);
        if (kind === "status") statusSent = true;
      }
    });
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
      await sendRaw(text, kind);
      return {
        ok: true as const,
        kind,
        parts: kind === "status" ? 1 : splitImessageParts(sanitizeImessageText(text)).length,
      };
    },
    /**
     * One short ack before tool work if nothing has gone out yet.
     * Safe under parallel tool execution (AI SDK can run tools concurrently).
     */
    async ensureStatus(fallback = "Checking that now.") {
      if (statusInFlight) {
        await statusInFlight;
        return { skipped: true as const };
      }
      if (statusSent || sent.length > 0) return { skipped: true as const };
      statusSent = true;
      statusInFlight = sendRaw(fallback, "status").then(() => undefined);
      await statusInFlight;
      return { skipped: false as const };
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
