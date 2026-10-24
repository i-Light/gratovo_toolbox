import { join } from "node:path";

import { connectionsStatusSchema } from "@gratovo/ipc";
import { describe, expect, it, vi } from "vitest";

import { clientSecretText, keyId, tokenText, useConnections } from "./connections-harness";
import { startSettings } from "./connections-service";

describe("the connections service", () => {
  const h = useConnections();

  it("answers the defaults, and the answer fits the schema", async () => {
    const status = await h.service.status();
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
    h.python = null;
    h.source?.writeSetting("import", { at: "2026-10-24T09:00:00.000Z", backup: "C:\\backups\\b1" });
    const status = await h.service.status();
    expect(status.python.state).toBe("missing");
    expect(status.import).toEqual({
      state: "done",
      at: "2026-10-24T09:00:00.000Z",
      backup: "C:\\backups\\b1",
    });
  });

  it("reads the import state exactly as the importer writes it", async () => {
    h.source?.writeSetting("import", {
      at: "2026-10-24T09:00:00.000Z",
      source: "D:/old-app/gratovo.db",
      counts: { channels: 12, creators: 3 },
      backup: "D:/backups/b2",
    });
    expect((await h.service.status()).import).toEqual({
      state: "done",
      at: "2026-10-24T09:00:00.000Z",
      backup: "D:/backups/b2",
    });
  });

  it("refuses every change with no source open", async () => {
    h.source?.close();
    h.source = null;
    expect(await h.service.set({ kind: "gateways.enabled", enabled: true })).toEqual({
      ok: false,
      reason: "no_data",
    });
    expect(await h.service.addMailbox("a@ai-weekly.example", tokenText)).toEqual({
      ok: false,
      reason: "no_data",
    });
  });

  it("stores the Gmail app as a secret and never shows it", async () => {
    expect(
      await h.service.set({ kind: "mail.client", id: "client-id", secret: clientSecretText }),
    ).toEqual({
      ok: true,
    });
    expect(JSON.parse(h.store.values.get("mail.client") ?? "{}")).toEqual({
      id: "client-id",
      secret: clientSecretText,
    });
    const status = await h.service.status();
    expect(status.mailApp.set).toBe(true);
    expect(JSON.stringify(status)).not.toContain(clientSecretText);
    expect(JSON.stringify(h.emitted)).not.toContain(clientSecretText);
    expect(h.emitted).toHaveLength(1);
  });

  it("saves the mail label and sender name", async () => {
    await h.service.set({ kind: "mail.settings", label: "AI Outreach", senderName: "Sam" });
    expect((await h.service.status()).mail).toEqual({ label: "AI Outreach", senderName: "Sam" });
    expect(await h.service.set({ kind: "mail.settings", label: "  ", senderName: null })).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("keeps proxies secret, counts them, and checks each URL", async () => {
    expect(
      await h.service.set({
        kind: "proxies.urls",
        urls: ["http://user:pw@10.0.0.1:8080", "socks5://10.0.0.2:1080"],
      }),
    ).toEqual({ ok: true });
    const status = await h.service.status();
    expect(status.proxies.count).toBe(2);
    expect(JSON.stringify(status)).not.toContain("10.0.0.1");
    expect(await h.service.set({ kind: "proxies.urls", urls: ["ftp://10.0.0.1"] })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect((await h.service.status()).proxies.count).toBe(2);
    await h.service.set({ kind: "proxies.urls", urls: [] });
    expect(h.store.values.has("pipeline.proxies")).toBe(false);
  });

  it("saves the pipeline settings, and startSettings builds from them", async () => {
    await h.service.set({
      kind: "pipeline.settings",
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    const status = await h.service.status();
    expect(status).toMatchObject({
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    expect(startSettings(h.source)).toEqual({
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 6 },
      proxies: { enabled: true, includeDirect: false },
    });
    expect(startSettings(null).pacing).toBe("normal");
  });

  it("stores the AWS keys and flips the gateways without losing them", async () => {
    await h.service.set({
      kind: "aws.keys",
      accessKeyId: keyId,
      secretAccessKey: "aws-secret-value",
    });
    expect(await h.store.has("aws.keys")).toBe(true);
    h.store.values.set(
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
    await h.service.set({ kind: "gateways.enabled", enabled: true });
    const status = await h.service.status();
    expect(status.aws).toEqual({ keys: true, enabled: true, regions: ["us-east-1"] });
    expect(JSON.stringify(status)).not.toContain("abc123");
    expect(
      JSON.parse(h.store.values.get("pipeline.gateways") ?? "{}") as { gateways: unknown[] },
    ).toMatchObject({ gateways: [{}] });
    expect(
      await h.service.set({ kind: "aws.keys", accessKeyId: "bad", secretAccessKey: "x" }),
    ).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("saves the course folders when absolute, and finds the course", async () => {
    const course = join(h.folder, "course");
    h.existing.add(course);
    expect(await h.service.set({ kind: "course", courseDir: course, videoDir: null })).toEqual({
      ok: true,
    });
    expect((await h.service.status()).course).toEqual({
      courseDir: course,
      videoDir: null,
      courseFound: true,
    });
    expect(
      await h.service.set({ kind: "course", courseDir: "relative/dir", videoDir: null }),
    ).toEqual({
      ok: false,
      reason: "failed",
    });
    await h.service.set({ kind: "course", courseDir: null, videoDir: null });
    expect((await h.service.status()).course.courseDir).toBeNull();
  });

  it("passes the folder dialog through", async () => {
    expect(await h.service.pickFolder("course")).toEqual({ path: join(h.folder, "course") });
  });

  it("logs no secret when a save fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.store.set = () => Promise.reject(new Error(clientSecretText));
    expect(
      await h.service.set({ kind: "mail.client", id: "id", secret: clientSecretText }),
    ).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(clientSecretText);
    log.mockRestore();
  });
});
