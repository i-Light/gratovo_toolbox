import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DataSource } from "@gratovo/core/data";
import { connectionsStatusSchema, type ConnectionsStatus, type GeminiStatus } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openExampleSource } from "../data/example-source";
import type { JobOutcome } from "../pipeline/jobs";
import type { ResultMessage, Start } from "../pipeline/protocol";
import type { SecretStore } from "../secret-store";

import {
  createConnectionsService,
  startSettings,
  type ConnectionsDeps,
  type ConnectionsServiceFull,
} from "./connections-service";

const gemini: GeminiStatus = {
  state: "stopped",
  addon: { state: "missing", version: null },
  browser: null,
  problem: null,
};
const keyId = "AKIAEXAMPLEKEY12345";
const clientSecretText = "client-secret-value";
const tokenText = "refresh-token-value";

function fakeStore(initial: Record<string, string> = {}): SecretStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (n) => Promise.resolve(values.get(n)),
    set: (n, v) => {
      values.set(n, v);
      return Promise.resolve();
    },
    delete: (n) => Promise.resolve(values.delete(n)),
    has: (n) => Promise.resolve(values.has(n)),
    names: () => Promise.resolve([...values.keys()].sort()),
  };
}

function done(result: ResultMessage | null): JobOutcome {
  return {
    ok: true,
    replies: [],
    exit: {
      kind: "ended",
      end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
      result,
    },
  };
}

