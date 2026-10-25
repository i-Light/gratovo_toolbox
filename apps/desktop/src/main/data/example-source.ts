import type { DatabaseSync } from "node:sqlite";

import { exampleSeed, exampleSeedVersion } from "@gratovo/core/data";
import type { DataSource } from "@gratovo/core/data";

import { openDatabase } from "../db/open-database";

import {
  createOutreachStore,
  getMeta,
  replaceMemberAccess,
  setMeta,
  setNotify,
  setSetting,
  upsertBrand,
  upsertCreator,
  upsertDeal,
  upsertNotification,
  upsertProfile,
} from "./repositories";
import { createSqliteSource, inTransaction } from "./sqlite-source";

const seedKey = "example_seed";

/** Tables the example seed fills, cleared before it runs again. `_meta` stays. */
const dataTables = [
  "activity_log",
  "notifications",
  "deals",
  "brands",
  "channel_state",
  "channels",
  "profiles",
  "local_settings",
  "member_access",
  "outreach_drafts",
  "outreach_messages",
  "outreach_sequences",
] as const;

/**
 * Opens the example database at `path`. A missing file, or one seeded by an older
 * `exampleSeedVersion`, is cleared and seeded again from the fixtures; otherwise it is kept as the
 * app left it. `now` is the clock in ms (default `Date.now`).
 */
export function openExampleSource(path: string, now: () => number = Date.now): DataSource {
  const db = openDatabase(path);
  try {
    const stored = Number(getMeta(db, seedKey) ?? 0);
    if (!(stored >= exampleSeedVersion)) {
      seed(db, now());
    }
    const fixtures = exampleSeed(now());
    return createSqliteSource(db, {
      source: "example",
      me: fixtures.me,
      now,
      extras: {
        presence: (id) => fixtures.presence[id] ?? { status: "away", doing: "" },
        counts: () => fixtures.counts,
        mateRun: () => fixtures.mateRun(now()),
      },
    });
  } catch (error) {
    db.close();
    throw error;
  }
}

function seed(db: DatabaseSync, now: number): void {
  const fixtures = exampleSeed(now);
  inTransaction(db, () => {
    for (const table of dataTables) {
      db.exec(`DELETE FROM ${table}`);
    }
    for (const profile of fixtures.profiles) {
      upsertProfile(db, profile, now);
    }
    const iso = new Date(now).toISOString();
    replaceMemberAccess(
      db,
      fixtures.access.map((row) => ({ ...row, updatedAt: iso })),
    );
    for (const creator of fixtures.creators) {
      upsertCreator(db, creator, now);
    }
    for (const brand of fixtures.brands) {
      upsertBrand(db, brand, now);
    }
    for (const deal of fixtures.deals) {
      upsertDeal(db, deal, now);
    }
    for (const notification of fixtures.notifications) {
      upsertNotification(db, notification);
    }
    setNotify(db, {});
    setSetting(db, "mail.settings", fixtures.mailSettings);
    setSetting(db, "reach.mailboxes", fixtures.reachMailboxes);
    // Only the inserts are used here, so the store needs no transaction of its own.
    const outreach = createOutreachStore(db, {
      transaction: (fn) => {
        fn();
      },
      applyWrites: () => undefined,
    });
    for (const { state, subject, body, proposal, ...draft } of fixtures.outreach.drafts) {
      outreach.insertDraft(draft);
      outreach.updateDraft(draft.id, { state, subject, body, proposal }, draft.at);
    }
    outreach.commit({ at: now, messages: fixtures.outreach.messages });
    setMeta(db, seedKey, String(exampleSeedVersion));
  });
}
