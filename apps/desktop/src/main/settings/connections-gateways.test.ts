import { describe, expect, it } from "vitest";

import { done, keyId, useConnections } from "./connections-harness";

describe("the connections service's gateways", () => {
  const h = useConnections();
  const url = "https://q1w2e3.execute-api.eu-west-1.amazonaws.com";

  async function storeKeys(): Promise<void> {
    await h.service.set({
      kind: "aws.keys",
      accessKeyId: keyId,
      secretAccessKey: "aws-secret-value",
    });
  }

  it("needs python and keys", async () => {
    expect(await h.service.deployGateways(["eu-west-1"])).toEqual({
      ok: false,
      reason: "no_keys",
    });
    h.python = null;
    expect(await h.service.deployGateways(["eu-west-1"])).toEqual({
      ok: false,
      reason: "no_python",
    });
    expect(await h.service.removeGateways("eu-west-1")).toEqual({
      ok: false,
      reason: "no_python",
    });
  });

  it("needs an open source", async () => {
    h.source?.close();
    h.source = null;
    expect(await h.service.deployGateways(["eu-west-1"])).toEqual({
      ok: false,
      reason: "no_data",
    });
    expect(await h.service.removeGateways("eu-west-1")).toEqual({ ok: false, reason: "no_data" });
  });

  it("deploys, merges the result and shows only regions", async () => {
    await storeKeys();
    h.job = () =>
      done({
        type: "result",
        kind: "gateways.deploy",
        data: {
          deployed: [{ region: "eu-west-1", apiId: "q1w2e3", url }],
          failed: [{ region: "ap-south-1", message: "denied" }],
        },
      });
    const result = await h.service.deployGateways(["eu-west-1", "ap-south-1"]);
    expect(result).toEqual({ ok: true, deployed: ["eu-west-1"], failed: ["ap-south-1"] });
    expect(h.starts[0]?.secrets.aws).toEqual({
      accessKeyId: keyId,
      secretAccessKey: "aws-secret-value",
    });
    expect(h.starts[0]?.secrets.mail).toBeUndefined();
    const status = await h.service.status();
    expect(status.aws).toEqual({ keys: true, enabled: true, regions: ["eu-west-1"] });
    expect(JSON.stringify(status)).not.toContain("q1w2e3");
  });

  it("refuses a deploy with no room", async () => {
    await storeKeys();
    h.store.values.set(
      "pipeline.gateways",
      JSON.stringify({
        enabled: true,
        gateways: Array.from({ length: 100 }, (_, i) => ({
          region: "eu-west-1",
          apiId: `id${String(i)}`,
          url: `https://id${String(i)}.execute-api.eu-west-1.amazonaws.com`,
        })),
      }),
    );
    expect(await h.service.deployGateways(["us-east-1"])).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(h.starts).toHaveLength(0);
  });

  it("removes a region's gateways", async () => {
    await storeKeys();
    h.store.values.set(
      "pipeline.gateways",
      JSON.stringify({
        enabled: true,
        gateways: [{ region: "eu-west-1", apiId: "q1w2e3", url }],
      }),
    );
    h.job = () =>
      done({
        type: "result",
        kind: "gateways.destroy",
        data: { deleted: [{ region: "eu-west-1", apiId: "q1w2e3" }], failed: [] },
      });
    expect(await h.service.removeGateways("eu-west-1")).toEqual({ ok: true, removed: 1 });
    expect(h.starts[0]?.job).toEqual({
      kind: "gateways.destroy",
      gateways: [{ region: "eu-west-1", apiId: "q1w2e3" }],
    });
    expect((await h.service.status()).aws).toMatchObject({ enabled: false, regions: [] });
    expect(await h.service.removeGateways("eu-west-1")).toEqual({ ok: true, removed: 0 });
  });
});