describe("the connections service", () => {
  let folder: string;
  let source: DataSource | null;
  let store: ReturnType<typeof fakeStore>;
  let python: string | null;
  let starts: Start[];
  let job: () => JobOutcome;
  let emitted: ConnectionsStatus[];
  let service: ConnectionsServiceFull;
  let existing: Set<string>;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-connections-"));
    source = openExampleSource(join(folder, "example.db"));
    store = fakeStore();
    python = "python.exe";
    starts = [];
    job = () => done(null);
    emitted = [];
    existing = new Set();
    const deps: ConnectionsDeps = {
      secrets: store,
      source: () => source,
      gemini: { status: () => gemini },
      pythonPath: () => python,
      youtubeKeyAvailable: () => Promise.resolve(true),
      syncState: () => "synced",
      jobContext: () => ({ dataDir: folder, worker: "user-1" }),
      runQuickJob: (start) => {
        starts.push(start);
        return Promise.resolve(job());
      },
      pickFolder: () => Promise.resolve(join(folder, "course")),
      pathExists: (p) => Promise.resolve(existing.has(p)),
      emit: (s) => emitted.push(s),
      now: () => Date.UTC(2026, 9, 24, 10, 0, 0),
    };
    service = createConnectionsService(deps);
  });

  afterEach(async () => {
    source?.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("answers the defaults, and the answer fits the schema", async () => {
    const status = await service.status();
    expect(connectionsStatusSchema.safeParse(status).success).toBe(true);
    expect(status).toMatchObject({
      python: { state: "ready" },
      youtube: { state: "available" },
      mailApp: { set: false },
      mailboxes: [],
      mail: { label: "Gratovo Outreach", senderName: null },
      proxies: { count: 0, enabled: false, includeDirect: true },
      pacing: "normal",
      parallel: { enabled: false, maxWorkers: 4 },
      aws: { keys: false, enabled: false, regions: [] },
      course: { courseDir: null, videoDir: null, courseFound: false },
      sync: { state: "synced" },
      import: { state: "never", at: null, backup: null },
    });
  });

  it("reports python missing, and reads the import state", async () => {
    python = null;
    source?.writeSetting("import", { at: "2026-10-24T09:00:00.000Z", backup: "C:\\backups\\b1" });
    const status = await service.status();
    expect(status.python.state).toBe("missing");
    expect(status.import).toEqual({
      state: "done",
      at: "2026-10-24T09:00:00.000Z",
      backup: "C:\\backups\\b1",
    });
  });

  it("reads the import state exactly as the importer writes it", async () => {
    source?.writeSetting("import", {
      at: "2026-10-24T09:00:00.000Z",
      source: "D:/old-app/gratovo.db",
      counts: { channels: 12, creators: 3 },
      backup: "D:/backups/b2",
    });
    expect((await service.status()).import).toEqual({
      state: "done",
      at: "2026-10-24T09:00:00.000Z",
      backup: "D:/backups/b2",
    });
  });

  it("refuses every change with no source open", async () => {
    source?.close();
    const open = source;
    source = null;
    expect(await service.set({ kind: "gateways.enabled", enabled: true })).toEqual({
      ok: false,
      reason: "no_data",
    });
    expect(await service.addMailbox("a@ai-weekly.example", tokenText)).toEqual({
      ok: false,
      reason: "no_data",
    });
    source = open;
  });

  it("stores the Gmail app as a secret and never shows it", async () => {
    expect(
      await service.set({ kind: "mail.client", id: "client-id", secret: clientSecretText }),
    ).toEqual({
      ok: true,
    });
    expect(JSON.parse(store.values.get("mail.client") ?? "{}")).toEqual({
      id: "client-id",
      secret: clientSecretText,
    });
    const status = await service.status();
    expect(status.mailApp.set).toBe(true);
    expect(JSON.stringify(status)).not.toContain(clientSecretText);
    expect(JSON.stringify(emitted)).not.toContain(clientSecretText);
    expect(emitted).toHaveLength(1);
  });

  it("saves the mail label and sender name", async () => {
    await service.set({ kind: "mail.settings", label: "AI Outreach", senderName: "Sam" });
    expect((await service.status()).mail).toEqual({ label: "AI Outreach", senderName: "Sam" });
    expect(await service.set({ kind: "mail.settings", label: "  ", senderName: null })).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("adds, updates and removes a mailbox, with its token", async () => {
    expect(await service.addMailbox("Sam@AI-Weekly.example", tokenText)).toEqual({ ok: true });
    let status = await service.status();
    expect(status.mailboxes).toEqual([
      {
        address: "sam@ai-weekly.example",
        dailyCap: 20,
        warmupStartedOn: "2026-10-24",
        health: "unknown",
        checkedAt: null,
      },
    ]);
    expect(JSON.stringify(status)).not.toContain(tokenText);
    // Adding again replaces the token and keeps one row.
    await service.addMailbox("sam@ai-weekly.example", "second-token");
    expect(JSON.parse(store.values.get("mail.mailboxes") ?? "[]")).toEqual([
      { address: "sam@ai-weekly.example", refreshToken: "second-token" },
    ]);
    expect(
      await service.set({
        kind: "mailbox.update",
        address: "sam@ai-weekly.example",
        dailyCap: 30,
        warmupStartedOn: null,
      }),
    ).toEqual({ ok: true });
    status = await service.status();
    expect(status.mailboxes[0]).toMatchObject({ dailyCap: 30, warmupStartedOn: null });
    expect(
      await service.set({
        kind: "mailbox.update",
        address: "nobody@ai-weekly.example",
        dailyCap: 30,
        warmupStartedOn: null,
      }),
    ).toEqual({ ok: false, reason: "unknown_mailbox" });
    expect(await service.set({ kind: "mailbox.remove", address: "sam@ai-weekly.example" })).toEqual(
      {
        ok: true,
      },
    );
    expect((await service.status()).mailboxes).toEqual([]);
    expect(JSON.parse(store.values.get("mail.mailboxes") ?? "null")).toEqual([]);
    expect(await service.set({ kind: "mailbox.remove", address: "sam@ai-weekly.example" })).toEqual(
      {
        ok: false,
        reason: "unknown_mailbox",
      },
    );
  });

  it("allows at most 20 mailboxes", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await service.addMailbox(`box${String(i)}@ai-weekly.example`, tokenText)).toEqual({
        ok: true,
      });
    }
    expect(await service.addMailbox("one-more@ai-weekly.example", tokenText)).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(await service.addMailbox("box3@ai-weekly.example", tokenText)).toEqual({ ok: true });
  });

  it("keeps proxies secret, counts them, and checks each URL", async () => {
    expect(
      await service.set({
        kind: "proxies.urls",
        urls: ["http://user:pw@10.0.0.1:8080", "socks5://10.0.0.2:1080"],
      }),
    ).toEqual({ ok: true });
    const status = await service.status();
    expect(status.proxies.count).toBe(2);
    expect(JSON.stringify(status)).not.toContain("10.0.0.1");
    expect(await service.set({ kind: "proxies.urls", urls: ["ftp://10.0.0.1"] })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect((await service.status()).proxies.count).toBe(2);
    await service.set({ kind: "proxies.urls", urls: [] });
    expect(store.values.has("pipeline.proxies")).toBe(false);
  });

  it("saves the pipeline settings, and startSettings builds from them", async () => {
    await service.set({
      kind: "pipeline.settings",
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    const status = await service.status();
    expect(status).toMatchObject({
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    expect(startSettings(source)).toEqual({
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    await service.addMailbox("sam@ai-weekly.example", tokenText);
    expect(startSettings(source).mail).toEqual({
      label: "Gratovo Outreach",
      senderName: null,
      mailboxes: [
        { address: "sam@ai-weekly.example", dailyCap: 20, warmupStartedOn: "2026-10-24" },
      ],
    });
    expect(startSettings(null).pacing).toBe("normal");
  });

  it("stores the AWS keys and flips the gateways without losing them", async () => {
    await service.set({
      kind: "aws.keys",
      accessKeyId: keyId,
      secretAccessKey: "aws-secret-value",
    });
    expect(await secretHas("aws.keys")).toBe(true);
    store.values.set(
      "pipeline.gateways",
      JSON.stringify({
        enabled: false,
        gateways: [
          {
            region: "us-east-1",
            apiId: "abc123",
            url: "https://abc123.execute-api.us-east-1.amazonaws.com",
          },
        ],
      }),
    );
    await service.set({ kind: "gateways.enabled", enabled: true });
    const status = await service.status();
    expect(status.aws).toEqual({ keys: true, enabled: true, regions: ["us-east-1"] });
    expect(JSON.stringify(status)).not.toContain("abc123");
    expect(
      JSON.parse(store.values.get("pipeline.gateways") ?? "{}") as { gateways: unknown[] },
    ).toMatchObject({ gateways: [{}] });
    expect(
      await service.set({ kind: "aws.keys", accessKeyId: "bad", secretAccessKey: "x" }),
    ).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  function secretHas(name: string): Promise<boolean> {
    return store.has(name);
  }

  it("saves the course folders when absolute, and finds the course", async () => {
    const course = join(folder, "course");
    existing.add(course);
    expect(await service.set({ kind: "course", courseDir: course, videoDir: null })).toEqual({
      ok: true,
    });
    expect((await service.status()).course).toEqual({
      courseDir: course,
      videoDir: null,
      courseFound: true,
    });
    expect(
      await service.set({ kind: "course", courseDir: "relative/dir", videoDir: null }),
    ).toEqual({
      ok: false,
      reason: "failed",
    });
    await service.set({ kind: "course", courseDir: null, videoDir: null });
    expect((await service.status()).course.courseDir).toBeNull();
  });

  it("passes the folder dialog through", async () => {
    expect(await service.pickFolder("course")).toEqual({ path: join(folder, "course") });
  });

  describe("checking mailboxes", () => {
    it("says what is missing first", async () => {
      expect(await service.checkMailboxes()).toEqual({ ok: false, reason: "no_client" });
      await service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      expect(await service.checkMailboxes()).toEqual({ ok: false, reason: "no_mailboxes" });
      python = null;
      expect(await service.checkMailboxes()).toEqual({ ok: false, reason: "no_python" });
    });

    it("runs mail.status with only the mail secrets and keeps each answer", async () => {
      await service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      await service.addMailbox("sam@ai-weekly.example", tokenText);
      await service.addMailbox("lee@ai-weekly.example", tokenText);
      job = () =>
        done({
          type: "result",
          kind: "mail.status",
          data: {
            configured: true,
            label: "Gratovo Outreach",
            senderName: null,
            accounts: [
              {
                account: "sam@ai-weekly.example",
                connected: true,
                counters: null,
                limits: null,
                lastSweepAt: null,
                error: null,
              },
              {
                account: "lee@ai-weekly.example",
                connected: false,
                counters: null,
                limits: null,
                lastSweepAt: null,
                error: { code: "mail_auth", message: "expired" },
              },
            ],
          },
        });
      const result = await service.checkMailboxes();
      expect(result.ok).toBe(true);
      expect(starts[0]?.job).toEqual({ kind: "mail.status" });
      expect(starts[0]?.source).toBe("live");
      expect(starts[0]?.secrets.aws).toBeUndefined();
      expect(starts[0]?.secrets.mail?.mailboxes).toHaveLength(2);
      const status = await service.status();
      expect(status.mailboxes.map((m) => [m.address, m.health])).toEqual([
        ["sam@ai-weekly.example", "ok"],
        ["lee@ai-weekly.example", "signed-out"],
      ]);
      expect(status.mailboxes[0]?.checkedAt).toBe("2026-10-24T10:00:00.000Z");
    });

    it("fails when the job fails", async () => {
      await service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      await service.addMailbox("sam@ai-weekly.example", tokenText);
      job = () => done(null);
      expect(await service.checkMailboxes()).toEqual({ ok: false, reason: "failed" });
    });
  });

  describe("gateways", () => {
    const url = "https://q1w2e3.execute-api.eu-west-1.amazonaws.com";

    it("needs python and keys", async () => {
      expect(await service.deployGateways(["eu-west-1"])).toEqual({ ok: false, reason: "no_keys" });
      python = null;
      expect(await service.deployGateways(["eu-west-1"])).toEqual({
        ok: false,
        reason: "no_python",
      });
    });

    it("deploys, merges the result and shows only regions", async () => {
      await service.set({
        kind: "aws.keys",
        accessKeyId: keyId,
        secretAccessKey: "aws-secret-value",
      });
      job = () =>
        done({
          type: "result",
          kind: "gateways.deploy",
          data: {
            deployed: [{ region: "eu-west-1", apiId: "q1w2e3", url }],
            failed: [{ region: "ap-south-1", message: "denied" }],
          },
        });
      const result = await service.deployGateways(["eu-west-1", "ap-south-1"]);
      expect(result).toEqual({ ok: true, deployed: ["eu-west-1"], failed: ["ap-south-1"] });
      expect(starts[0]?.secrets.aws).toEqual({
        accessKeyId: keyId,
        secretAccessKey: "aws-secret-value",
      });
      const status = await service.status();
      expect(status.aws).toEqual({ keys: true, enabled: true, regions: ["eu-west-1"] });
      expect(JSON.stringify(status)).not.toContain("q1w2e3");
    });

    it("refuses a deploy with no room", async () => {
      await service.set({
        kind: "aws.keys",
        accessKeyId: keyId,
        secretAccessKey: "aws-secret-value",
      });
      store.values.set(
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
      expect(await service.deployGateways(["us-east-1"])).toEqual({
        ok: false,
        reason: "too_many",
      });
      expect(starts).toHaveLength(0);
    });

    it("removes a region's gateways", async () => {
      await service.set({
        kind: "aws.keys",
        accessKeyId: keyId,
        secretAccessKey: "aws-secret-value",
      });
      store.values.set(
        "pipeline.gateways",
        JSON.stringify({
          enabled: true,
          gateways: [{ region: "eu-west-1", apiId: "q1w2e3", url }],
        }),
      );
      job = () =>
        done({
          type: "result",
          kind: "gateways.destroy",
          data: { deleted: [{ region: "eu-west-1", apiId: "q1w2e3" }], failed: [] },
        });
      expect(await service.removeGateways("eu-west-1")).toEqual({ ok: true, removed: 1 });
      expect(starts[0]?.job).toEqual({
        kind: "gateways.destroy",
        gateways: [{ region: "eu-west-1", apiId: "q1w2e3" }],
      });
      expect((await service.status()).aws).toMatchObject({ enabled: false, regions: [] });
      expect(await service.removeGateways("eu-west-1")).toEqual({ ok: true, removed: 0 });
    });
  });

  it("logs no secret when a save fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.set = () => Promise.reject(new Error(clientSecretText));
    expect(await service.set({ kind: "mail.client", id: "id", secret: clientSecretText })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(clientSecretText);
    log.mockRestore();
  });
});
