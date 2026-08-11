import { z } from "zod";

/** Public URL Sendblue can fetch (must include a file extension). */
export const uiImageUrlSourceSchema = z.object({
  kind: z.literal("url"),
  url: z.string().url(),
});

/** In-memory bytes — uploaded to Sendblue CDN via multipart /api/upload-file. */
export const uiImageBytesSourceSchema = z.object({
  kind: z.literal("bytes"),
  bytes: z.custom<Buffer>(
    (v) => Buffer.isBuffer(v) || v instanceof Uint8Array,
    { message: "bytes must be Buffer or Uint8Array" },
  ),
  filename: z
    .string()
    .min(1)
    .regex(/\.[A-Za-z0-9]+$/, "filename must include an extension"),
  contentType: z.string().optional(),
});

export const uiImageSourceSchema = z.discriminatedUnion("kind", [
  uiImageUrlSourceSchema,
  uiImageBytesSourceSchema,
]);

export const uiImageMessageSchema = z.object({
  type: z.literal("image"),
  source: uiImageSourceSchema,
  /** Optional caption bubble text (plain text; sanitized by caller if needed). */
  caption: z.string().max(1400).optional(),
});

export const uiMessagePayloadSchema = z.discriminatedUnion("type", [
  uiImageMessageSchema,
]);

export type UiImageUrlSource = z.infer<typeof uiImageUrlSourceSchema>;
export type UiImageBytesSource = z.infer<typeof uiImageBytesSourceSchema>;
export type UiImageSource = z.infer<typeof uiImageSourceSchema>;
export type UiImageMessage = z.infer<typeof uiImageMessageSchema>;
export type UiMessagePayload = z.infer<typeof uiMessagePayloadSchema>;

export type ResolvedUiMedia = {
  mediaUrl: string;
  caption?: string;
  /** How the public URL was obtained. */
  hosting: "sendblue_upload" | "passthrough_url";
  mediaObjectId?: string;
};
