/**
 * Live sales-mode smoke: prospect phone path must not blurt $100 on first touch.
 * Uses OpenRouter if available; otherwise asserts system prompt + offline reply.
 */
import { readFileSync } from "node:fs";
import { createOperatorContext } from "../src/operator-context.ts";
import { handleSalesMessage, SALES_SYSTEM } from "../src/sales.ts";
import type { OutboundSession } from "../src/outbound.ts";

function forceLoadEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i);
    let v = t.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v === "[SENSITIVE]") continue;
    process.env[k] = v;
  }
}

forceLoadEnv("/tmp/api-env.local");

function mockOutbound(): OutboundSession & { bubbles: string[] } {
  const bubbles: string[] = [];
  return {
    bubbles,
    async send(text: string) {
      bubbles.push(text);
      return { ok: true };
    },
    async sendMedia() {
      return { ok: true };
    },
    async startTyping() {
      return;
    },
    joinedTranscript() {
      return bubbles.join("\n\n");
    },
  } as unknown as OutboundSession & { bubbles: string[] };
}

const PRICE_RE = /\$\s*100|\$\s*499|\$\s*399|deposit|checkout|stripe/i;

console.log("prompt forbids early price:", /Do not open with \$100/i.test(SALES_SYSTEM));

const ctx = createOperatorContext();
const outbound = mockOutbound();
const phone = `+1555${String(Date.now()).slice(-7)}`;

const reply = await handleSalesMessage({
  ctx,
  chatThreadId: `sms:test-${phone}`,
  phone,
  text: "Hey Koa - I want to talk about ALTERED. Building a founder tool.",
  outbound,
});

const all = `${reply}\n${outbound.bubbles.join("\n")}`;
console.log("bubbles:", outbound.bubbles);
console.log("contains price?", PRICE_RE.test(all));
if (PRICE_RE.test(all)) {
  console.error("FAIL: early price blurt detected");
  process.exit(1);
}
console.log("PASS: first-touch sales reply has no price/checkout");
