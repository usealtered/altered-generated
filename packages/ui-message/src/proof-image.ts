import { PROOF_PNG_BASE64 } from "./proof-static";

/**
 * Branded proof PNG for Sendblue media proof-of-life.
 * Uses a pre-rendered asset so the API lambda never loads sharp
 * (bundling sharp previously crashed every /webhooks/sendblue request).
 */
export async function generateProofPng(opts?: {
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
}): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  void opts;
  return {
    bytes: Buffer.from(PROOF_PNG_BASE64, "base64"),
    filename: "AlteredUiMessageProof.png",
    contentType: "image/png",
  };
}
