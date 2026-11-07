import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boardLanes } from "@gratovo/core/reach";
import { exampleHistory } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openExampleCopy } from "../data";

import { writeHistoryLocal } from "./example-history";

const now = Date.UTC(2026, 9, 20, 10, 30, 0);

/** T13: the history's creators and outreach must reach the frame, and so the Reach board. */
describe("the frame of a prototype copy with the history loaded", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-histframe-"));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("carries the history's creators, and the board has current work in its working lanes", async () => {
    const history = exampleHistory(now, "normal");
    if (history === null) {
      throw new Error("the normal scenario has a history");
    }
    const copy = openExampleCopy(join(folder, "prototype.db"), () => now, {
      fresh: true,
      scenario: "normal",
    });
    try {
      writeHistoryLocal(copy.db, history.gratovo);
      const frame = await copy.source.frame();
      const ids = new Set(frame.creators.map((c) => c.id));
      expect(frame.creators.length).toBeGreaterThan(1000);
      for (const stage of ["emailed", "contact", "replied"] as const) {
        expect(frame.creators.filter((c) => c.stage === stage).length).toBeGreaterThan(5);
      }
      expect(frame.reach.sequences.length).toBeGreaterThan(0);
      expect(frame.reach.sequences.every((s) => ids.has(s.creator))).toBe(true);
      expect(frame.reach.drafts.every((d) => ids.has(d.creator))).toBe(true);
      expect(frame.reach.threads.filter((t) => ids.has(t.creator)).length).toBeGreaterThan(0);
      const lanes = boardLanes({
        creators: frame.creators,
        drafts: frame.reach.drafts,
        threads: frame.reach.threads,
        sequences: frame.reach.sequences,
        source: frame.source,
      });
      const sizes = Object.fromEntries(lanes.map((l) => [l.key, l.items.length]));
      for (const key of ["todraft", "waiting", "seq", "replied"]) {
        expect(sizes[key], key).toBeGreaterThan(0);
      }
    } finally {
      copy.db.close();
    }
  });
});
