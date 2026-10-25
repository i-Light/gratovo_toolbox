import { afterEach, describe, expect, it, vi } from "vitest";

import { clientSecretText, done, tokenText, useConnections } from "./connections-harness";
import { maxMailboxes, startSettings } from "./connections-service";

describe("the connections service's mailboxes", () => {
  const h = useConnections();

  it("adds, updates and removes a mailbox, with its token", async () => {
    expect(await h.service.addMailbox("Sam@AI-Weekly.example", tokenText)).toEqual({ ok: true });
    let status = await h.service.status();
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
    await h.service.addMailbox("sam@ai-weekly.example", "second-token");
    expect(JSON.parse(h.store.values.get("mail.mailboxes") ?? "[]")).toEqual([
      { address: "sam@ai-weekly.example", refreshToken: "second-token" },
    ]);
    expect(
      await h.service.set({
        kind: "mailbox.update",
        address: "sam@ai-weekly.example",
        dailyCap: 30,
        warmupStartedOn: null,
      }),
    ).toEqual({ ok: true });
    status = await h.service.status();
    expect(status.mailboxes[0]).toMatchObject({ dailyCap: 30, warmupStartedOn: null });
    expect(
      await h.service.set({
        kind: "mailbox.update",
        address: "nobody@ai-weekly.example",
        dailyCap: 30,
        warmupStartedOn: null,
      }),
    ).toEqual({ ok: false, reason: "unknown_mailbox" });
    // Reach's pause of it (and any other mailbox's) is in the source's settings.
    h.source?.writeSetting("reach.mailboxes", {
      "sam@ai-weekly.example": { paused: true, slowed: true },
      "lee@ai-weekly.example": { paused: true, slowed: false },
    });
    expect(
      await h.service.set({ kind: "mailbox.remove", address: "sam@ai-weekly.example" }),
    ).toEqual({ ok: true });
    expect((await h.service.status()).mailboxes).toEqual([]);
    // Its flags go with it, so adding it again starts fresh; the others stay.
    expect(h.source?.readSetting("reach.mailboxes")).toEqual({
      "lee@ai-weekly.example": { paused: true, slowed: false },
    });
    expect(JSON.parse(h.store.values.get("mail.mailboxes") ?? "null")).toEqual([]);
    expect(
      await h.service.set({ kind: "mailbox.remove", address: "sam@ai-weekly.example" }),
    ).toEqual({ ok: false, reason: "unknown_mailbox" });
  });

  it("allows at most 20 mailboxes", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await h.service.addMailbox(`box${String(i)}@ai-weekly.example`, tokenText)).toEqual({
        ok: true,
      });
    }
    expect(await h.service.addMailbox("one-more@ai-weekly.example", tokenText)).toEqual({
      ok: false,
      reason: "too_many",
      known: false,
    });
    expect(await h.service.addMailbox("box3@ai-weekly.example", tokenText)).toEqual({ ok: true });
  });

  describe("a save that fails", () => {
    const secretName = "mail.mailboxes";
    const failRowWrite = (): void => {
      const source = h.source;
      if (source === null) {
        throw new Error("no source");
      }
      vi.spyOn(source, "writeSetting").mockImplementation(() => {
        throw new Error("disk full");
      });
    };
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("says a stored address is known, and keeps its old token", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      const before = h.store.values.get(secretName);
      vi.spyOn(h.store, "set").mockRejectedValue(new Error("locked"));
      expect(await h.service.addMailbox("Sam@AI-Weekly.example", "second-token")).toEqual({
        ok: false,
        reason: "failed",
        known: true,
      });
      expect(h.store.values.get(secretName)).toBe(before);
    });

    it("puts the token secret back when the row can't be written", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      const before = h.store.values.get(secretName);
      failRowWrite();
      expect(await h.service.addMailbox("lee@ai-weekly.example", "lee-token")).toEqual({
        ok: false,
        reason: "failed",
        known: false,
      });
      // No dead token is left taking a place.
      expect(h.store.values.get(secretName)).toBe(before);
      expect(await h.service.mailboxCount()).toBe(1);
    });

    it("removes the token secret again when there was none before", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      failRowWrite();
      expect(await h.service.addMailbox("lee@ai-weekly.example", "lee-token")).toEqual({
        ok: false,
        reason: "failed",
        known: false,
      });
      expect(h.store.values.has(secretName)).toBe(false);
      expect(await h.service.mailboxCount()).toBe(0);
    });

    it("says known for a token with no row, and puts its old token back", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const before = JSON.stringify([
        { address: "sam@ai-weekly.example", refreshToken: tokenText },
      ]);
      h.store.values.set(secretName, before);
      failRowWrite();
      expect(await h.service.addMailbox("sam@ai-weekly.example", "second-token")).toEqual({
        ok: false,
        reason: "failed",
        known: true,
      });
      expect(h.store.values.get(secretName)).toBe(before);
    });

    it("says known when the new token can't be taken back out (it stays stored)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      failRowWrite();
      vi.spyOn(h.store, "delete").mockRejectedValue(new Error("locked"));
      expect(await h.service.addMailbox("lee@ai-weekly.example", "lee-token")).toEqual({
        ok: false,
        reason: "failed",
        known: true,
      });
    });

    it("is still a save when the status can't be sent afterwards", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(h.emitted, "push").mockImplementation(() => {
        throw new Error("window gone");
      });
      expect(await h.service.addMailbox("lee@ai-weekly.example", tokenText)).toEqual({ ok: true });
    });
  });

  describe("mailboxCount", () => {
    it("counts the rows and the stored tokens together, each address once", async () => {
      expect(await h.service.mailboxCount()).toBe(0);
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      expect(await h.service.mailboxCount()).toBe(1);
      // A token with no settings row (a row removed by hand, say) still takes a place...
      h.store.values.set(
        "mail.mailboxes",
        JSON.stringify([
          { address: "sam@ai-weekly.example", refreshToken: tokenText },
          { address: "lee@ai-weekly.example", refreshToken: tokenText },
        ]),
      );
      // ...and so does a row with no token; an address in both counts once.
      h.source?.writeSetting("mail.settings", {
        label: "Gratovo Outreach",
        senderName: null,
        mailboxes: [
          { address: "Sam@AI-Weekly.example", dailyCap: 20, warmupStartedOn: null },
          { address: "kai@ai-weekly.example", dailyCap: 20, warmupStartedOn: null },
        ],
      });
      expect(await h.service.mailboxCount()).toBe(3);
    });

    it("agrees with what addMailbox enforces", async () => {
      // 19 rows and one token-only address: 20 in all, so the pre-check and the save both say no.
      h.source?.writeSetting("mail.settings", {
        label: "Gratovo Outreach",
        senderName: null,
        mailboxes: Array.from({ length: maxMailboxes - 1 }, (_, i) => ({
          address: `box${String(i)}@ai-weekly.example`,
          dailyCap: 20,
          warmupStartedOn: null,
        })),
      });
      h.store.values.set(
        "mail.mailboxes",
        JSON.stringify([{ address: "orphan@ai-weekly.example", refreshToken: tokenText }]),
      );
      expect(await h.service.mailboxCount()).toBe(maxMailboxes);
      expect(await h.service.addMailbox("new@ai-weekly.example", tokenText)).toEqual({
        ok: false,
        reason: "too_many",
        known: false,
      });
    });

    it("builds no status, runs no job and emits nothing", async () => {
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      const emittedBefore = h.emitted.length;
      const builtBefore = h.statusBuilds;
      expect(await h.service.mailboxCount()).toBe(1);
      expect(h.statusBuilds).toBe(builtBefore);
      expect(h.starts).toHaveLength(0);
      expect(h.emitted).toHaveLength(emittedBefore);
    });

    it("counts the stored tokens with no source open", async () => {
      h.store.values.set(
        "mail.mailboxes",
        JSON.stringify([{ address: "sam@ai-weekly.example", refreshToken: tokenText }]),
      );
      h.source?.close();
      h.source = null;
      expect(await h.service.mailboxCount()).toBe(1);
    });
  });

  it("puts the mail settings in job start messages, and leaves them out on request", async () => {
    await h.service.addMailbox("sam@ai-weekly.example", tokenText);
    expect(startSettings(h.source).mail).toEqual({
      label: "Gratovo Outreach",
      senderName: null,
      mailboxes: [
        { address: "sam@ai-weekly.example", dailyCap: 20, warmupStartedOn: "2026-10-24" },
      ],
    });
    const forSearch = startSettings(h.source, { mail: false });
    expect(forSearch).not.toHaveProperty("mail");
    expect(JSON.stringify(forSearch)).not.toContain("ai-weekly.example");
    expect(forSearch.pacing).toBe("normal");
  });

  describe("checking mailboxes", () => {
    it("says what is missing first", async () => {
      expect(await h.service.checkMailboxes()).toEqual({ ok: false, reason: "no_client" });
      await h.service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      expect(await h.service.checkMailboxes()).toEqual({ ok: false, reason: "no_mailboxes" });
      h.python = null;
      expect(await h.service.checkMailboxes()).toEqual({ ok: false, reason: "no_python" });
    });

    it("runs mail.status with only the mail secrets and keeps each answer", async () => {
      await h.service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      await h.service.addMailbox("lee@ai-weekly.example", tokenText);
      h.job = () =>
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
      const result = await h.service.checkMailboxes();
      expect(result.ok).toBe(true);
      expect(h.starts[0]?.job).toEqual({ kind: "mail.status" });
      expect(h.starts[0]?.source).toBe("live");
      expect(h.starts[0]?.secrets.aws).toBeUndefined();
      expect(h.starts[0]?.secrets.mail?.mailboxes).toHaveLength(2);
      expect(h.starts[0]?.settings.mail?.mailboxes).toHaveLength(2);
      const status = await h.service.status();
      expect(status.mailboxes.map((m) => [m.address, m.health])).toEqual([
        ["sam@ai-weekly.example", "ok"],
        ["lee@ai-weekly.example", "signed-out"],
      ]);
      expect(status.mailboxes[0]?.checkedAt).toBe("2026-10-24T10:00:00.000Z");
      // A removed mailbox's answer goes with it.
      await h.service.set({ kind: "mailbox.remove", address: "lee@ai-weekly.example" });
      await h.service.addMailbox("lee@ai-weekly.example", tokenText);
      expect((await h.service.status()).mailboxes[1]?.health).toBe("unknown");
    });

    it("fails when the job fails", async () => {
      await h.service.set({ kind: "mail.client", id: "id", secret: clientSecretText });
      await h.service.addMailbox("sam@ai-weekly.example", tokenText);
      h.job = () => done(null);
      expect(await h.service.checkMailboxes()).toEqual({ ok: false, reason: "failed" });
    });
  });
});
