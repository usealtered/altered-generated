import {
  sendSendblueMedia,
  uploadSendblueFile,
  type SendblueAuth,
} from "./sendblue-media";
import {
  uiMessagePayloadSchema,
  type ResolvedUiMedia,
  type UiMessagePayload,
} from "./types";

export type ResolveUiMediaOptions = {
  auth: SendblueAuth;
};

/**
 * Turn a structured ui-message payload into a public media_url Sendblue can fetch.
 * Bytes are uploaded to Sendblue CDN (no Vercel Blob / S3 required).
 */
export async function resolveUiMedia(
  payload: UiMessagePayload,
  opts: ResolveUiMediaOptions,
): Promise<
  | { ok: true; media: ResolvedUiMedia }
  | { ok: false; error: string }
> {
  const parsed = uiMessagePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const msg = parsed.data;
  if (msg.type !== "image") {
    return { ok: false, error: `unsupported ui-message type` };
  }

  if (msg.source.kind === "url") {
    return {
      ok: true,
      media: {
        mediaUrl: msg.source.url,
        caption: msg.caption,
        hosting: "passthrough_url",
      },
    };
  }

  const uploaded = await uploadSendblueFile({
    auth: opts.auth,
    bytes: msg.source.bytes,
    filename: msg.source.filename,
    contentType: msg.source.contentType,
  });
  if (!uploaded.ok) {
    return { ok: false, error: uploaded.error };
  }
  return {
    ok: true,
    media: {
      mediaUrl: uploaded.mediaUrl,
      caption: msg.caption,
      hosting: "sendblue_upload",
      mediaObjectId: uploaded.mediaObjectId,
    },
  };
}

export type SendUiMessageOptions = ResolveUiMediaOptions & {
  contactNumber: string;
  fromNumber: string;
  /** Optional pre-resolved media (skips resolve/upload). */
  media?: ResolvedUiMedia;
};

/**
 * Resolve (upload if needed) + send as a real iMessage image/attachment bubble.
 */
export async function sendUiMessage(
  payload: UiMessagePayload,
  opts: SendUiMessageOptions,
): Promise<
  | {
      ok: true;
      mediaUrl: string;
      hosting: ResolvedUiMedia["hosting"];
      messageHandle?: string;
      ms: number;
    }
  | { ok: false; error: string; ms: number }
> {
  const started = Date.now();
  const resolved =
    opts.media != null
      ? { ok: true as const, media: opts.media }
      : await resolveUiMedia(payload, opts);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, ms: Date.now() - started };
  }

  const sent = await sendSendblueMedia({
    auth: opts.auth,
    contactNumber: opts.contactNumber,
    fromNumber: opts.fromNumber,
    mediaUrl: resolved.media.mediaUrl,
    content: resolved.media.caption ?? "",
  });
  if (!sent.ok) {
    return {
      ok: false,
      error: sent.error ?? "send failed",
      ms: Date.now() - started,
    };
  }
  return {
    ok: true,
    mediaUrl: resolved.media.mediaUrl,
    hosting: resolved.media.hosting,
    messageHandle: sent.messageHandle,
    ms: Date.now() - started,
  };
}
