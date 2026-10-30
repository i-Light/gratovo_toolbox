import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bareBrand,
  bareDeal,
  creatorStages,
  exampleChannelId as ch,
  exampleFrame,
  mentionsMoney,
  nameMax,
  notifyKind,
} from "@gratovo/core/data";
import { emptyFindFilter } from "@gratovo/core/find";
import { frameSchema } from "@gratovo/ipc";
import type {
  CreatorStage,
  DataSource,
  DataWrite,
  DraftState,
  Frame,
  FrameSource,
  LogAction,
  RejectReason,
} from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/open-database";
import { createCatalog } from "../find/catalog";
import { writePipelineDb } from "../find/catalog-fixture";

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
      expect(frame.deals).toEqual(
        before.deals.map((deal) => ({
          ...deal,
          price: null,
          payout: null,
          cpm: null,
          negotiation: null,
        })),
      );
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
        {
          kind: "log.add",
          id: idA,
          at: contractNow - 2000,
          text: "Marked all read",
          ref: null,
          action: null,
          detail: null,
        },
        {
          kind: "log.add",
          id: idB,
          at: contractNow - 1000,
          text: "Changed a switch",
          ref: null,
          action: null,
          detail: null,
        },
      );
      expect(frame.log).toEqual([
        {
          id: idB,
          at: contractNow - 1000,
          who: "u1",
          text: "Changed a switch",
          ref: null,
          action: null,
          detail: null,
        },
        {
          id: idA,
          at: contractNow - 2000,
          who: "u1",
          text: "Marked all read",
          ref: null,
          action: null,
          detail: null,
        },
      ]);
      frame = await writeAll(source, { kind: "log.remove", id: idB });
      expect(frame.log.map((line) => line.id)).toEqual([idA]);
    });

    it("keeps only the newest 50 log lines", async () => {
      const source = start();
      const writes: DataWrite[] = [];
      for (let i = 0; i < 55; i += 1) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        writes.push({
          kind: "log.add",
          id,
          at: contractNow + i,
          text: `Line ${String(i)}`,
          ref: null,
          action: null,
          detail: null,
        });
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
        { kind: "creator.stage", id: ch("c1"), stage: "emailed", handle: "", name: "" },
        {
          kind: "brand.set",
          id: "b1",
          name: "Codewell Pro",
          sells: "AI code review",
          status: "won",
        },
        { kind: "brand.set", id: "b99", name: "Tensorly", sells: "AI notebooks", status: "found" },
        { kind: "deal.step", id: "d1", step: 4 },
        { kind: "deal.step", id: "nope", step: 4 },
      );
      expect(frame.creators.find((c) => c.id === ch("c1"))?.stage).toBe("emailed");
      expect(frame.creators).toHaveLength(exampleFrame(contractNow).creators.length);
      expect(frame.brands.find((b) => b.id === "b1")?.name).toBe("Codewell Pro");
      expect(frame.brands.find((b) => b.id === "b99")).toEqual(
        bareBrand({ id: "b99", name: "Tensorly", sells: "AI notebooks", status: "found" }),
      );
      expect(frame.deals.find((d) => d.id === "d1")?.step).toBe(4);
      expect(frame.deals).toHaveLength(exampleFrame(contractNow).deals.length);
      expect(frame.conflicts).toEqual([]);
    });

    it("applies nothing when a batch fails part way", async () => {
      const source = start();
      await writeAll(source, {
        kind: "log.add",
        id: idA,
        at: contractNow,
        text: "First",
        ref: null,
        action: null,
        detail: null,
      });
      const before = await source.frame();
      await expect(
        source.write([
          { kind: "notification.read", id: "n1", read: true },
          { kind: "notify.set", notify: { money: false } },
          { kind: "me.name", name: "Ada" },
          {
            kind: "log.add",
            id: idB,
            at: contractNow + 1,
            text: "Second",
            ref: null,
            action: null,
            detail: null,
          },
          {
            kind: "log.add",
            id: idA,
            at: contractNow + 2,
            text: "Duplicate",
            ref: null,
            action: null,
            detail: null,
          },
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
        {
          kind: "log.add",
          id: idA,
          at: contractNow,
          text: "Marked all read",
          ref: null,
          action: null,
          detail: null,
        },
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
            bareDeal({
              id: `bulk-deal-${String(i)}`,
              brand: "b1",
              creator: `bulk-${String(i)}`,
              step: 1,
              price: 1000,
            }),
            contractNow,
          );
        }
        db.exec("COMMIT");
      });
      const frame = await source.frame();
      expect(frame.creators.length).toBeLessThanOrEqual(5000);
      // The catalog's read is not capped: every row, the example ones too.
      const states = await source.creatorStates();
      expect(states.length).toBe(20_000 + exampleFrame(contractNow).creators.length);
      expect(states.find((c) => c.id === "bulk-19999")?.name).toBe("Bulk 19999");
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

    describe("creator writes (plan step 5, D4 and D5)", () => {
      const day = 24 * 60 * 60 * 1000;

      function stored(id: string): { tags: unknown; due: unknown; vetting: unknown } {
        let out: { tags: unknown; due: unknown; vetting: unknown } = {
          tags: undefined,
          due: undefined,
          vetting: undefined,
        };
        withDb(file, (db) => {
          const row = db
            .prepare(
              "SELECT channel_tags, archive_due_at, vetting_status FROM channel_state WHERE channel_id = ?",
            )
            .get(id);
          out = {
            tags:
              row === undefined ? undefined : (JSON.parse(String(row["channel_tags"])) as unknown),
            due: row?.["archive_due_at"],
            vetting: row?.["vetting_status"],
          };
        });
        return out;
      }

      function stage(id: string, to: CreatorStage, reason?: RejectReason): DataWrite {
        return {
          kind: "creator.stage",
          id,
          stage: to,
          handle: "",
          name: "",
          ...(reason === undefined ? {} : { reason }),
        };
      }

      function line(
        id: string,
        at: number,
        ref: string,
        action: LogAction,
        detail: string | null,
      ): DataWrite {
        return { kind: "log.add", id, at, text: `Line ${id}`, ref, action, detail };
      }

      const agentLab = "UCagentLabAiTools000001x";
      const fresh = "UCfreshAiNewsChannel0001";

      it("creates the row and the name for a channel it has none for", async () => {
        const source = start();
        const frame = await writeAll(source, {
          kind: "creator.stage",
          id: agentLab,
          stage: "shortlisted",
          handle: "@agentlab",
          name: "Agent Lab",
        });
        expect(frame.creators.find((c) => c.id === agentLab)).toEqual({
          id: agentLab,
          name: "Agent Lab",
          handle: "@agentlab",
          stage: "shortlisted",
          email: null,
          emailConfirmed: false,
          contactName: null,
          contactSource: null,
          contactConfidence: null,
          rejectReason: null,
          rejectedAt: null,
          neverReason: null,
          archiveDueAt: null,
          kit: null,
        });
        expect(frame.creators).toHaveLength(exampleFrame(contractNow).creators.length + 1);
        // The legacy fields keep the old app's defaults, as the server writes a new row (D4).
        expect(stored(agentLab)).toEqual({ tags: [], due: null, vetting: "newlyFound" });
        // A second write finds the row: nothing is added twice.
        const again = await writeAll(source, stage(agentLab, "contact"));
        expect(again.creators.filter((c) => c.id === agentLab)).toHaveLength(1);
        expect(again.creators.find((c) => c.id === agentLab)?.name).toBe("Agent Lab");
      });

      it("creates no row for an id that is not a channel id", async () => {
        const source = start();
        const before = await source.frame();
        for (const id of ["UC_agent_lab", "c999", `UC${"a".repeat(21)}`, `UC${"a".repeat(23)}`]) {
          await source.write([
            { kind: "creator.stage", id, stage: "rejected", handle: "@x", name: "X", reason: "ai" },
          ]);
          expect(stored(id)).toEqual({ tags: undefined, due: undefined, vetting: undefined });
        }
        expect(await source.frame()).toEqual(before);
      });

      it("never then allow on a channel with no row is not emailed before", async () => {
        const source = start();
        await source.write([stage(fresh, "never")]);
        await source.write([stage(fresh, "new")]);
        expect((await source.creatorStates()).find((c) => c.id === fresh)).toMatchObject({
          stage: "new",
          legacyPipelineStage: "new",
          hasAppStage: true,
        });
        const pipelineDb = join(folder, "pipeline.db");
        writePipelineDb(pipelineDb, { channels: [{ id: fresh, name: "Fresh AI News" }] });
        const catalog = createCatalog({ pipelineDbPath: () => pipelineDb, source: () => source });
        try {
          const page = await catalog.query({
            filter: { ...emptyFindFilter, stages: [...creatorStages] },
            sort: "found",
            offset: 0,
            limit: 10,
          });
          expect(page.items.find((item) => item.id === fresh)?.emailedBefore).toBeNull();
        } finally {
          catalog.close();
        }
      });

      it("rejects with the tag the reason calls for, and the due date 7 days on", async () => {
        const source = start();
        const frame = await writeAll(
          source,
          stage(ch("c11"), "rejected", "posting"),
          stage(ch("c12"), "rejected", "views"),
          // Rejecting again adds nothing twice and keeps the date.
          stage(ch("c11"), "rejected", "posting"),
        );
        expect(stored(ch("c11")).tags).toEqual(["inactive"]);
        expect(stored(ch("c12")).tags).toEqual(["irrelevant"]);
        expect(stored(ch("c11")).due).toBe(new Date(contractNow + 7 * day).toISOString());
        const c11 = frame.creators.find((c) => c.id === ch("c11"));
        expect(c11?.stage).toBe("rejected");
        expect(c11?.archiveDueAt).toBe(contractNow + 7 * day);
        // A channel only the pipeline knew is tagged the same way.
        await source.write([
          {
            kind: "creator.stage",
            id: fresh,
            stage: "rejected",
            handle: "@x",
            name: "X",
            reason: "ai",
          },
        ]);
        expect(stored(fresh)).toMatchObject({ tags: ["irrelevant"], vetting: "newlyFound" });
        expect((await source.frame()).creators.find((c) => c.id === fresh)?.stage).toBe("rejected");
      });

      it("bringing a channel back takes the rejecting tags off and clears the date", async () => {
        const source = start();
        withDb(file, (db) => {
          db.prepare("UPDATE channel_state SET channel_tags = ? WHERE channel_id = ?").run(
            JSON.stringify(["qualified", "haramStuff"]),
            ch("c11"),
          );
        });
        await source.write([stage(ch("c11"), "rejected", "audience")]);
        expect(stored(ch("c11")).tags).toEqual(["qualified", "haramStuff", "irrelevant"]);
        const frame = await writeAll(source, stage(ch("c11"), "new"));
        expect(stored(ch("c11"))).toMatchObject({ tags: ["qualified"], due: null });
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          stage: "new",
          archiveDueAt: null,
          kit: null,
        });
      });

      it("never contact tags nothing and sets no date", async () => {
        const source = start();
        const frame = await writeAll(source, stage(ch("c12"), "never"));
        expect(stored(ch("c12"))).toMatchObject({ tags: [], due: null });
        expect(frame.creators.find((c) => c.id === ch("c12"))?.stage).toBe("never");
      });

      it("reads the reject reason and time from the newest visible reject or never line", async () => {
        const source = start();
        let frame = await writeAll(
          source,
          line(idA, contractNow - 2000, ch("c11"), "creator.reject", "views"),
          stage(ch("c11"), "rejected", "views"),
        );
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          rejectReason: "views",
          rejectedAt: contractNow - 2000,
          archiveDueAt: contractNow + 7 * day,
          kit: null,
        });
        // Other creators are untouched.
        expect(frame.creators.find((c) => c.id === ch("c12"))).toMatchObject({
          rejectReason: null,
          rejectedAt: null,
        });
        // A newer never line wins: its time, and no reject reason.
        frame = await writeAll(
          source,
          line(idB, contractNow - 1000, ch("c11"), "creator.never", null),
        );
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          rejectReason: null,
          rejectedAt: contractNow - 1000,
          neverReason: null,
        });
        // A brought-back creator carries no old reason or time.
        frame = await writeAll(source, stage(ch("c11"), "new"));
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          rejectReason: null,
          rejectedAt: null,
          neverReason: null,
        });
        expect((await source.creatorStates()).find((c) => c.id === ch("c11"))).toMatchObject({
          rejectReason: null,
          rejectedAt: null,
          neverReason: null,
        });
        await source.write([stage(ch("c11"), "rejected", "views")]);
        // An undo hides the never line, so the reject line is the newest visible one again.
        withDb(file, (db) => {
          insertLogRow(
            db,
            logRow("k1", new Date(contractNow).toISOString(), {
              action: "undo",
              entity_type: "activity_log",
              entity_id: idB,
            }),
          );
        });
        frame = await source.frame();
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          rejectReason: "views",
          rejectedAt: contractNow - 2000,
        });
      });

      it("round-trips a log line's ref, action and detail, across a reopen", async () => {
        const first = start();
        await first.write([line(idA, contractNow, ch("c11"), "creator.reject", "audience")]);
        const expected = {
          id: idA,
          at: contractNow,
          who: "u1",
          text: `Line ${idA}`,
          ref: ch("c11"),
          action: "creator.reject",
          detail: "audience",
        };
        expect((await first.frame()).log).toEqual([expected]);
        first.close();
        expect((await start().frame()).log).toEqual([expected]);
      });

      function notesWrite(id: string, notes: string, handle = "", name = ""): DataWrite {
        return { kind: "creator.notes", id, base: "", notes, handle, name };
      }

      function storedRow(id: string): Record<string, unknown> | undefined {
        let out: Record<string, unknown> | undefined;
        withDb(file, (db) => {
          out = db
            .prepare(
              `SELECT s.notes, s.creator_stage, s.vetting_status, s.pipeline_stage, s.handle, c.name
               FROM channel_state s LEFT JOIN channels c ON c.channel_id = s.channel_id
               WHERE s.channel_id = ?`,
            )
            .get(id);
        });
        return out;
      }

      it("stores a creator's notes, and empty text clears them as the server does", async () => {
        const source = start();
        const before = await source.frame();
        await source.write([notesWrite(ch("c11"), "Wants a demo of the agent before a quote.")]);
        expect(await source.creatorNotes(ch("c11"))).toBe(
          "Wants a demo of the agent before a quote.",
        );
        // Notes aren't in the frame or the catalog's states, and the stage is untouched.
        expect(await source.frame()).toEqual(before);
        expect((await source.creatorStates()).find((c) => c.id === ch("c11"))).not.toHaveProperty(
          "notes",
        );
        await source.write([notesWrite(ch("c11"), "")]);
        expect(storedRow(ch("c11"))?.["notes"]).toBeNull();
        expect(await source.creatorNotes(ch("c11"))).toBeNull();
        // A creator with no notes, an unknown id and a stored empty text all read as none.
        expect(await source.creatorNotes(ch("c12"))).toBeNull();
        expect(await source.creatorNotes("c999")).toBeNull();
        withDb(file, (db) => {
          db.prepare("UPDATE channel_state SET notes = '' WHERE channel_id = ?").run(ch("c12"));
        });
        expect(await source.creatorNotes(ch("c12"))).toBeNull();
      });

      it("notes on a channel with no row create it as a stage write does, with no stage", async () => {
        const source = start();
        await source.write([
          notesWrite(agentLab, "Covers coding agents weekly.", "@agentlab", "Agent Lab"),
        ]);
        expect(storedRow(agentLab)).toEqual({
          notes: "Covers coding agents weekly.",
          creator_stage: null,
          vetting_status: "newlyFound",
          pipeline_stage: "new",
          handle: "@agentlab",
          name: "Agent Lab",
        });
        expect((await source.creatorStates()).find((c) => c.id === agentLab)).toMatchObject({
          stage: "new",
          hasAppStage: false,
        });
        expect(await source.creatorNotes(agentLab)).toBe("Covers coding agents weekly.");
        // No handle: the row is named by its id, as the server names it.
        await source.write([notesWrite(fresh, "AI news daily.")]);
        expect(storedRow(fresh)).toMatchObject({ handle: fresh, name: null });
        // A later stage write finds the row and keeps the notes.
        await source.write([stage(agentLab, "shortlisted")]);
        expect(storedRow(agentLab)).toMatchObject({
          notes: "Covers coding agents weekly.",
          creator_stage: "shortlisted",
        });
      });

      it("notes on an id that is not a channel id create nothing", async () => {
        const source = start();
        const before = await source.creatorStates();
        for (const id of ["UC_agent_lab", "c999", `UC${"a".repeat(23)}`]) {
          await source.write([notesWrite(id, "Hello", "@x", "X")]);
          expect(storedRow(id)).toBeUndefined();
        }
        expect(await source.creatorStates()).toEqual(before);
      });

      function contact(
        id: string,
        email: string | null,
        over: Partial<Extract<DataWrite, { kind: "creator.contact" }>> = {},
      ): DataWrite {
        return {
          kind: "creator.contact",
          id,
          email,
          confirmed: true,
          contactName: "Maya",
          source: "about",
          confidence: 0.95,
          handle: "",
          name: "",
          ...over,
        };
      }

      function storedContacts(id: string): unknown {
        let out: unknown;
        withDb(file, (db) => {
          const row = db.prepare("SELECT contacts FROM channel_state WHERE channel_id = ?").get(id);
          out = row === undefined ? undefined : (JSON.parse(String(row["contacts"])) as unknown);
        });
        return out;
      }

      function readStoredText(id: string): string | undefined {
        let out: string | undefined;
        withDb(file, (db) => {
          const row = db.prepare("SELECT contacts FROM channel_state WHERE channel_id = ?").get(id);
          out = row === undefined ? undefined : String(row["contacts"]);
        });
        return out;
      }

      function setContacts(id: string, contacts: unknown): void {
        withDb(file, (db) => {
          db.prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = ?").run(
            JSON.stringify(contacts),
            id,
          );
        });
      }

      const primary = {
        method: "email",
        value: "biz@modelmatters.ai",
        label: "Maya",
        primary: true,
        confirmed: true,
        source: "about",
        confidence: 0.95,
      };

      it("confirms an address as the primary contact, keeping the other contacts", async () => {
        const source = start();
        const phone = { method: "phone", value: "+1 555 0100", primary: false };
        const other = { method: "email", value: "press@modelmatters.ai", primary: false };
        setContacts(ch("c11"), [
          phone,
          { method: "email", value: "modelmatters.yt@gmail.com", primary: true },
          other,
        ]);
        const frame = await writeAll(source, contact(ch("c11"), "biz@modelmatters.ai"));
        // The old primary stays where it was, no longer primary; the new address goes last.
        const kept = [
          phone,
          { method: "email", value: "modelmatters.yt@gmail.com", primary: false },
          other,
          primary,
        ];
        expect(storedContacts(ch("c11"))).toEqual(kept);
        expect(frame.creators.find((c) => c.id === ch("c11"))).toMatchObject({
          stage: "new",
          email: "biz@modelmatters.ai",
          emailConfirmed: true,
          contactName: "Maya",
          contactSource: "about",
          contactConfidence: 0.95,
        });
        expect((await source.creatorStates()).find((c) => c.id === ch("c11"))).toMatchObject({
          email: "biz@modelmatters.ai",
          emailConfirmed: true,
          contactName: "Maya",
        });
        // The same contact again gives the same list.
        await source.write([contact(ch("c11"), "biz@modelmatters.ai")]);
        expect(storedContacts(ch("c11"))).toEqual(kept);
      });

      it("confirming another address keeps the old one and its label, and undo swaps them back", async () => {
        const source = start();
        const a = {
          method: "email",
          value: "team@modelmatters.ai",
          primary: true,
          label: "manager",
        };
        const b = { method: "email", value: "press@modelmatters.ai", label: "press" };
        setContacts(ch("c11"), [a, b]);
        await source.write([contact(ch("c11"), "press@modelmatters.ai", { contactName: null })]);
        const confirmed = [
          { ...a, primary: false },
          {
            method: "email",
            value: "press@modelmatters.ai",
            label: "press",
            primary: true,
            confirmed: true,
            source: "about",
            confidence: 0.95,
          },
        ];
        expect(storedContacts(ch("c11"))).toEqual(confirmed);
        // The label of a confirmed address is its contact name.
        expect((await source.frame()).creators.find((c) => c.id === ch("c11"))).toMatchObject({
          email: "press@modelmatters.ai",
          emailConfirmed: true,
          contactName: "press",
        });
        // The same write again changes nothing, down to the text.
        const text = readStoredText(ch("c11"));
        await source.write([contact(ch("c11"), "press@modelmatters.ai", { contactName: null })]);
        expect(readStoredText(ch("c11"))).toBe(text);
        // Undo writes the old address back unconfirmed.
        await source.write([
          contact(ch("c11"), "team@modelmatters.ai", {
            confirmed: false,
            contactName: null,
            source: null,
            confidence: null,
          }),
        ]);
        expect(storedContacts(ch("c11"))).toEqual([
          {
            method: "email",
            value: "team@modelmatters.ai",
            label: "manager",
            primary: true,
            confirmed: false,
            source: null,
            confidence: null,
          },
          { ...confirmed[1], primary: false },
        ]);
        expect((await source.frame()).creators.find((c) => c.id === ch("c11"))).toMatchObject({
          email: "team@modelmatters.ai",
          emailConfirmed: false,
          contactName: null,
        });
      });

      it("a bare-string old primary stays, as an email entry that is not primary", async () => {
        const source = start();
        const phone = { method: "phone", value: "+1 555 0100" };
        setContacts(ch("c11"), ["team@modelmatters.ai", phone]);
        await source.write([contact(ch("c11"), "biz@modelmatters.ai")]);
        expect(storedContacts(ch("c11"))).toEqual([
          { method: "email", value: "team@modelmatters.ai", primary: false },
          phone,
          primary,
        ]);
        expect((await source.frame()).creators.find((c) => c.id === ch("c11"))?.email).toBe(
          "biz@modelmatters.ai",
        );
      });

      it("undo puts the old address back unconfirmed, and a null address removes the primary", async () => {
        const source = start();
        await source.write([contact(ch("c12"), "hi@promptdaily.ai", { contactName: null })]);
        await source.write([
          contact(ch("c12"), null, {
            confirmed: false,
            contactName: null,
            source: null,
            confidence: null,
          }),
        ]);
        expect(storedContacts(ch("c12"))).toEqual([]);
        expect((await source.frame()).creators.find((c) => c.id === ch("c12"))).toMatchObject({
          email: null,
          emailConfirmed: false,
          contactName: null,
          contactSource: null,
          contactConfidence: null,
        });
        await source.write([
          contact(ch("c11"), "modelmatters.yt@gmail.com", {
            confirmed: false,
            contactName: null,
            source: null,
            confidence: null,
          }),
        ]);
        const c11 = (await source.frame()).creators.find((c) => c.id === ch("c11"));
        expect(c11).toMatchObject({
          email: "modelmatters.yt@gmail.com",
          emailConfirmed: false,
          contactName: null,
        });
      });

      it("a typed address keeps its source and no confidence; a repeat of it is not listed twice", async () => {
        const source = start();
        setContacts(ch("c11"), [
          { method: "email", value: "modelmatters.yt@gmail.com", primary: true },
          "hello@modelmatters.ai",
        ]);
        await source.write([
          contact(ch("c11"), "hello@modelmatters.ai", { source: "typed", confidence: null }),
        ]);
        expect(storedContacts(ch("c11"))).toEqual([
          { method: "email", value: "modelmatters.yt@gmail.com", primary: false },
          {
            ...primary,
            value: "hello@modelmatters.ai",
            source: "typed",
            confidence: null,
          },
        ]);
        expect((await source.frame()).creators.find((c) => c.id === ch("c11"))).toMatchObject({
          contactSource: "typed",
          contactConfidence: null,
        });
      });

      it("reads a name only from a confirmed contact, and odd stored fields as none", async () => {
        const source = start();
        setContacts(ch("c11"), [{ ...primary, confirmed: false }]);
        expect((await source.frame()).creators.find((c) => c.id === ch("c11"))).toMatchObject({
          emailConfirmed: false,
          contactName: null,
          contactSource: "about",
          contactConfidence: 0.95,
        });
        setContacts(ch("c11"), [
          { ...primary, label: `  ${"N".repeat(120)} `, source: "guess", confidence: 7 },
        ]);
        const read = (await source.frame()).creators.find((c) => c.id === ch("c11"));
        expect(read?.contactName).toBe("N".repeat(80));
        expect(read).toMatchObject({ contactSource: null, contactConfidence: null });
        expect(frameSchema.safeParse(await source.frame()).success).toBe(true);
        setContacts(ch("c11"), [{ ...primary, label: "   " }]);
        expect(
          (await source.frame()).creators.find((c) => c.id === ch("c11"))?.contactName,
        ).toBeNull();
      });

      it("a contact on a channel with no row creates it as a stage write does, with no stage", async () => {
        const source = start();
        await source.write([
          contact(agentLab, "team@agentlab.ai", { handle: "@agentlab", name: "Agent Lab" }),
        ]);
        expect(storedRow(agentLab)).toMatchObject({
          creator_stage: null,
          vetting_status: "newlyFound",
          handle: "@agentlab",
          name: "Agent Lab",
        });
        expect(storedContacts(agentLab)).toEqual([{ ...primary, value: "team@agentlab.ai" }]);
        for (const id of ["UC_agent_lab", "c999"]) {
          await source.write([contact(id, "team@agentlab.ai")]);
          expect(storedContacts(id)).toBeUndefined();
        }
      });

      it("reads one creator's lines, newest first, hidden and mapped as the frame does", async () => {
        const source = start();
        const idC = "00000000-0000-4000-8000-00000000000c";
        const idD = "00000000-0000-4000-8000-00000000000d";
        await source.write([
          line(idA, contractNow - 3000, ch("c11"), "creator.shortlist", null),
          line(idB, contractNow - 1000, ch("c11"), "creator.reject", "views"),
          line(idC, contractNow - 2000, ch("c12"), "creator.never", null),
          {
            kind: "log.add",
            id: idD,
            at: contractNow,
            text: "A note",
            ref: null,
            action: null,
            detail: null,
          },
        ]);
        withDb(file, (db) => {
          // The old app's line on the creator counts; another kind of entity with the same id doesn't.
          insertLogRow(
            db,
            logRow("old1", "2026-10-20T11:59:59.500Z", {
              actor_id: null,
              actor_name: "Sara",
              action: "emailSent",
              entity_type: "channel",
              entity_id: ch("c11"),
              entity_label: "Model Matters",
            }),
          );
          insertLogRow(
            db,
            logRow("deal1", "2026-10-20T11:59:59.900Z", {
              entity_type: "deal",
              entity_id: ch("c11"),
              detail: { text: "Not a creator line" },
            }),
          );
        });
        const lines = await source.logFor(ch("c11"), 10);
        expect(lines.map((l) => l.id)).toEqual(["old1", idB, idA]);
        expect(lines[1]).toEqual({
          id: idB,
          at: contractNow - 1000,
          who: "u1",
          text: `Line ${idB}`,
          ref: ch("c11"),
          action: "creator.reject",
          detail: "views",
        });
        expect(lines[0]).toMatchObject({ who: "Sara", ref: ch("c11"), action: null });
        // The same lines the frame shows for this creator, in the same order.
        expect(lines).toEqual((await source.frame()).log.filter((l) => l.ref === ch("c11")));
        expect((await source.logFor(ch("c11"), 2)).map((l) => l.id)).toEqual(["old1", idB]);
        expect(await source.logFor("c999", 10)).toEqual([]);
        // An undo hides a line here too.
        withDb(file, (db) => {
          insertLogRow(
            db,
            logRow("k1", new Date(contractNow).toISOString(), {
              action: "undo",
              entity_type: "activity_log",
              entity_id: idB,
            }),
          );
        });
        expect((await source.logFor(ch("c11"), 10)).map((l) => l.id)).toEqual(["old1", idA]);
      });

      it("hides a creator's money lines from a member without money", async () => {
        const source = start();
        withDb(file, (db) => {
          insertLogRow(
            db,
            logRow("m1", "2026-10-20T11:00:00Z", {
              entity_type: "channel",
              entity_id: ch("c11"),
              detail: { text: "Shortlisted Model Matters" },
            }),
          );
          insertLogRow(
            db,
            logRow("m2", "2026-10-20T11:01:00Z", {
              action: "updated",
              entity_type: "channel",
              entity_id: ch("c11"),
              field: "brand_price",
              old_value: "1",
              new_value: "2",
            }),
          );
          insertLogRow(
            db,
            logRow("m3", "2026-10-20T11:02:00Z", {
              entity_type: "channel",
              entity_id: ch("c11"),
              detail: { text: "Agreed $4,000 with Model Matters" },
            }),
          );
        });
        setAccess(file, [{ profileId: "u1", roles: ["owner"], seesMoney: true }]);
        expect((await source.logFor(ch("c11"), 10)).map((l) => l.id)).toEqual(["m3", "m2", "m1"]);
        setAccess(file, [{ profileId: "u1", roles: ["scout"], seesMoney: false }]);
        expect((await source.logFor(ch("c11"), 10)).map((l) => l.id)).toEqual(["m1"]);
      });

      it("pages the whole log, with its people and the lines since a time", async () => {
        const source = start();
        withDb(file, (db) => {
          for (const [id, at] of [
            ["p1", "2026-10-20T10:00:00Z"],
            ["p2", "2026-10-20T10:01:00Z"],
            ["p3", "2026-10-20T10:02:00Z"],
          ] as const) {
            insertLogRow(
              db,
              logRow(id, at, { actor_id: null, actor_name: "Sara", detail: { text: id } }),
            );
          }
        });
        const first = await source.logPage({ before: null, limit: 2, who: "Sara" });
        expect(first.lines.map((l) => l.id)).toEqual(["p3", "p2"]);
        expect(first.more).toBe(true);
        expect(first.people).toContainEqual({ who: "Sara", name: "Sara", count: 3 });
        expect(first.total).toBeGreaterThanOrEqual(3);
        const last = first.lines[1];
        const rest = await source.logPage({
          before: last === undefined ? null : { at: last.at, id: last.id },
          limit: 2,
          who: "Sara",
        });
        expect(rest.lines.map((l) => l.id)).toEqual(["p1"]);
        expect(rest.more).toBe(false);
        expect(await source.logSince(Date.parse("2026-10-20T10:01:00Z"))).toBeGreaterThanOrEqual(2);
      });

      it("gives the catalog every creator's state with its fields", async () => {
        const source = start();
        withDb(file, (db) => {
          db.prepare(
            "UPDATE channel_state SET manual_engagement_rate = 0.042 WHERE channel_id = ?",
          ).run(ch("c11"));
          insertLogRow(
            db,
            logRow("old1", "2026-10-19T09:00:00Z", {
              actor_name: "Sara",
              action: "emailSent",
              entity_type: "channel",
              entity_id: ch("c11"),
              entity_label: "Model Matters",
            }),
          );
        });
        await source.write([
          { kind: "me.name", name: "Ada" },
          stage(ch("c11"), "rejected", "ai"),
          line(idA, contractNow - 500, ch("c11"), "creator.reject", "ai"),
        ]);
        const states = await source.creatorStates();
        const examples = exampleFrame(contractNow).creators;
        expect(states.map((c) => c.id)).toEqual(examples.map((c) => c.id));
        const c11 = examples.find((c) => c.id === ch("c11"));
        expect(states.find((c) => c.id === ch("c11"))).toEqual({
          id: ch("c11"),
          handle: c11?.handle,
          name: c11?.name,
          stage: "rejected",
          email: c11?.email,
          emailConfirmed: false,
          contactName: null,
          contactSource: null,
          contactConfidence: null,
          rejectReason: "ai",
          rejectedAt: contractNow - 500,
          neverReason: null,
          archiveDueAt: contractNow + 7 * day,
          // The seed's details come with the state (a live file holds them from the sync, plan P1).
          details: c11?.details,
          engagement: 0.042,
          kit: {
            ageBand: null,
            countries: [],
            engagement: 0.042,
            fromReply: false,
            link: null,
            rate: null,
            rateKnown: false,
          },
          legacyPipelineStage: "new",
          hasAppStage: true,
          lastActivity: { at: contractNow - 500, who: "Ada" },
        });
        // A creator with no line of its own has no activity; the old app's lines count.
        const c12 = states.find((c) => c.id === ch("c12"));
        expect(c12).toMatchObject({ engagement: null, lastActivity: null, archiveDueAt: null });
        // Never reports its time and the reason the person wrote (D39); a reject line on a
        // creator now at another stage reports nothing.
        const frame = await writeAll(
          source,
          stage(ch("c12"), "never"),
          line(idB, contractNow - 400, ch("c12"), "creator.never", "Asked us to stop"),
        );
        expect((await source.creatorStates()).find((c) => c.id === ch("c12"))).toMatchObject({
          rejectReason: null,
          rejectedAt: contractNow - 400,
          neverReason: "Asked us to stop",
        });
        expect(frame.creators.find((c) => c.id === ch("c12"))?.neverReason).toBe(
          "Asked us to stop",
        );
        withDb(file, (db) => {
          db.prepare("DELETE FROM activity_log WHERE id = ?").run(idA);
        });
        expect(
          (await source.creatorStates()).find((c) => c.id === ch("c11"))?.lastActivity,
        ).toEqual({
          at: Date.parse("2026-10-19T09:00:00Z"),
          who: "Sara",
        });
      });
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

    describe("draft writes (plan step 6, D5)", () => {
      const creator = "UCdraftsAiCreator0000001";
      const hold = contractNow + 10_000;

      function addDraft(
        source: DataSource,
        id: string,
        over: { kind?: "first" | "followUp" | "reply"; state?: DraftState } = {},
      ): void {
        source.outreach.insertDraft({
          id,
          creator,
          kind: over.kind ?? "first",
          followUp: over.kind === "followUp" ? 1 : null,
          mailbox: null,
          replyTo: null,
          at: contractNow - 1000,
        });
        source.outreach.updateDraft(
          id,
          { state: over.state ?? "ready", subject: "Subject", body: "Body" },
          contractNow - 1000,
        );
      }

      const state = (
        id: string,
        to: "ready" | "approved" | "scheduled" | "skipped",
        sendAt: number | null = null,
      ): DataWrite => ({ kind: "draft.state", id, state: to, sendAt });

      it("serves a draft in the frame with its fields", async () => {
        const source = start();
        addDraft(source, "d-frame");
        const frame = await source.frame();
        expect(frame.reach.drafts.find((d) => d.id === "d-frame")).toMatchObject({
          creator,
          kind: "first",
          state: "ready",
          subject: "Subject",
        });
        expect(frameSchema.safeParse(frame).success).toBe(true);
      });

      it("approves and schedules from ready or failed, recording who and when", async () => {
        const source = start();
        addDraft(source, "d1");
        addDraft(source, "d2", { state: "failed" });
        await source.write([state("d1", "approved", hold), state("d2", "scheduled", hold + 1)]);
        expect(source.outreach.draft("d1")).toMatchObject({
          state: "approved",
          approvedBy: "u1",
          sendAt: hold,
        });
        expect(source.outreach.draft("d2")).toMatchObject({
          state: "scheduled",
          approvedBy: "u1",
          sendAt: hold + 1,
        });
      });

      it("never approves a draft that may have gone out: only It was sent or Send as new", async () => {
        const source = start();
        addDraft(source, "d1", { state: "failed" });
        source.outreach.updateDraft("d1", { problem: "maybe_sent" }, contractNow);
        await source.write([state("d1", "approved", hold), state("d1", "scheduled", hold)]);
        expect(source.outreach.draft("d1")).toMatchObject({ state: "failed", approvedBy: null });
      });

      it("gives every approval its full hold, even one carrying a time already past", async () => {
        // A Redo, or an Undo that puts an old approval back, carries the old time: it must not
        // send at once.
        const source = start();
        addDraft(source, "d1");
        addDraft(source, "d2");
        await source.write([
          state("d1", "approved", contractNow - 60_000),
          state("d2", "scheduled", contractNow - 30_000),
        ]);
        expect(source.outreach.draft("d1")?.sendAt).toBe(hold);
        expect(source.outreach.draft("d2")?.sendAt).toBe(hold);
      });

      it("refuses a Send later whose time is long past, and says so", async () => {
        // A Redo of a schedule, or an Undo of its Cancel, the day after: not sent at once.
        const source = start();
        addDraft(source, "d1");
        await source.write([state("d1", "scheduled", contractNow - 61_000)]);
        expect(source.outreach.draft("d1")).toMatchObject({
          state: "ready",
          approvedBy: null,
          sendAt: null,
          problem: "time_passed",
        });
        // Sending it again clears the note.
        await source.write([state("d1", "approved", hold)]);
        expect(source.outreach.draft("d1")).toMatchObject({ state: "approved", problem: null });
      });

      it("puts an approved or skipped draft back to ready, clearing the hold and the problem", async () => {
        const source = start();
        addDraft(source, "d1");
        await source.write([state("d1", "approved", hold)]);
        source.outreach.updateDraft("d1", { problem: "late" }, contractNow);
        await source.write([state("d1", "ready")]);
        expect(source.outreach.draft("d1")).toMatchObject({
          state: "ready",
          approvedBy: null,
          sendAt: null,
          problem: null,
        });
        await source.write([state("d1", "skipped")]);
        expect(source.outreach.draft("d1")).toMatchObject({ state: "skipped", sendAt: null });
        await source.write([state("d1", "ready")]);
        expect(source.outreach.draft("d1")?.state).toBe("ready");
      });

      it("refuses every other move and logs the kind only", async () => {
        const source = start();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          for (const from of ["drafting", "sending", "sent"] as const) {
            addDraft(source, `d-${from}`, { state: from });
            await source.write([state(`d-${from}`, "approved", hold), state(`d-${from}`, "ready")]);
            expect(source.outreach.draft(`d-${from}`)?.state).toBe(from);
            expect(source.outreach.draft(`d-${from}`)?.approvedBy).toBeNull();
          }
          addDraft(source, "d-sched");
          await source.write([state("d-sched", "scheduled", hold)]);
          // The taken states do not move among themselves, and ready stays ready.
          await source.write([state("d-sched", "skipped"), state("d-sched", "approved", hold)]);
          expect(source.outreach.draft("d-sched")?.state).toBe("scheduled");
          addDraft(source, "d-ready");
          await source.write([state("d-ready", "ready")]);
          expect(source.outreach.draft("d-ready")?.state).toBe("ready");
          // A failed draft is not put back by a person: only ready and failed go forward.
          addDraft(source, "d-failed", { state: "failed" });
          await source.write([state("d-failed", "ready")]);
          expect(source.outreach.draft("d-failed")?.state).toBe("failed");
          // A draft that does not exist is ignored.
          await source.write([state("missing", "approved", hold)]);
          const logged = JSON.stringify(warn.mock.calls);
          expect(logged).toContain("draft.state");
          expect(logged).not.toContain("Subject");
        } finally {
          warn.mockRestore();
        }
      });

      it("stores the text, marks it edited, and leaves a draft that is going or gone", async () => {
        const source = start();
        addDraft(source, "d1");
        addDraft(source, "d-sending", { state: "sending" });
        addDraft(source, "d-sent", { state: "sent" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          await source.write([
            { kind: "draft.text", id: "d1", subject: "New", body: "New body" },
            { kind: "draft.text", id: "d-sending", subject: "X", body: "X" },
            { kind: "draft.text", id: "d-sent", subject: "X", body: "X" },
          ]);
        } finally {
          warn.mockRestore();
        }
        expect(source.outreach.draft("d1")).toMatchObject({
          subject: "New",
          body: "New body",
          edited: true,
          checked: false,
        });
        expect(source.outreach.draft("d-sending")).toMatchObject({
          subject: "Subject",
          edited: false,
        });
        expect(source.outreach.draft("d-sent")).toMatchObject({ body: "Body", edited: false });
      });

      it("stores a mailbox for a first email and refuses it for follow-ups and answers", async () => {
        const source = start();
        addDraft(source, "d-first");
        addDraft(source, "d-follow", { kind: "followUp" });
        addDraft(source, "d-reply", { kind: "reply" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          const mailbox = "outreach2@gratovo.example";
          await source.write([
            { kind: "draft.mailbox", id: "d-first", mailbox },
            { kind: "draft.mailbox", id: "d-follow", mailbox },
            { kind: "draft.mailbox", id: "d-reply", mailbox },
          ]);
          expect(source.outreach.draft("d-first")?.mailbox).toBe(mailbox);
          expect(source.outreach.draft("d-follow")?.mailbox).toBeNull();
          expect(source.outreach.draft("d-reply")?.mailbox).toBeNull();
          await source.write([{ kind: "draft.mailbox", id: "d-first", mailbox: null }]);
          expect(source.outreach.draft("d-first")?.mailbox).toBeNull();
        } finally {
          warn.mockRestore();
        }
      });

      it("adds and removes a confirmed gate once, keeping the order", async () => {
        const source = start();
        addDraft(source, "d1");
        const gate = (key: string, ok: boolean): DataWrite => ({
          kind: "draft.gate",
          id: "d1",
          gate: key,
          ok,
        });
        await source.write([gate("a", true), gate("b", true), gate("a", true)]);
        expect(source.outreach.draft("d1")?.gatesOk).toEqual(["b", "a"]);
        await source.write([gate("b", false), gate("zzz", false)]);
        expect(source.outreach.draft("d1")?.gatesOk).toEqual(["a"]);
      });

      it("commits a draft, a message and a stage change together", async () => {
        const source = start();
        addDraft(source, "d1");
        source.outreach.commit({
          at: contractNow,
          drafts: [{ id: "d1", patch: { state: "sent" } }],
          messages: [
            {
              id: "m1",
              creator,
              direction: "out",
              kind: "first",
              followUp: null,
              subject: "Subject",
              body: "Body",
              bodyCut: false,
              at: contractNow,
              mailbox: "outreach1@gratovo.example",
              peer: "a@b.example",
              peerName: null,
              conversationKey: `c:${creator}`,
              gmailMessageId: "g-1",
              gmailThreadId: null,
              draftId: "d1",
              by: "u1",
              source: "app",
              reading: null,
            },
          ],
          writes: [
            {
              kind: "creator.stage",
              id: creator,
              stage: "emailed",
              handle: "@drafts",
              name: "Drafts",
            },
          ],
        });
        const frame = await source.frame();
        expect(frame.creators.find((c) => c.id === creator)?.stage).toBe("emailed");
        expect(frame.reach.threads.find((t) => t.creator === creator)).toMatchObject({
          count: 1,
          answered: true,
        });
        expect(source.outreach.draft("d1")?.state).toBe("sent");
      });

      it("saves a fact a reply gave, shows it saved in the frame, and ignores a repeat or a stranger", async () => {
        const source = start();
        const reading = {
          replyType: "inf.gives_rate",
          label: "Gives their rate or rate card",
          summary: "They gave a price.",
          side: "influencer",
          corrected: false,
          facts: [
            { key: "rate" as const, rate: 1200, saved: false },
            { key: "age" as const, band: "25-34", saved: false },
          ],
        };
        source.outreach.commit({
          at: contractNow,
          messages: [
            {
              id: "m-in",
              creator,
              direction: "in",
              kind: null,
              followUp: null,
              subject: "Re: Hello",
              body: "My rate is $1,200. Audience ages 25-34.",
              bodyCut: false,
              at: contractNow,
              mailbox: "outreach1@gratovo.example",
              peer: "a@b.example",
              peerName: null,
              conversationKey: `c:${creator}`,
              gmailMessageId: "g-in",
              gmailThreadId: null,
              draftId: null,
              by: null,
              source: "sweep",
              reading,
            },
          ],
          writes: [
            {
              kind: "creator.stage",
              id: creator,
              stage: "replied",
              handle: "@drafts",
              name: "Drafts",
            },
          ],
        });
        const saved = async (): Promise<unknown> =>
          (await source.frame()).reach.threads
            .find((t) => t.creator === creator)
            ?.lastIn?.reading?.facts.map((f) => [f.key, f.saved]);
        expect(await saved()).toEqual([
          ["rate", false],
          ["age", false],
        ]);
        await source.write([
          { kind: "reply.fact", messageId: "m-in", key: "rate" },
          { kind: "reply.fact", messageId: "m-in", key: "rate" },
          { kind: "reply.fact", messageId: "nobody", key: "age" },
        ]);
        expect(await saved()).toEqual([
          ["rate", true],
          ["age", false],
        ]);
        expect(source.outreach.message("m-in")?.factsSaved).toEqual(["rate"]);
      });

      it("adds a notification in a commit and serves it in the frame", async () => {
        const source = start();
        source.outreach.commit({
          at: contractNow,
          notifications: [
            {
              id: "reply-x",
              at: contractNow,
              icon: "reply",
              text: "Vector Vlog replied",
              sub: "Re: Hello",
              go: { screen: "reach", tab: "inbox" },
              read: false,
            },
          ],
        });
        const frame = await source.frame();
        expect(frame.notifications.find((n) => n.id === "reply-x")).toMatchObject({
          icon: "reply",
          go: { screen: "reach", tab: "inbox" },
          read: false,
        });
        await frameSchema.parseAsync(frame);
      });
    });

    describe("the media kit (plan step 8, D2 to D4 and D10)", () => {
      const kitCreator = "UCkitCreatorAiTools00001";
      const noKit = { countries: [], ageBand: null, engagement: null, rate: null, link: null };
      const typed = (
        over: Partial<Extract<DataWrite, { kind: "creator.kit" }>["kit"]>,
      ): DataWrite => ({
        kind: "creator.kit",
        id: kitCreator,
        kit: { ...noKit, ...over },
        handle: "@kitcreator",
        name: "Kit Creator",
      });
      const stageTo = (stage: CreatorStage): DataWrite => ({
        kind: "creator.stage",
        id: kitCreator,
        stage,
        handle: "@kitcreator",
        name: "Kit Creator",
      });

      /** A creator at `stage` with a reply in that reads a rate, countries and an age. */
      async function seed(source: DataSource, stage: CreatorStage): Promise<void> {
        await source.write([stageTo(stage)]);
        source.outreach.commit({
          at: contractNow,
          messages: [
            {
              id: "m-kit",
              creator: kitCreator,
              direction: "in",
              kind: null,
              followUp: null,
              subject: "Re: Hello",
              body: "Rate 900. Mostly US.",
              bodyCut: false,
              at: contractNow,
              mailbox: "outreach1@gratovo.example",
              peer: "a@b.example",
              peerName: null,
              conversationKey: `c:${kitCreator}`,
              gmailMessageId: "g-kit",
              gmailThreadId: null,
              draftId: null,
              by: null,
              source: "sweep",
              reading: {
                replyType: "inf.gives_rate",
                label: "Gives their rate or rate card",
                summary: "They gave numbers.",
                side: "influencer",
                corrected: false,
                facts: [
                  { key: "rate" as const, rate: 900, saved: false },
                  {
                    key: "countries" as const,
                    countries: [{ code: "US", share: 60 }],
                    saved: false,
                  },
                  { key: "age" as const, band: "25-34", saved: false },
                ],
              },
            },
          ],
        });
      }

      const stateOf = async (source: DataSource) =>
        (await source.creatorStates()).find((c) => c.id === kitCreator);
      const frameCreator = async (source: DataSource) =>
        (await source.frame()).creators.find((c) => c.id === kitCreator);

      it("shows a typed kit in the frame and in the states, the typed value over the reply", async () => {
        const source = start();
        await seed(source, "emailed");
        await source.write([{ kind: "reply.fact", messageId: "m-kit", key: "age" }]);
        await source.write([
          typed({ ageBand: "18-24", engagement: 4.5, link: "https://example.com/kit" }),
        ]);
        const expected = {
          countries: [],
          ageBand: "18-24",
          engagement: 4.5,
          rate: null,
          rateKnown: false,
          link: "https://example.com/kit",
          fromReply: false,
        };
        expect((await frameCreator(source))?.kit).toEqual(expected);
        expect((await stateOf(source))?.kit).toEqual(expected);
      });

      it("moves a replied creator to kit when a typed kit gives a rate and a country, with a log line", async () => {
        const source = start();
        await seed(source, "replied");
        await source.write([typed({ rate: 800, countries: [{ code: "GB", share: 70 }] })]);
        expect((await frameCreator(source))?.stage).toBe("kit");
        const frame = await source.frame();
        expect(frame.log.filter((l) => l.text === "Media kit in for Kit Creator")).toHaveLength(1);
      });

      it("does not move a creator that is not replied", async () => {
        const source = start();
        await seed(source, "emailed");
        await source.write([typed({ rate: 800, countries: [{ code: "GB", share: 70 }] })]);
        expect((await frameCreator(source))?.stage).toBe("emailed");
        expect((await source.frame()).log.some((l) => l.text.startsWith("Media kit in"))).toBe(
          false,
        );
      });

      it("moves a replied creator to kit when saved reply facts bring the rate and then the countries", async () => {
        const source = start();
        await seed(source, "replied");
        await source.write([{ kind: "reply.fact", messageId: "m-kit", key: "rate" }]);
        expect((await frameCreator(source))?.stage).toBe("replied");
        await source.write([{ kind: "reply.fact", messageId: "m-kit", key: "countries" }]);
        expect((await frameCreator(source))?.stage).toBe("kit");
        expect((await frameCreator(source))?.kit).toMatchObject({
          rate: 900,
          rateKnown: true,
          fromReply: true,
        });
        expect(
          (await source.frame()).log.some((l) => l.text === "Media kit in for Kit Creator"),
        ).toBe(true);
      });

      it("hides the kit rate from a viewer without money, but keeps it in the states", async () => {
        const source = start();
        await seed(source, "replied");
        await source.write([typed({ rate: 800, countries: [{ code: "GB", share: 70 }] })]);
        setAccess(file, [{ profileId: "u1", roles: ["scout", "outreach"], seesMoney: false }]);
        expect((await frameCreator(source))?.kit).toMatchObject({ rate: null, rateKnown: true });
        expect((await frameCreator(source))?.kit?.countries).toHaveLength(1);
        expect((await stateOf(source))?.kit?.rate).toBe(800);
      });

      it("keeps the stored rate when a viewer without money writes the kit", async () => {
        const source = start();
        await seed(source, "replied");
        await source.write([typed({ rate: 800, countries: [{ code: "GB", share: 70 }] })]);
        setAccess(file, [{ profileId: "u1", roles: ["scout", "outreach"], seesMoney: false }]);
        await source.write([typed({ rate: 5000, countries: [{ code: "CA", share: 70 }] })]);
        expect((await stateOf(source))?.kit?.rate).toBe(800);
        expect((await stateOf(source))?.kit?.countries[0]?.code).toBe("CA");
      });
    });
  });
}
