import { getServerEnv } from "@altered/env";
import {
  sanitizeImessageText,
  truncateForImessage,
} from "@altered/cursor-bridge";

const SENDBLUE_SEND_URL = "https://api.sendblue.co/api/send-message";

/**
 * Direct Sendblue text send - no Chat SDK init / inbound lock.
 * Used for webhook-early fast-acks.
 */
export async function sendImessageDirect(input: {
  contactNumber: string;
  fromNumber: string;
  text: string;
}): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
  const env = getServerEnv();
  const started = Date.now();
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) {
    return { ok: false, ms: 0, error: "SENDBLUE_API_KEY/SECRET missing" };
  }
  const content = truncateForImessage(sanitizeImessageText(input.text), 80);
  if (!content) return { ok: false, ms: 0, error: "empty content" };

  try {
    const res = await fetch(SENDBLUE_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sb-api-key-id": env.SENDBLUE_API_KEY,
        "sb-api-secret-key": env.SENDBLUE_API_SECRET,
      },
      body: JSON.stringify({
        number: input.contactNumber,
        from_number: input.fromNumber,
        content,
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        ms,
        status: res.status,
        error: `HTTP ${res.status} ${body.slice(0, 160)}`,
      };
    }
    return { ok: true, ms, status: res.status };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
