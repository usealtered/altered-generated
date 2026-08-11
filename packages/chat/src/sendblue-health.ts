import type { ServerEnv } from "@altered/env";

const SENDBLUE_MESSAGES_URL = "https://api.sendblue.co/api/v2/messages";

export type SendblueOutboundSample = {
  dateSent: string;
  to: string;
  status: string;
  errorCode: string | number | null;
  errorMessage: string | null;
  preview: string;
};

export type SendblueDeviceHealth = {
  ok: boolean;
  configured: boolean;
  checkedAt: string;
  lookbackMinutes: number;
  outboundSampled: number;
  errorCount: number;
  deliveredOrSentCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | number | null;
  lastErrorMessage: string | null;
  deviceDown: boolean;
  diagnosis: string | null;
  recentErrors: SendblueOutboundSample[];
};

function previewText(content: unknown, max = 80): string {
  if (typeof content !== "string") return "";
  return content.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Poll Sendblue message history for recent outbound ERROR rate.
 * Catches device-down failures (e.g. Messages.app not running, code 5504)
 * that our send path treats as HTTP 200 success.
 */
export async function checkSendblueDeviceHealth(
  env: Pick<
    ServerEnv,
    "SENDBLUE_API_KEY" | "SENDBLUE_API_SECRET" | "SENDBLUE_FROM_NUMBER"
  >,
  opts?: { lookbackMinutes?: number; limit?: number },
): Promise<SendblueDeviceHealth> {
  const lookbackMinutes = opts?.lookbackMinutes ?? 60;
  const limit = opts?.limit ?? 50;
  const checkedAt = new Date().toISOString();
  const base: SendblueDeviceHealth = {
    ok: false,
    configured: Boolean(env.SENDBLUE_API_KEY && env.SENDBLUE_API_SECRET),
    checkedAt,
    lookbackMinutes,
    outboundSampled: 0,
    errorCount: 0,
    deliveredOrSentCount: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    deviceDown: false,
    diagnosis: null,
    recentErrors: [],
  };

  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) {
    return {
      ...base,
      diagnosis: "SENDBLUE_API_KEY/SECRET missing",
    };
  }

  try {
    const res = await fetch(`${SENDBLUE_MESSAGES_URL}?limit=${limit}`, {
      headers: {
        "sb-api-key-id": env.SENDBLUE_API_KEY,
        "sb-api-secret-key": env.SENDBLUE_API_SECRET,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ...base,
        diagnosis: `Sendblue history HTTP ${res.status} ${body.slice(0, 120)}`,
      };
    }

    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const cutoff = Date.now() - lookbackMinutes * 60_000;
    const recent = (json.data ?? []).filter((m) => {
      const raw = String(m.date_sent ?? "");
      const t = Date.parse(raw);
      return Number.isFinite(t) && t >= cutoff;
    });
    const outbound = recent.filter((m) => m.is_outbound === true);

    let errorCount = 0;
    let deliveredOrSentCount = 0;
    let lastSuccessAt: string | null = null;
    let lastErrorAt: string | null = null;
    let lastErrorCode: string | number | null = null;
    let lastErrorMessage: string | null = null;
    const recentErrors: SendblueOutboundSample[] = [];
    let deviceDownHits = 0;

    for (const m of outbound) {
      const status = String(m.status ?? "");
      const dateSent = String(m.date_sent ?? "");
      const errMsg =
        typeof m.error_message === "string" ? m.error_message : null;
      const errCode =
        (m.error_code as string | number | null | undefined) ?? null;
      const to = String(m.to_number ?? m.number ?? "");

      if (status === "ERROR") {
        errorCount += 1;
        if (!lastErrorAt || dateSent > lastErrorAt) {
          lastErrorAt = dateSent;
          lastErrorCode = errCode;
          lastErrorMessage = errMsg;
        }
        if (recentErrors.length < 8) {
          recentErrors.push({
            dateSent,
            to,
            status,
            errorCode: errCode,
            errorMessage: errMsg ? errMsg.split("\n")[0]!.slice(0, 160) : null,
            preview: previewText(m.content),
          });
        }
        const lowered = (errMsg ?? "").toLowerCase();
        if (
          errCode === 5504 ||
          errCode === "5504" ||
          lowered.includes("messages got an error") ||
          lowered.includes("application isn’t running") ||
          lowered.includes("application isn't running") ||
          lowered.includes("timed out waiting for message status")
        ) {
          deviceDownHits += 1;
        }
      } else if (status === "DELIVERED" || status === "SENT") {
        deliveredOrSentCount += 1;
        if (!lastSuccessAt || dateSent > lastSuccessAt) {
          lastSuccessAt = dateSent;
        }
      }
    }

    const deviceDown =
      deviceDownHits > 0 &&
      (deliveredOrSentCount === 0 ||
        (lastErrorAt != null &&
          (lastSuccessAt == null || lastErrorAt > lastSuccessAt)));

    let diagnosis: string | null = null;
    if (deviceDown) {
      diagnosis =
        "Sendblue device down: Messages.app not running or send timeouts (error 5504). Restart Messages on the Sendblue Mac.";
    } else if (errorCount > 0) {
      diagnosis = `${errorCount} recent outbound ERROR(s) in last ${lookbackMinutes}m`;
    }

    return {
      ok: !deviceDown && errorCount === 0,
      configured: true,
      checkedAt,
      lookbackMinutes,
      outboundSampled: outbound.length,
      errorCount,
      deliveredOrSentCount,
      lastSuccessAt,
      lastErrorAt,
      lastErrorCode,
      lastErrorMessage: lastErrorMessage
        ? lastErrorMessage.split("\n")[0]!.slice(0, 200)
        : null,
      deviceDown,
      diagnosis,
      recentErrors,
    };
  } catch (err) {
    return {
      ...base,
      diagnosis: err instanceof Error ? err.message : String(err),
    };
  }
}
