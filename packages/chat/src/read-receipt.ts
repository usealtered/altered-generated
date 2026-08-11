import { getServerEnv } from "@altered/env";
import { type TraceContext, traceLog } from "./trace";

const SENDBLUE_MARK_READ_URL = "https://api.sendblue.co/api/mark-read";

/**
 * Fire Sendblue mark-read via direct HTTP - no Chat SDK init required.
 * Safe to call at the very top of the webhook before any await-heavy work.
 */
export async function sendMarkReadDirect(input: {
  contactNumber: string;
  fromNumber: string;
  trace?: TraceContext;
  source?: string;
}): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
  const env = getServerEnv();
  const started = Date.now();
  const source = input.source ?? "direct";

  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) {
    const error = "SENDBLUE_API_KEY/SECRET missing";
    if (input.trace) {
      traceLog(input.trace, "read_receipt_error", { source, error, apiMs: 0 });
    }
    return { ok: false, ms: 0, error };
  }

  if (input.trace) {
    traceLog(input.trace, "read_receipt_start", {
      source,
      contact: input.contactNumber,
      from: input.fromNumber,
    });
  }

  try {
    const res = await fetch(SENDBLUE_MARK_READ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sb-api-key-id": env.SENDBLUE_API_KEY,
        "sb-api-secret-key": env.SENDBLUE_API_SECRET,
      },
      body: JSON.stringify({
        number: input.contactNumber,
        from_number: input.fromNumber,
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = `HTTP ${res.status} ${body.slice(0, 160)}`;
      if (input.trace) {
        traceLog(input.trace, "read_receipt_error", {
          source,
          apiMs: ms,
          status: res.status,
          error,
        });
      } else {
        console.warn("[altered-ops] read receipt failed", {
          phone: input.contactNumber,
          error,
          ms,
        });
      }
      return { ok: false, ms, status: res.status, error };
    }

    if (input.trace) {
      traceLog(input.trace, "read_receipt_done", {
        source,
        apiMs: ms,
        status: res.status,
      });
    } else {
      console.info("[altered-ops] read receipt sent", {
        phone: input.contactNumber,
        ms,
        source,
      });
    }
    return { ok: true, ms, status: res.status };
  } catch (err) {
    const ms = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    if (input.trace) {
      traceLog(input.trace, "read_receipt_error", { source, apiMs: ms, error });
    } else {
      console.warn("[altered-ops] read receipt failed", {
        phone: input.contactNumber,
        error,
        ms,
      });
    }
    return { ok: false, ms, error };
  }
}
