/**
 * Sendblue media helpers.
 *
 * Contract (docs + live API):
 * - send-message accepts `media_url` (public URL with file extension). No raw base64.
 * - /api/upload-file accepts multipart `file` and returns a CDN `media_url`.
 * - /api/upload-media-object re-hosts an existing public URL (also needs a source URL).
 *
 * We prefer upload-file for generated/ephemeral images so we do not need Vercel Blob/S3.
 */

const SENDBLUE_API_BASE = "https://api.sendblue.co";

export type SendblueAuth = {
  apiKey: string;
  apiSecret: string;
};

function authHeaders(auth: SendblueAuth): Record<string, string> {
  return {
    "sb-api-key-id": auth.apiKey,
    "sb-api-secret-key": auth.apiSecret,
  };
}

export type UploadSendblueFileResult = {
  ok: true;
  mediaUrl: string;
  mediaObjectId?: string;
  ms: number;
  status: number;
};

export type UploadSendblueFileError = {
  ok: false;
  error: string;
  ms: number;
  status?: number;
};

/**
 * Upload raw bytes to Sendblue CDN. Returns a public media_url usable in send-message.
 */
export async function uploadSendblueFile(input: {
  auth: SendblueAuth;
  bytes: Buffer | Uint8Array;
  filename: string;
  contentType?: string;
}): Promise<UploadSendblueFileResult | UploadSendblueFileError> {
  const started = Date.now();
  const filename = sanitizeFilename(input.filename);
  const type = input.contentType ?? guessContentType(filename);
  const form = new FormData();
  // Buffer → Blob keeps a clean ArrayBuffer view for multipart upload.
  const buffer = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes);
  form.append("file", new Blob([buffer], { type }), filename);

  try {
    const res = await fetch(`${SENDBLUE_API_BASE}/api/upload-file`, {
      method: "POST",
      headers: authHeaders(input.auth),
      body: form,
    });
    const ms = Date.now() - started;
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    const mediaUrl =
      typeof json.media_url === "string" ? json.media_url : undefined;
    if (!res.ok || !mediaUrl) {
      return {
        ok: false,
        ms,
        status: res.status,
        error: `upload-file HTTP ${res.status} ${text.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      mediaUrl,
      mediaObjectId:
        typeof json.mediaObjectId === "string" ? json.mediaObjectId : undefined,
      ms,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SendSendblueMediaResult = {
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
  messageHandle?: string;
};

/** Send an iMessage with media_url (+ optional caption content). */
export async function sendSendblueMedia(input: {
  auth: SendblueAuth;
  contactNumber: string;
  fromNumber: string;
  mediaUrl: string;
  content?: string;
}): Promise<SendSendblueMediaResult> {
  const started = Date.now();
  if (!input.mediaUrl?.trim()) {
    return { ok: false, ms: 0, error: "mediaUrl required" };
  }
  try {
    const res = await fetch(`${SENDBLUE_API_BASE}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(input.auth),
      },
      body: JSON.stringify({
        number: input.contactNumber,
        from_number: input.fromNumber,
        content: input.content ?? "",
        media_url: input.mediaUrl,
      }),
    });
    const ms = Date.now() - started;
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      return {
        ok: false,
        ms,
        status: res.status,
        error: `send-message HTTP ${res.status} ${text.slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      ms,
      status: res.status,
      messageHandle:
        typeof json.message_handle === "string"
          ? json.message_handle
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/g, "");
  if (/\.[A-Za-z0-9]+$/.test(base)) return base;
  return `${base || "Media"}.png`;
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}
