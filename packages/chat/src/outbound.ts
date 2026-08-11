import {
  splitImessageParts,
  truncateForImessage,
} from "@altered/cursor-bridge";

export type ThreadTransport = {
  id: string;
  post: (text: string) => Promise<unknown>;
  startTyping?: () => Promise<unknown>;
  sendReadReceipt?: () => Promise<unknown>;
};

export type SendKind = "status" | "reply";

/**
 * Multi-send iMessage session: typing before each outbound, optional status ping
 * before slow tool work, paragraph-aware splitting.
 */
export function createOutboundSession(transport: ThreadTransport) {
  const sent: string[] = [];
  let statusSent = false;
  let typingGate: Promise<unknown> = Promise.resolve();

  async function typing() {
    if (!transport.startTyping) return;
    typingGate = transport.startTyping().catch(() => undefined);
    await typingGate;
  }

  async function sendRaw(text: string, kind: SendKind) {
    const parts =
      kind === "status"
        ? [truncateForImessage(text, 80)]
        : splitImessageParts(text);

    for (const part of parts) {
      if (!part.trim()) continue;
      await typing();
      await transport.post(part);
      sent.push(part);
      if (kind === "status") statusSent = true;
    }
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
      return { ok: true as const, kind, parts: kind === "status" ? 1 : splitImessageParts(text).length };
    },
    /** One short ack before tool work if nothing has gone out yet. */
    async ensureStatus(fallback = "Checking that now.") {
      if (statusSent || sent.length > 0) return { skipped: true as const };
      await sendRaw(fallback, "status");
      return { skipped: false as const };
    },
    /** Flush leftover model text that was not sent via the send_message tool. */
    async flushText(text: string) {
      const trimmed = text?.trim();
      if (!trimmed) return { sent: 0 };
      // Avoid duplicating an identical last bubble
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
