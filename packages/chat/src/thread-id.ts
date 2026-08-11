/** Canonical Sendblue DM thread id (matches chat-adapter-sendblue encodeThreadId). */
export function sendblueThreadIdForContact(
  fromNumber: string,
  contactNumber: string,
): string {
  const from = Buffer.from(fromNumber).toString("base64url");
  const contact = Buffer.from(contactNumber).toString("base64url");
  return `sendblue:${from}:${contact}`;
}
