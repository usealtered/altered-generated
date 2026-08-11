/**
 * One-shot live proof: generate PNG → Sendblue upload-file → send-message to Riley.
 *
 * Usage (from repo root, with .env.local present):
 *   pnpm --filter @altered/ui-message send-proof
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getServerEnv, normalizePhone, resetEnvCache } from "@altered/env";
import { generateProofPng } from "./proof-image";
import { sendUiMessage } from "./render";

function loadDotEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const alt = resolve(process.cwd(), "../../.env.local");
  const file = existsSync(path) ? path : existsSync(alt) ? alt : null;
  if (!file) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  resetEnvCache();
}

function resolveProofRecipient(allowlist?: string): string {
  const candidates = [
    process.env.PROOF_TO,
    allowlist?.split(",")[0],
    "+12368370221",
  ];
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    const n = normalizePhone(raw.trim());
    // normalizePhone("") becomes "+" — reject non-E.164 stubs
    if (n.length >= 12 && /^\+\d+$/.test(n)) return n;
  }
  return "+12368370221";
}

async function main() {
  loadDotEnvLocal();
  const env = getServerEnv();
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET || !env.SENDBLUE_FROM_NUMBER) {
    console.error("Missing SENDBLUE_* env");
    process.exit(1);
  }

  const to = resolveProofRecipient(env.OPERATOR_PHONE_ALLOWLIST);

  const img = await generateProofPng({
    title: "ALTERED",
    subtitle: "ui-message renderer online",
  });

  console.info("[ui-message] uploading + sending proof image", {
    to,
    from: env.SENDBLUE_FROM_NUMBER,
    bytes: img.bytes.byteLength,
    filename: img.filename,
  });

  const result = await sendUiMessage(
    {
      type: "image",
      source: {
        kind: "bytes",
        bytes: img.bytes,
        filename: img.filename,
        contentType: img.contentType,
      },
      caption: "ui-message proof: image attachment via Sendblue media_url (CDN upload, no Blob bucket).",
    },
    {
      auth: {
        apiKey: env.SENDBLUE_API_KEY,
        apiSecret: env.SENDBLUE_API_SECRET,
      },
      contactNumber: to,
      fromNumber: env.SENDBLUE_FROM_NUMBER,
    },
  );

  if (!result.ok) {
    console.error("[ui-message] proof send failed", result);
    process.exit(1);
  }

  console.info("[ui-message] proof send ok", {
    hosting: result.hosting,
    mediaUrlPrefix: result.mediaUrl.slice(0, 80),
    messageHandle: result.messageHandle,
    ms: result.ms,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
