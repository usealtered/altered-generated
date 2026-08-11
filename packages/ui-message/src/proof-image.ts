import sharp from "sharp";

/**
 * Generate a small branded PNG for Sendblue media proof-of-life.
 * Pure in-memory — uploaded via Sendblue /api/upload-file (no Blob bucket).
 */
export async function generateProofPng(opts?: {
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
}): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  const width = opts?.width ?? 960;
  const height = opts?.height ?? 540;
  const title = opts?.title ?? "ALTERED";
  const subtitle = opts?.subtitle ?? "ui-message media proof";
  const stamp = new Date().toISOString();

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B0B0C"/>
      <stop offset="55%" stop-color="#16181D"/>
      <stop offset="100%" stop-color="#1F242C"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="48" y="48" width="${width - 96}" height="${height - 96}" fill="none" stroke="#E8E4DC" stroke-opacity="0.22" stroke-width="2"/>
  <text x="80" y="210" fill="#F4F1EA" font-family="Georgia, 'Times New Roman', serif" font-size="96" letter-spacing="8">${escapeXml(title)}</text>
  <text x="84" y="280" fill="#C8C2B6" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28">${escapeXml(subtitle)}</text>
  <text x="84" y="430" fill="#8A857A" font-family="ui-monospace, Menlo, monospace" font-size="18">${escapeXml(stamp)}</text>
</svg>`;

  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const filename = `AlteredUiMessageProof.png`;
  return {
    bytes,
    filename,
    contentType: "image/png",
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
