import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleFrame, mentionsMoney, nameMax, notifyKind } from "@gratovo/core/data";
import { frameSchema } from "@gratovo/ipc";
import type { DataSource, DataWrite, Frame, FrameSource } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db/open-database";

import {
  insertLogRow,
  replaceMemberAccess,
  upsertCreator,
  upsertDeal,
  upsertNotification,
} from "./repositories";
import type { ActivityRow, MemberAccessRow } from "./repositories";

/** The fixed time the contract runs at. */
export const contractNow = Date.UTC(2026, 9, 20, 12, 0, 0);

/**
 * Opens a source on `file`, a database holding the example fixtures (member `u1`, whose name is
 * unset, and the example creators, brands, deals and notifications). It is called again with the
 * same file to reopen. `now` is the clock the source must use.
 */
export type MakeSource = (file: string, now: () => number) => DataSource;

const idA = "00000000-0000-4000-8000-00000000000a";
const idB = "00000000-0000-4000-8000-00000000000b";

/** Replaces every `member_access` row in `file`, as the team refresh does, from another connection. */
function setAccess(file: string, rows: readonly Omit<MemberAccessRow, "updatedAt">[]): void {
  const db = openDatabase(file);
  try {
    const updatedAt = new Date(contractNow).toISOString();
    replaceMemberAccess(
      db,
      rows.map((row) => ({ ...row, updatedAt })),
    );
  } finally {
    db.close();
  }
}

