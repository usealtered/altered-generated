import { readFile } from "node:fs/promises";
import path from "node:path";
import { getKnowledgeRoot } from "@altered/knowledge";

/** Locked $100 program reservation deposit (see knowledge/offers/early-access-deposit.md). */
export const DEFAULT_DEPOSIT_AMOUNT_CENTS = 10_000;
export const DEFAULT_DEPOSIT_CURRENCY = "usd";
export const PROGRAM_PRICE_CENTS = 49_900;
export const FOUNDING_SEATS_TARGET = 15;

let cachedCents: number | null = null;
let cachedAt = 0;

/** Test helper / hot-reload. */
export function resetDepositAmountCache() {
  cachedCents = null;
  cachedAt = 0;
}

/**
 * Resolve deposit amount from knowledge/offers (or hard default).
 * Prefers locked "$100" / "LOCKED" lines; falls back to $NNN near deposit.
 */
export async function resolveDepositAmountCents(
  knowledgeRoot = getKnowledgeRoot(),
): Promise<number> {
  const now = Date.now();
  if (cachedCents != null && now - cachedAt < 60_000) return cachedCents;

  try {
    const file = path.join(knowledgeRoot, "offers/early-access-deposit.md");
    const raw = await readFile(file, "utf8");
    const locked = raw.match(
      /(?:\*\*)?\$(\d{2,3})(?:\*\*)?\s*(?:USD)?[^\n]*(?:deposit|LOCKED)/i,
    );
    const explicit = raw.match(
      /(?:placeholder|default|deposit|LOCKED)[^\n$]*\$(\d{2,3})\b/i,
    );
    const dollars = Number(locked?.[1] ?? explicit?.[1] ?? "");
    if (dollars >= 99 && dollars <= 249) {
      cachedCents = dollars * 100;
      cachedAt = now;
      return cachedCents;
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

export function programPriceLabel(cents = PROGRAM_PRICE_CENTS) {
  return `$${(cents / 100).toFixed(0)}`;
}

export function netAfterDepositLabel(
  depositCents = DEFAULT_DEPOSIT_AMOUNT_CENTS,
  programCents = PROGRAM_PRICE_CENTS,
) {
  return `$${((programCents - depositCents) / 100).toFixed(0)}`;
}
