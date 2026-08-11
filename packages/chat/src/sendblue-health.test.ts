import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { checkSendblueDeviceHealth } from "./sendblue-health";

describe("checkSendblueDeviceHealth", () => {
  it("flags deviceDown when recent outbound ERROR 5504 and no later success", async () => {
    const now = Date.now();
    const payload = {
      data: [
        {
          is_outbound: true,
          status: "ERROR",
          error_code: 5504,
          error_message:
            'Device send failed: Messages got an error: Application isn’t running. (-600)',
          date_sent: new Date(now - 60_000).toISOString(),
          to_number: "+12368370221",
          content: "hello",
        },
        {
          is_outbound: true,
          status: "DELIVERED",
          date_sent: new Date(now - 20 * 60_000).toISOString(),
          to_number: "+12368370221",
          content: "older ok",
        },
      ],
    };

    mock.method(globalThis, "fetch", async () =>
      Response.json(payload, { status: 200 }),
    );

    const health = await checkSendblueDeviceHealth(
      {
        SENDBLUE_API_KEY: "k",
        SENDBLUE_API_SECRET: "s",
        SENDBLUE_FROM_NUMBER: "+13054098546",
      },
      { lookbackMinutes: 90 },
    );

    assert.equal(health.deviceDown, true);
    assert.equal(health.ok, false);
    assert.equal(health.errorCount, 1);
    assert.match(health.diagnosis ?? "", /Messages\.app/);
  });

  it("is ok when recent outbound delivered", async () => {
    const now = Date.now();
    mock.method(globalThis, "fetch", async () =>
      Response.json(
        {
          data: [
            {
              is_outbound: true,
              status: "DELIVERED",
              date_sent: new Date(now - 30_000).toISOString(),
              to_number: "+12368370221",
              content: "ok",
            },
          ],
        },
        { status: 200 },
      ),
    );

    const health = await checkSendblueDeviceHealth({
      SENDBLUE_API_KEY: "k",
      SENDBLUE_API_SECRET: "s",
      SENDBLUE_FROM_NUMBER: "+13054098546",
    });

    assert.equal(health.ok, true);
    assert.equal(health.deviceDown, false);
    assert.equal(health.errorCount, 0);
  });
});
