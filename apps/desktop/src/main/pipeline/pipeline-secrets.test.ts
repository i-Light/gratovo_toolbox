import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  gatewayUrlsForSearch,
  readAwsKeys,
  readGateways,
  readMailSecrets,
  removeGateways,
  saveDeployedGateways,
  setGatewaysEnabled,
} from "./pipeline-secrets";

const client = { id: "example-client.apps.example.com", secret: "example-client-secret" };
const mailboxes = [{ address: "outreach@example.com", refreshToken: "example-refresh-one" }];
const aws = { accessKeyId: "AKIAEXAMPLENOTREAL01", secretAccessKey: "example/aws+secret/key" };
const east = "https://abc123.execute-api.us-east-1.amazonaws.com/prod";
const london = "https://def456.execute-api.eu-west-2.amazonaws.com/prod";
const eastAgain = "https://ghi789.execute-api.us-east-1.amazonaws.com/prod";

function fakeStore(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    get: (name: string) => Promise.resolve(map.get(name)),
    set: (name: string, value: string) => {
      map.set(name, value);
      return Promise.resolve();
    },
    stored(name: string): unknown {
      const raw = map.get(name);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
  };
}

describe("the pipeline's secrets", () => {
  let errors: MockInstance<typeof console.error>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every console.error line so far, which must name the secret and never hold a value. */
  function logged(): string {
    return errors.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  }

  describe("mail", () => {
    it("reads the client and the mailboxes", async () => {
      const store = fakeStore({
        "mail.client": JSON.stringify(client),
        "mail.mailboxes": JSON.stringify(mailboxes),
      });
      expect(await readMailSecrets(store)).toEqual({ client, mailboxes });
    });

    it("is undefined without a client, and has no mailboxes without the list", async () => {
      expect(await readMailSecrets(fakeStore())).toBeUndefined();
      expect(await readMailSecrets(fakeStore({ "mail.client": JSON.stringify(client) }))).toEqual({
        client,
        mailboxes: [],
      });
    });

    it.each([
      ["not JSON", "{example-client-secret"],
      ["the wrong shape", JSON.stringify({ ...client, extra: "example-client-secret" })],
      ["an empty secret", JSON.stringify({ id: "example-client-id", secret: "" })],
    ])("treats a client that is %s as missing, logging only its name", async (_name, raw) => {
      expect(await readMailSecrets(fakeStore({ "mail.client": raw }))).toBeUndefined();
      expect(logged()).toContain('"mail.client"');
      expect(logged()).not.toContain("example-client");
    });

    it("treats a malformed mailbox list as none", async () => {
      const store = fakeStore({
        "mail.client": JSON.stringify(client),
        "mail.mailboxes": JSON.stringify([
          { address: "not an address", refreshToken: "tok-12345" },
        ]),
      });
      expect(await readMailSecrets(store)).toEqual({ client, mailboxes: [] });
      expect(logged()).toContain('"mail.mailboxes"');
      expect(logged()).not.toContain("tok-12345");
    });

    it("treats a store that can't be read as missing", async () => {
      const store = { get: () => Promise.reject(new Error("Secure storage is not available")) };
      expect(await readMailSecrets(store)).toBeUndefined();
      expect(logged()).toContain('"mail.client"');
    });
  });

  describe("AWS keys", () => {
    it("reads them, and treats a bad key id as missing", async () => {
      expect(await readAwsKeys(fakeStore({ "aws.keys": JSON.stringify(aws) }))).toEqual(aws);
      expect(
        await readAwsKeys(
          fakeStore({ "aws.keys": JSON.stringify({ ...aws, accessKeyId: "akia-lower" }) }),
        ),
      ).toBeUndefined();
      expect(await readAwsKeys(fakeStore())).toBeUndefined();
      expect(logged()).toContain('"aws.keys"');
      expect(logged()).not.toContain("example/aws+secret/key");
    });
  });

  describe("gateways", () => {
    it("reads the object shape", async () => {
      const state = {
        enabled: true,
        gateways: [{ region: "us-east-1", apiId: "abc123", url: east }],
      };
      const store = fakeStore({ "pipeline.gateways": JSON.stringify(state) });
      expect(await readGateways(store)).toEqual(state);
      expect(await gatewayUrlsForSearch(store)).toEqual([east]);
    });

    it("reads the old plain list as enabled, with the region from the host and no API id", async () => {
      const store = fakeStore({
        "pipeline.gateways": JSON.stringify([east, "https://gateway.example.com/prod"]),
      });
      expect(await readGateways(store)).toEqual({
        enabled: true,
        gateways: [
          { region: "us-east-1", apiId: null, url: east },
          { region: null, apiId: null, url: "https://gateway.example.com/prod" },
        ],
      });
      expect(await gatewayUrlsForSearch(store)).toEqual([east, "https://gateway.example.com/prod"]);
    });

    it("sends no URL to a search while they are turned off", async () => {
      const store = fakeStore({
        "pipeline.gateways": JSON.stringify({
          enabled: false,
          gateways: [{ region: "us-east-1", apiId: "abc123", url: east }],
        }),
      });
      expect(await gatewayUrlsForSearch(store)).toEqual([]);
    });

    it.each([
      ["missing", undefined],
      ["not JSON", `{${east}`],
      ["a list with a number", JSON.stringify([east, 5])],
      [
        "an entry with a bad region",
        JSON.stringify({ enabled: true, gateways: [{ region: "US", apiId: null, url: east }] }),
      ],
    ])("treats a value that is %s as none", async (_name, raw) => {
      const store = fakeStore(raw === undefined ? {} : { "pipeline.gateways": raw });
      expect(await readGateways(store)).toEqual({ enabled: false, gateways: [] });
      expect(await gatewayUrlsForSearch(store)).toEqual([]);
      expect(logged()).not.toContain("abc123");
    });

    it("merges a deploy by region and turns them on", async () => {
      const store = fakeStore({
        "pipeline.gateways": JSON.stringify({
          enabled: false,
          gateways: [
            { region: "us-east-1", apiId: "abc123", url: east },
            { region: null, apiId: null, url: "https://gateway.example.com/prod" },
          ],
        }),
      });

      const saved = await saveDeployedGateways(store, {
        deployed: [
          { region: "us-east-1", apiId: "ghi789", url: eastAgain },
          { region: "eu-west-2", apiId: "def456", url: london },
        ],
        failed: [{ region: "ap-south-1", message: "AccessDenied" }],
      });

      const expected = {
        enabled: true,
        gateways: [
          { region: null, apiId: null, url: "https://gateway.example.com/prod" },
          { region: "us-east-1", apiId: "ghi789", url: eastAgain },
          { region: "eu-west-2", apiId: "def456", url: london },
        ],
      };
      expect(saved).toEqual(expected);
      expect(store.stored("pipeline.gateways")).toEqual(expected);
    });

    it("turns an old plain list into the object shape when it changes", async () => {
      const store = fakeStore({ "pipeline.gateways": JSON.stringify([east]) });
      await saveDeployedGateways(store, {
        deployed: [{ region: "eu-west-2", apiId: "def456", url: london }],
        failed: [],
      });
      expect(store.stored("pipeline.gateways")).toEqual({
        enabled: true,
        gateways: [
          { region: "us-east-1", apiId: null, url: east },
          { region: "eu-west-2", apiId: "def456", url: london },
        ],
      });
    });

    it("writes nothing when a deploy deployed nothing", async () => {
      const store = fakeStore();
      expect(
        await saveDeployedGateways(store, {
          deployed: [],
          failed: [{ region: "us-east-1", message: "AccessDenied" }],
        }),
      ).toEqual({ enabled: false, gateways: [] });
      expect(store.map.size).toBe(0);
    });

    it("removes the deleted ones, and turns them off when none are left", async () => {
      const store = fakeStore({
        "pipeline.gateways": JSON.stringify({
          enabled: true,
          gateways: [
            { region: "us-east-1", apiId: "abc123", url: east },
            { region: "eu-west-2", apiId: "def456", url: london },
          ],
        }),
      });

      expect(await removeGateways(store, [{ region: "us-east-1", apiId: "abc123" }])).toEqual({
        enabled: true,
        gateways: [{ region: "eu-west-2", apiId: "def456", url: london }],
      });
      // The same id in another region is another gateway.
      await removeGateways(store, [{ region: "us-east-1", apiId: "def456" }]);
      expect(await gatewayUrlsForSearch(store)).toEqual([london]);

      await removeGateways(store, [{ region: "eu-west-2", apiId: "def456" }]);
      expect(store.stored("pipeline.gateways")).toEqual({ enabled: false, gateways: [] });
    });

    it("turns them off and on", async () => {
      const store = fakeStore({ "pipeline.gateways": JSON.stringify([east]) });
      await setGatewaysEnabled(store, false);
      expect(await gatewayUrlsForSearch(store)).toEqual([]);
      await setGatewaysEnabled(store, true);
      expect(await gatewayUrlsForSearch(store)).toEqual([east]);
    });

    it("applies changes one after another, so none is lost", async () => {
      const store = fakeStore();
      await Promise.all([
        saveDeployedGateways(store, {
          deployed: [{ region: "us-east-1", apiId: "abc123", url: east }],
          failed: [],
        }),
        saveDeployedGateways(store, {
          deployed: [{ region: "eu-west-2", apiId: "def456", url: london }],
          failed: [],
        }),
        setGatewaysEnabled(store, false),
      ]);
      expect(store.stored("pipeline.gateways")).toEqual({
        enabled: false,
        gateways: [
          { region: "us-east-1", apiId: "abc123", url: east },
          { region: "eu-west-2", apiId: "def456", url: london },
        ],
      });
    });

    it("never writes over a value it couldn't read", async () => {
      const store = {
        get: () => Promise.reject(new Error("Secure storage is not available")),
        set: vi.fn(() => Promise.resolve()),
      };
      await expect(setGatewaysEnabled(store, true)).rejects.toThrow("not available");
      expect(store.set).not.toHaveBeenCalled();
    });
  });
});
