import { getServerEnv } from "@altered/env";
import {
  enforceShortStatusBubble,
  sanitizeImessageText,
} from "@altered/cursor-bridge";
import { sendSendblueMedia } from "@altered/ui-message";

const SENDBLUE_SEND_URL = "https://api.sendblue.co/api/send-message";

/**
 * Direct Sendblue text send - no Chat SDK init / inbound lock.
 * Used for webhook-early fast-acks. Never mid-sentence ellipsis-clips.
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
  const enforced = enforceShortStatusBubble(
    sanitizeImessageText(input.text),
    { maxChars: 80, maxWords: 12 },
  );
  const content = enforced.text;
  if (!content) return { ok: false, ms: 0, error: "empty content" };
  if (enforced.rejected) {
    console.warn("[altered-ops] sendImessageDirect status rejected", {
      reason: enforced.reason,
      originalLength: enforced.originalLength,
    });
  }

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
    const payload = (await res.json().catch(() => null)) as {
      status?: string;
      message_handle?: string;
      error_message?: string;
      error_code?: string | number;
    } | null;
    if (payload?.status === "ERROR") {
      console.error("[altered-ops] sendblue send returned ERROR", {
        messageHandle: payload.message_handle,
        errorCode: payload.error_code,
        errorMessage: payload.error_message?.slice(0, 160),
      });
      return {
        ok: false,
        ms,
        status: res.status,
        error: `Sendblue ERROR ${payload.error_code ?? ""} ${payload.error_message?.slice(0, 120) ?? ""}`.trim(),
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

/**
 * Direct Sendblue reply send - no 80-char status clamp.
 * Used for intactness proofs / non-ack outbound. Caller should split long text.
 */
export async function sendImessageReplyDirect(input: {
  contactNumber: string;
  fromNumber: string;
  text: string;
}): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
  const env = getServerEnv();
  const started = Date.now();
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) {
    return { ok: false, ms: 0, error: "SENDBLUE_API_KEY/SECRET missing" };
  }
  const content = sanitizeImessageText(input.text);
  if (!content) return { ok: false, ms: 0, error: "empty content" };
  if (content.length > 1400) {
    console.warn(
      "[altered-ops] sendImessageReplyDirect oversize (split upstream)",
      { length: content.length },
    );
    return {
      ok: false,
      ms: 0,
      error: `oversize ${content.length} - split first`,
    };
  }

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
    const payload = (await res.json().catch(() => null)) as {
      status?: string;
      message_handle?: string;
      error_message?: string;
      error_code?: string | number;
    } | null;
    if (payload?.status === "ERROR") {
      console.error("[altered-ops] sendblue reply returned ERROR", {
        messageHandle: payload.message_handle,
        errorCode: payload.error_code,
        errorMessage: payload.error_message?.slice(0, 160),
      });
      return {
        ok: false,
        ms,
        status: res.status,
        error: `Sendblue ERROR ${payload.error_code ?? ""} ${payload.error_message?.slice(0, 120) ?? ""}`.trim(),
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

/**
 * Direct Sendblue media send (image/file bubble via media_url).
 * Prefer outbound session sendMedia when inside a Chat SDK turn.
 */
export async function sendImessageMediaDirect(input: {
  contactNumber: string;
  fromNumber: string;
  mediaUrl: string;
  caption?: string;
}): Promise<{
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
  messageHandle?: string;
}> {
  const env = getServerEnv();
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) {
    return { ok: false, ms: 0, error: "SENDBLUE_API_KEY/SECRET missing" };
  }
  const caption = input.caption
    ? sanitizeImessageText(input.caption)
    : undefined;
  return sendSendblueMedia({
    auth: {
      apiKey: env.SENDBLUE_API_KEY,
      apiSecret: env.SENDBLUE_API_SECRET,
    },
    contactNumber: input.contactNumber,
    fromNumber: input.fromNumber,
    mediaUrl: input.mediaUrl,
    content: caption,
  });
}
