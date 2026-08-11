/**
 * Live intactness proof after status/ack ellipsis-clip fix.
 * 1) Rogue multi-question status → "On it." (no target...)
 * 2) Full multi-question reply → sent intact via split bubbles
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  enforceShortStatusBubble,
  splitImessageParts,
} from "@altered/cursor-bridge";
import { getServerEnv, normalizePhone, resetEnvCache } from "@altered/env";
import {
  sendImessageDirect,
  sendImessageReplyDirect,
} from "./sendblue-send";

function loadDotEnvLocal() {
  for (const p of [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "../../.env.local"),
    "/workspace/.env.local",
  ]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
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
    return;
  }
}

async function main() {
  loadDotEnvLocal();
  const env = getServerEnv();
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET || !env.SENDBLUE_FROM_NUMBER) {
    throw new Error("missing SENDBLUE_*");
  }
  const to = normalizePhone(
    process.env.PROOF_TO ||
      env.OPERATOR_PHONE_ALLOWLIST?.split(",")[0] ||
      "+12368370221",
  );
  if (to.length < 12) throw new Error(`bad to: ${to}`);

  const rogue =
    "Got it. Three quick ones:\n\nWhat's the core product or service?\nWho's the target customer?";
  const beforeClip = rogue.slice(0, 79) + "...";
  const enforced = enforceShortStatusBubble(rogue);
  console.info("[proof] BEFORE would have been", JSON.stringify(beforeClip));
  console.info("[proof] AFTER status enforce", enforced);

  const statusSend = await sendImessageDirect({
    contactNumber: to,
    fromNumber: env.SENDBLUE_FROM_NUMBER,
    text: rogue,
  });
  console.info("[proof] status/ack path send", statusSend);

  const full = [
    "Truncation fix proof (reply path). Three quick ones:",
    "What's the core product or service?",
    "Who's the target customer and what pain is acute right now?",
    "What does a win look like in 90 days if this works?",
  ].join("\n\n");
  const parts = splitImessageParts(full);
  console.info("[proof] reply parts", {
    partCount: parts.length,
    lengths: parts.map((p) => p.length),
    intact:
      full.includes("What's the core product") &&
      full.includes("Who's the target customer") &&
      full.includes("What does a win look like"),
  });

  const results = [];
  for (const part of parts) {
    const r = await sendImessageReplyDirect({
      contactNumber: to,
      fromNumber: env.SENDBLUE_FROM_NUMBER,
      text: part,
    });
    results.push({ ok: r.ok, ms: r.ms, chars: part.length, endsWithEllipsis: part.endsWith("...") });
    if (!r.ok) throw new Error(r.error ?? "reply send failed");
  }
  console.info("[proof] reply path sends", results);
  console.info("[proof] DONE", {
    to,
    statusBecame: enforced.text,
    replyParts: parts.length,
    allOk: results.every((r) => r.ok),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
