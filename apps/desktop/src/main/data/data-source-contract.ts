import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleFrame, nameMax } from "@gratovo/core/data";
import type { DataSource, DataWrite, Frame } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/** The tests every `DataSource` over the local database must pass. */
export function describeDataSourceContract(name: string, make: MakeSource): void {
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
      for (const source of open) source.close();
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
      expect(frame.me).toBe("u1");
      expect(frame.myName).toBeNull();
      expect(frame.creators).toEqual(expected.creators);
      expect(frame.brands).toEqual(expected.brands);
      expect(frame.deals).toEqual(expected.deals);
      expect(frame.notifications).toEqual(expected.notifications);
      expect(frame.team.map(({ id, name, role }) => ({ id, name, role }))).toEqual(
        expected.team.map(({ id, name, role }) => ({ id, name, role })),
      );
      expect(frame.log).toEqual([]);
      expect(frame.notify).toEqual({});
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
        { id: idB, at: contractNow - 1000, who: "Ada", text: "Changed a switch" },
        { id: idA, at: contractNow - 2000, who: "Ada", text: "Marked all read" },
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
  });
}
