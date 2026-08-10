import { readFile } from "node:fs/promises";
import path from "node:path";
import { getKnowledgeRoot } from "@altered/knowledge";

/** Mid-band placeholder until offer is locked in knowledge + PRIMARY_CHECKOUT_URL. */
export const DEFAULT_DEPOSIT_AMOUNT_CENTS = 14_900;
export const DEFAULT_DEPOSIT_CURRENCY = "usd";

let cachedCents: number | null = null;
let cachedAt = 0;

/**
 * Resolve deposit amount from knowledge/offers (or hard default).
 * Looks for `$NNN` near "deposit" / "placeholder" lines.
 */
export async function resolveDepositAmountCents(
  knowledgeRoot = getKnowledgeRoot(),
): Promise<number> {
  const now = Date.now();
  if (cachedCents != null && now - cachedAt < 60_000) return cachedCents;

  try {
    const file = path.join(knowledgeRoot, "offers/early-access-deposit.md");
    const raw = await readFile(file, "utf8");
    const explicit = raw.match(
      /(?:placeholder|default|deposit)[^\n$]*\$(\d{2,3})\b/i,
    );
    if (explicit?.[1]) {
      const dollars = Number(explicit[1]);
      if (dollars >= 99 && dollars <= 249) {
        cachedCents = dollars * 100;
        cachedAt = now;
        return cachedCents;
      }
    }
  } catch {
    /* fall through */
  }

  cachedCents = DEFAULT_DEPOSIT_AMOUNT_CENTS;
  cachedAt = now;
  return cachedCents;
}

export function depositLabel(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}
