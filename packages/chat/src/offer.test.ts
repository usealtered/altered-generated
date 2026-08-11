import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveDepositAmountCents, DEFAULT_DEPOSIT_AMOUNT_CENTS, resetDepositAmountCache } from "./offer";

describe("resolveDepositAmountCents", () => {
  it("reads locked $100 from offer markdown", async () => {
    resetDepositAmountCache();
    const root = await mkdtemp(path.join(tmpdir(), "offer-"));
    await mkdir(path.join(root, "offers"), { recursive: true });
    await writeFile(
      path.join(root, "offers/early-access-deposit.md"),
      "# Offer\n\n**LOCKED** Deposit **$100** USD program reservation deposit.\n",
    );
    const cents = await resolveDepositAmountCents(root);
    assert.equal(cents, 10_000);
  });

  it("falls back to default when file missing", async () => {
    resetDepositAmountCache();
    const root = await mkdtemp(path.join(tmpdir(), "offer-missing-"));
    const cents = await resolveDepositAmountCents(root);
    assert.equal(cents, DEFAULT_DEPOSIT_AMOUNT_CENTS);
  });
});