/** Runs `fn` on a second connection to `file`, as the sync would. */
function withDb(file: string, fn: (db: ReturnType<typeof openDatabase>) => void): void {
  const db = openDatabase(file);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function logRow(id: string, at: string, over: Partial<ActivityRow>): ActivityRow {
  return {
    id,
    at,
    actor_id: "u1",
    actor_name: "Ada",
    actor_role: "owner",
    action: "note",
    entity_type: "app",
    entity_id: null,
    entity_label: null,
    field: null,
    old_value: null,
    new_value: null,
    detail: null,
    ...over,
  };
}

/** Whether a notification is about money. */
function isMoney(n: Frame["notifications"][number]): boolean {
  return notifyKind(n.icon) === "money";
}

/** The tests every `DataSource` over the local database must pass. */
/** `kind` is what the source's frames must say they are: "example" or "live". */
export function describeDataSourceContract(
  name: string,
  kind: FrameSource,
  make: MakeSource,
): void {
  describe(`${name}: the data source contract`, () => {
    let folder: string;
    let file: string;
    let open: DataSource[];

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "gratovo-source-"));
      file = join(folder, "test.db");
      open = [];
    });

    afterEach(async () => {
      // Close before removing: Windows will not delete an open file. A second close is a no-op.
      for (const source of open) {
        source.close();
      }
      await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    function start(): DataSource {
      const source = make(file, () => contractNow);
      open.push(source);
      return source;
    }

    async function writeAll(source: DataSource, ...writes: DataWrite[]): Promise<Frame> {
      await source.write(writes);
      return source.frame();
    }

    it("round-trips the seeded fixtures", async () => {
      const frame = await start().frame();
      const expected = exampleFrame(contractNow);
      expect(frame.source).toBe(kind);
      expect(frame.me).toBe("u1");
      expect(frame.myName).toBeNull();
      expect(frame.creators).toEqual(expected.creators);
      expect(frame.brands).toEqual(expected.brands);
      expect(frame.deals).toEqual(expected.deals);
      expect(frame.notifications).toEqual(expected.notifications);
      expect(frame.team.map(({ id, name, role, roles }) => ({ id, name, role, roles }))).toEqual(
        expected.team.map(({ id, name, role, roles }) => ({ id, name, role, roles })),
      );
      expect(frame.log).toEqual([]);
      expect(frame.notify).toEqual({});
      expect(frame.seesMoney).toBe(true);
    });

    it("hides money from a member who may not see it: no price, no money notification", async () => {
      const source = start();
      const before = await source.frame();
      expect(before.notifications.some(isMoney)).toBe(true);
      setAccess(file, [{ profileId: "u1", roles: ["scout", "outreach"], seesMoney: false }]);
      const frame = await source.frame();
      expect(frame.seesMoney).toBe(false);
      expect(frame.deals).toEqual(before.deals.map((deal) => ({ ...deal, price: null })));
      expect(frame.notifications).toEqual(
        before.notifications.filter(
          (n) => !isMoney(n) && !mentionsMoney(n.text) && !mentionsMoney(n.sub),
        ),
      );
      expect(frame.notifications.length).toBeGreaterThan(0);
      // Turning the switch on shows money again; nothing was lost.
      setAccess(file, [{ profileId: "u1", roles: ["scout"], seesMoney: true }]);
      const back = await source.frame();
      expect(back.seesMoney).toBe(true);
      expect(back.deals).toEqual(before.deals);
      expect(back.notifications).toEqual(before.notifications);
    });

    it("shows money to an Owner whatever the switch says, and hides it with no row", async () => {
      const source = start();
      setAccess(file, [{ profileId: "u1", roles: ["owner"], seesMoney: false }]);
      expect((await source.frame()).seesMoney).toBe(true);
      setAccess(file, [{ profileId: "u2", roles: ["owner"], seesMoney: true }]);
      const frame = await source.frame();
      expect(frame.seesMoney).toBe(false);
      expect(frame.deals.every((deal) => deal.price === null)).toBe(true);
    });

    it("round-trips each member's roles in display order, and none without a row", async () => {
      const source = start();
      setAccess(file, [
        { profileId: "u1", roles: ["delivery", "owner"], seesMoney: false },
        { profileId: "u3", roles: ["outreach", "scout", "outreach"], seesMoney: false },
      ]);
      const frame = await source.frame();
      expect(Object.fromEntries(frame.team.map((m) => [m.id, m.roles]))).toEqual({
        u1: ["owner", "delivery"],
        u2: [],
        u3: ["scout", "outreach"],
        u4: [],
      });
    });

    it("marks a notification read and unread", async () => {
      const source = start();
      let frame = await writeAll(source, { kind: "notification.read", id: "n1", read: true });
      expect(frame.notifications.find((n) => n.id === "n1")?.read).toBe(true);
      frame = await writeAll(
        source,
        { kind: "notification.read", id: "n1", read: false },
        { kind: "notification.read", id: "n4", read: false },
      );
      expect(frame.notifications.find((n) => n.id === "n1")?.read).toBe(false);
      expect(frame.notifications.find((n) => n.id === "n4")?.read).toBe(false);
      expect(frame.notifications.find((n) => n.id === "n3")?.read).toBe(false);
      expect(frame.notifications.find((n) => n.id === "n5")?.read).toBe(true);
    });

    it("replaces the whole notify map", async () => {
      const source = start();
      let frame = await writeAll(source, { kind: "notify.set", notify: { money: false } });
      expect(frame.notify).toEqual({ money: false });
      frame = await writeAll(source, { kind: "notify.set", notify: { reply: false } });
      expect(frame.notify).toEqual({ reply: false });
      frame = await writeAll(source, { kind: "notify.set", notify: {} });
      expect(frame.notify).toEqual({});
    });

    it("sets your name, and an empty name means unset", async () => {
      const source = start();
      let frame = await writeAll(source, { kind: "me.name", name: "Ada" });
      expect(frame.myName).toBe("Ada");
      expect(frame.team.find((m) => m.id === "u1")?.name).toBe("Ada");
      frame = await writeAll(source, { kind: "me.name", name: "" });
      expect(frame.myName).toBeNull();
      expect(frame.team.find((m) => m.id === "u1")?.name).toBe("");
    });

    it("trims the name and cuts it to the limit", async () => {
      const source = start();
      let frame = await writeAll(source, { kind: "me.name", name: "  Ada Lovelace \n" });
      expect(frame.myName).toBe("Ada Lovelace");
      frame = await writeAll(source, { kind: "me.name", name: "x".repeat(nameMax + 20) });
      expect(frame.myName).toBe("x".repeat(nameMax));
      frame = await writeAll(source, { kind: "me.name", name: "   " });
      expect(frame.myName).toBeNull();
    });

    it("adds log lines as you, newest first, and removes them", async () => {
      const source = start();
      await writeAll(source, { kind: "me.name", name: "Ada" });
      let frame = await writeAll(
        source,
        { kind: "log.add", id: idA, at: contractNow - 2000, text: "Marked all read" },
        { kind: "log.add", id: idB, at: contractNow - 1000, text: "Changed a switch" },
      );
      expect(frame.log).toEqual([
        { id: idB, at: contractNow - 1000, who: "u1", text: "Changed a switch" },
        { id: idA, at: contractNow - 2000, who: "u1", text: "Marked all read" },
      ]);
      frame = await writeAll(source, { kind: "log.remove", id: idB });
      expect(frame.log.map((line) => line.id)).toEqual([idA]);
    });

    it("keeps only the newest 50 log lines", async () => {
      const source = start();
      const writes: DataWrite[] = [];
      for (let i = 0; i < 55; i += 1) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        writes.push({ kind: "log.add", id, at: contractNow + i, text: `Line ${String(i)}` });
      }
      const frame = await writeAll(source, ...writes);
      expect(frame.log).toHaveLength(50);
      expect(frame.log[0]?.text).toBe("Line 54");
      expect(frame.log[49]?.text).toBe("Line 5");
    });

    it("ignores unknown ids", async () => {
      const source = start();
      const before = await source.frame();
      const after = await writeAll(
        source,
        { kind: "notification.read", id: "nope", read: true },
        { kind: "log.remove", id: idA },
      );
      expect(after).toEqual(before);
    });

    it("applies a creator's stage, a brand and a deal's step, and ignores unknown ids", async () => {
      const source = start();
      const frame = await writeAll(
        source,
        { kind: "creator.stage", id: "c1", stage: "emailed" },
        { kind: "creator.stage", id: "nope", stage: "emailed" },
        {
          kind: "brand.set",
          id: "b1",
          name: "Codewell Pro",
          sells: "AI code review",
          status: "won",
        },
        { kind: "brand.set", id: "b9", name: "Tensorly", sells: "AI notebooks", status: "found" },
        { kind: "deal.step", id: "d1", step: 4 },
        { kind: "deal.step", id: "nope", step: 4 },
      );
      expect(frame.creators.find((c) => c.id === "c1")?.stage).toBe("emailed");
      expect(frame.creators).toHaveLength(exampleFrame(contractNow).creators.length);
      expect(frame.brands.find((b) => b.id === "b1")?.name).toBe("Codewell Pro");
      expect(frame.brands.find((b) => b.id === "b9")).toEqual({
        id: "b9",
        name: "Tensorly",
        sells: "AI notebooks",
        status: "found",
      });
      expect(frame.deals.find((d) => d.id === "d1")?.step).toBe(4);
      expect(frame.deals).toHaveLength(exampleFrame(contractNow).deals.length);
      expect(frame.conflicts).toEqual([]);
    });

    it("applies nothing when a batch fails part way", async () => {
      const source = start();
      await writeAll(source, { kind: "log.add", id: idA, at: contractNow, text: "First" });
      const before = await source.frame();
      await expect(
        source.write([
          { kind: "notification.read", id: "n1", read: true },
          { kind: "notify.set", notify: { money: false } },
          { kind: "me.name", name: "Ada" },
          { kind: "log.add", id: idB, at: contractNow + 1, text: "Second" },
          { kind: "log.add", id: idA, at: contractNow + 2, text: "Duplicate" },
        ]),
      ).rejects.toThrow();
      expect(await source.frame()).toEqual(before);
      // The source still works after a rolled-back batch.
      const frame = await writeAll(source, { kind: "me.name", name: "Ada" });
      expect(frame.myName).toBe("Ada");
    });

    it("keeps everything across a close and reopen", async () => {
      const first = start();
      await first.write([
        { kind: "notification.read", id: "n1", read: true },
        { kind: "notify.set", notify: { search: false } },
        { kind: "me.name", name: "Ada" },
        { kind: "log.add", id: idA, at: contractNow, text: "Marked all read" },
      ]);
      const before = await first.frame();
      first.close();
      first.close();
      const second = start();
      expect(await second.frame()).toEqual(before);
    });

    it("reads and writes local settings as JSON", () => {
      const source = start();
      expect(source.readSetting("import")).toBeUndefined();
      source.writeSetting("import", { at: "2026-10-24T09:00:00.000Z", n: [1, 2] });
      expect(source.readSetting("import")).toEqual({ at: "2026-10-24T09:00:00.000Z", n: [1, 2] });
      source.writeSetting("import", null);
      expect(source.readSetting("import")).toBeNull();
      expect(() => {
        source.writeSetting("import", undefined);
      }).toThrow();
    });

    it("keeps local settings across a close and reopen", () => {
      const first = start();
      first.writeSetting("mail.settings", { label: "Outreach" });
      first.close();
      expect(start().readSetting("mail.settings")).toEqual({ label: "Outreach" });
    });

    it("seeds channel names only where there is none, and counts the rows changed", () => {
      const source = start();
      expect(source.seedChannelNames([])).toBe(0);
      expect(
        source.seedChannelNames([
          { channelId: "UC_seed_one", name: "Prompt Lab" },
          { channelId: "UC_seed_two", name: "Agent Weekly" },
        ]),
      ).toBe(2);
      // A name already there stays; a new channel is added.
      expect(
        source.seedChannelNames([
          { channelId: "UC_seed_one", name: "Other Name" },
          { channelId: "UC_seed_three", name: "Model News" },
        ]),
      ).toBe(1);
      const names: Record<string, string> = {};
      withDb(file, (db) => {
        for (const row of db.prepare("SELECT channel_id, name FROM channels").all()) {
          names[String(row["channel_id"])] = String(row["name"]);
        }
      });
      expect(names["UC_seed_one"]).toBe("Prompt Lab");
      expect(names["UC_seed_three"]).toBe("Model News");
    });

    it("keeps a big pulled table inside the frame limits, deal creators first", async () => {
      const source = start();
      withDb(file, (db) => {
        db.exec("BEGIN");
        for (let i = 0; i < 20_000; i += 1) {
          upsertCreator(
            db,
            {
              id: `bulk-${String(i)}`,
              name: `Bulk ${String(i)}`,
              handle: `@bulk${String(i)}`,
              stage: "new",
              email: null,
            },
            contractNow,
          );
        }
        for (let i = 0; i < 50; i += 1) {
          upsertDeal(
            db,
            {
              id: `bulk-deal-${String(i)}`,
              brand: "b1",
              creator: `bulk-${String(i)}`,
              step: 1,
              price: 1000,
            },
            contractNow,
          );
        }
        db.exec("COMMIT");
      });
      const frame = await source.frame();
      expect(frame.creators.length).toBeLessThanOrEqual(5000);
      const ids = new Set(frame.creators.map((c) => c.id));
      for (let i = 0; i < 50; i += 1) {
        expect(ids.has(`bulk-${String(i)}`)).toBe(true);
      }
      expect(frameSchema.safeParse(frame).success).toBe(true);
      expect(JSON.stringify(frame).length).toBeLessThan(2_000_000);
    });

    it("drops money lines and money notifications for a member without money", async () => {
      const source = start();
      withDb(file, (db) => {
        insertLogRow(
          db,
          logRow("m1", "2026-10-20T10:00:00Z", { detail: { text: "Paid Lina $4,000" } }),
        );
        insertLogRow(
          db,
          logRow("m2", "2026-10-20T10:01:00Z", {
            action: "updated",
            entity_type: "deals",
            entity_label: "Lina deal",
            field: "brand_price",
            old_value: "1",
            new_value: "2",
          }),
        );
        insertLogRow(
          db,
          logRow("m3", "2026-10-20T10:02:00Z", { detail: { text: "Added a brand" } }),
        );
        const base = exampleFrame(contractNow).notifications[0];
        if (base === undefined) throw new Error("no example notification");
        upsertNotification(
          db,
          { ...base, id: "nm1", text: "Flagged", sub: "x", icon: "check" },
          { money: true },
        );
        upsertNotification(db, { ...base, id: "nm2", text: "Got $4,000", sub: "x", icon: "check" });
      });
      const rich = await source.frame();
      expect(rich.log.map((l) => l.id)).toEqual(["m3", "m2", "m1"]);
      expect(rich.notifications.some((n) => n.id === "nm1")).toBe(true);
      setAccess(file, [{ profileId: "u1", roles: ["scout"], seesMoney: false }]);
      const frame = await source.frame();
      expect(frame.log.map((l) => l.id)).toEqual(["m3"]);
      expect(JSON.stringify(frame.log)).not.toContain("$4,000");
      expect(frame.notifications.some((n) => n.id === "nm1" || n.id === "nm2")).toBe(false);
    });

    it("hides an undone line and its marker, and shows a redone one", async () => {
      const source = start();
      withDb(file, (db) => {
        insertLogRow(db, logRow("l1", "2026-10-20T10:00:00Z", { detail: { text: "First" } }));
        insertLogRow(db, logRow("l2", "2026-10-20T10:01:00Z", { detail: { text: "Second" } }));
        const marker = (id: string, action: string, at: string): ActivityRow =>
          logRow(id, at, {
            action,
            entity_type: "activity_log",
            entity_id: "l2",
            entity_label: "Second",
          });
        insertLogRow(db, marker("k1", "undo", "2026-10-20T10:02:00Z"));
      });
      expect((await source.frame()).log.map((l) => l.id)).toEqual(["l1"]);
      withDb(file, (db) => {
        insertLogRow(
          db,
          logRow("k2", "2026-10-20T10:03:00Z", {
            action: "redo",
            entity_type: "activity_log",
            entity_id: "l2",
            entity_label: "Second",
          }),
        );
      });
      expect((await source.frame()).log.map((l) => l.id)).toEqual(["l2", "l1"]);
    });

    it("sorts lines written with Z and with +00:00 by time", async () => {
      const source = start();
      withDb(file, (db) => {
        insertLogRow(db, logRow("z1", "2026-10-20T10:00:00Z", { detail: { text: "A" } }));
        insertLogRow(db, logRow("z2", "2026-10-20T10:00:30+00:00", { detail: { text: "B" } }));
        insertLogRow(db, logRow("z3", "2026-10-20T10:01:00Z", { detail: { text: "C" } }));
        insertLogRow(db, logRow("z4", "2026-10-20T10:01:30+00:00", { detail: { text: "D" } }));
      });
      expect((await source.frame()).log.map((l) => l.id)).toEqual(["z4", "z3", "z2", "z1"]);
    });
  });
}
