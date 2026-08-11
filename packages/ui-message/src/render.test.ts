import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveUiMedia } from "./render";

describe("resolveUiMedia", () => {
  it("passthroughs public URLs without calling Sendblue", async () => {
    const resolved = await resolveUiMedia(
      {
        type: "image",
        source: {
          kind: "url",
          url: "https://example.com/AlteredCard.png",
        },
        caption: "hi",
      },
      { auth: { apiKey: "k", apiSecret: "s" } },
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.media.hosting, "passthrough_url");
    assert.equal(resolved.media.mediaUrl, "https://example.com/AlteredCard.png");
    assert.equal(resolved.media.caption, "hi");
  });

  it("rejects invalid payloads", async () => {
    const resolved = await resolveUiMedia(
      {
        type: "image",
        source: { kind: "url", url: "not-a-url" },
      } as unknown as Parameters<typeof resolveUiMedia>[0],
      { auth: { apiKey: "k", apiSecret: "s" } },
    );
    assert.equal(resolved.ok, false);
  });
});
