/** Canonical Sendblue DM thread id (matches chat-adapter-sendblue encodeThreadId). */
export function sendblueThreadIdForContact(
  fromNumber: string,
  contactNumber: string,
): string {
  const from = Buffer.from(fromNumber).toString("base64url");
  const contact = Buffer.from(contactNumber).toString("base64url");
  return `sendblue:${from}:${contact}`;
}

/** Decode our sendblue:from:contact thread id back to E.164 numbers. */
export function decodeSendblueThreadId(threadId: string): {
  fromNumber?: string;
  contactNumber?: string;
} {
  const parts = threadId.split(":");
  if (parts[0] !== "sendblue" || parts.length < 3) return {};
  try {
    return {
      fromNumber: Buffer.from(parts[1]!, "base64url").toString("utf8"),
      contactNumber: Buffer.from(parts[2]!, "base64url").toString("utf8"),
    };
  } catch {
    return {};
  }
}
