import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "@altered/env";

const ZERNIO_BASE = "https://zernio.com/api/v1";

export type ZernioPlatform = "twitter" | "linkedin" | "threads" | "bluesky";

export type ZernioCreatePostInput = {
  content: string;
  platforms: Array<{ platform: string; accountId: string }>;
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  queuedFromProfile?: string;
  requestId?: string;
};

export type ZernioCreatePostResult = {
  ok: boolean;
  postId?: string;
  status?: string;
  platformPostUrl?: string;
  scheduledFor?: string;
  error?: string;
  raw?: unknown;
};

export function postingEnabled(env: ServerEnv): boolean {
  if (env.POSTING_ENABLED?.trim().toLowerCase() === "false") return false;
  return true;
}

export function zernioConfigured(env: ServerEnv): boolean {
  return Boolean(env.ZERNIO_API_KEY && env.ZERNIO_TWITTER_ACCOUNT_ID);
}

export function approvalSecret(env: ServerEnv): string {
  return (
    env.POSTING_APPROVAL_SECRET ||
    env.QSTASH_TOKEN ||
    env.SENDBLUE_API_SECRET ||
    "altered-posting-dev"
  );
}

export function signApprovalToken(
  env: ServerEnv,
  payload: string,
): string {
  return createHmac("sha256", approvalSecret(env))
    .update(payload)
    .digest("base64url");
}

export function verifyApprovalToken(
  env: ServerEnv,
  payload: string,
  token: string,
): boolean {
  const expected = signApprovalToken(env, payload);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function platformsForEnv(env: ServerEnv): Array<{
  platform: string;
  accountId: string;
}> {
  const out: Array<{ platform: string; accountId: string }> = [];
  if (env.ZERNIO_TWITTER_ACCOUNT_ID) {
    out.push({ platform: "twitter", accountId: env.ZERNIO_TWITTER_ACCOUNT_ID });
  }
  if (env.ZERNIO_LINKEDIN_ACCOUNT_ID) {
    out.push({
      platform: "linkedin",
      accountId: env.ZERNIO_LINKEDIN_ACCOUNT_ID,
    });
  }
  return out;
}

export async function zernioCreatePost(
  env: ServerEnv,
  input: ZernioCreatePostInput,
): Promise<ZernioCreatePostResult> {
  if (!env.ZERNIO_API_KEY) {
    return { ok: false, error: "ZERNIO_API_KEY missing" };
  }
  if (!input.platforms.length) {
    return { ok: false, error: "No Zernio platform accounts configured" };
  }

  const body: Record<string, unknown> = {
    content: input.content,
    platforms: input.platforms,
  };
  if (input.publishNow) body.publishNow = true;
  if (input.scheduledFor) body.scheduledFor = input.scheduledFor;
  if (input.timezone) body.timezone = input.timezone;
  if (input.queuedFromProfile) body.queuedFromProfile = input.queuedFromProfile;

  try {
    const res = await fetch(`${ZERNIO_BASE}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ZERNIO_API_KEY}`,
        "Content-Type": "application/json",
        ...(input.requestId ? { "x-request-id": input.requestId } : {}),
      },
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof raw.error === "string"
          ? raw.error
          : typeof raw.message === "string"
            ? raw.message
            : `HTTP ${res.status}`;
      return { ok: false, error: msg, raw };
    }
    const post = (raw.post ?? raw.data ?? raw) as Record<string, unknown>;
    const nested =
      post && typeof post === "object" && "post" in post
        ? (post.post as Record<string, unknown>)
        : post;
    const postId =
      typeof nested?._id === "string"
        ? nested._id
        : typeof nested?.id === "string"
          ? nested.id
          : undefined;
    const status =
      typeof nested?.status === "string" ? nested.status : undefined;
    const scheduledFor =
      typeof nested?.scheduledFor === "string"
        ? nested.scheduledFor
        : undefined;
    let platformPostUrl: string | undefined;
    let platformError: string | undefined;
    const platforms = nested?.platforms;
    if (Array.isArray(platforms) && platforms[0]) {
      const first = platforms[0] as Record<string, unknown>;
      if (typeof first.platformPostUrl === "string") {
        platformPostUrl = first.platformPostUrl;
      } else if (typeof first.url === "string") {
        platformPostUrl = first.url;
      }
      if (typeof first.error === "string") platformError = first.error;
      if (first.status === "failed" && !platformError) {
        platformError = "platform publish failed";
      }
    }
    if (status === "failed" || status === "partial") {
      return {
        ok: false,
        postId,
        status,
        platformPostUrl,
        error: platformError ?? `zernio status ${status}`,
        raw,
      };
    }
    return {
      ok: true,
      postId,
      status,
      platformPostUrl,
      scheduledFor,
      raw,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function zernioListAccounts(env: ServerEnv): Promise<{
  ok: boolean;
  accounts?: Array<{ _id?: string; platform?: string; username?: string }>;
  error?: string;
}> {
  if (!env.ZERNIO_API_KEY) return { ok: false, error: "ZERNIO_API_KEY missing" };
  try {
    const res = await fetch(`${ZERNIO_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${env.ZERNIO_API_KEY}` },
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof raw.message === "string"
            ? raw.message
            : `HTTP ${res.status}`,
      };
    }
    const accounts = (raw.accounts ?? raw.data ?? []) as Array<{
      _id?: string;
      platform?: string;
      username?: string;
    }>;
    return { ok: true, accounts: Array.isArray(accounts) ? accounts : [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
