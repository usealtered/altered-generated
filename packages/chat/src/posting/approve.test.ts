import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseApprovalReply } from "./approve";
import { composePostContent, buildLandingUrl } from "./generate";

describe("parseApprovalReply", () => {
  it("parses approve all variants", () => {
    assert.deepEqual(parseApprovalReply("APPROVE ALL"), {
      kind: "approve_all",
    });
    assert.deepEqual(parseApprovalReply("yes"), { kind: "approve_all" });
    assert.deepEqual(parseApprovalReply("A"), { kind: "approve_all" });
  });

  it("parses reject all variants", () => {
    assert.deepEqual(parseApprovalReply("REJECT ALL"), {
      kind: "reject_all",
    });
    assert.deepEqual(parseApprovalReply("no"), { kind: "reject_all" });
  });

  it("parses indexed approve/reject", () => {
    assert.deepEqual(parseApprovalReply("APPROVE 1 3 5"), {
      kind: "approve_indexes",
      indexes: [1, 3, 5],
    });
    assert.deepEqual(parseApprovalReply("REJECT 2,4"), {
      kind: "reject_indexes",
      indexes: [2, 4],
    });
  });

  it("returns null for unrelated text", () => {
    assert.equal(parseApprovalReply("how is the funnel"), null);
    assert.equal(parseApprovalReply(""), null);
  });
});

describe("composePostContent", () => {
  it("joins hook body cta and landing", () => {
    const content = composePostContent({
      hook: "Hook line",
      body: "Body paragraph.",
      cta: "Text +13054098546",
      landingUrl: "https://generated.api.usealtered.com/reserve?utm_source=x",
    });
    assert.match(content, /Hook line/);
    assert.match(content, /Body paragraph/);
    assert.match(content, /Text \+13054098546/);
    assert.match(content, /utm_source=x/);
  });
});

describe("buildLandingUrl", () => {
  it("adds founding cohort utm params", () => {
    const url = buildLandingUrl(
      {
        env: {
          APP_BASE_URL: "https://generated.api.usealtered.com",
        },
      } as never,
      {
        ideaId: "abcdef12-xxxx",
        platform: "twitter",
        batchId: "batch123-yyyy",
      },
    );
    assert.match(url, /\/reserve\?/);
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=founding_cohort/);
    assert.match(url, /utm_content=abcdef12/);
  });
});
