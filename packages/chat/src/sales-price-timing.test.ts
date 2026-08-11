import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SALES_SYSTEM } from "./sales";

describe("sales price timing (prompt lock)", () => {
  it("forbids opening with price before qualify", () => {
    assert.match(SALES_SYSTEM, /Do NOT mention price or deposit yet/i);
    assert.match(SALES_SYSTEM, /AFTER qualified/i);
    assert.match(SALES_SYSTEM, /Do not open with \$100/i);
    assert.match(SALES_SYSTEM, /Never assume they saw a price/i);
  });

  it("keeps checkout after buying signal only", () => {
    assert.match(SALES_SYSTEM, /On buying signal: get_checkout_link/i);
  });
});
