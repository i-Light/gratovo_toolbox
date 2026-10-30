import type { DatabaseSync } from "node:sqlite";

import { exampleSeed, exampleSeedVersion } from "@gratovo/core/data";
import type { DataSource, ExampleHealth, Scenario } from "@gratovo/core/data";

import { restampStageEventsSql } from "../db/migrations/0007-insights";
import { openDatabase } from "../db/open-database";

import {
  addLogEntry,
  createOutreachStore,
  getMeta,
  replaceMemberAccess,
  setMeta,
  setNotify,
  setSetting,
  upsertBrandDetails,
  upsertCreator,
  upsertCreatorDetails,
  upsertDealDetails,
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
  "stage_events",
  "catalog_weeks",
  "brand_details",
  "deal_details",
  "creator_details",
] as const;

/** The `local_settings` key the seed writes its `health` to (the "Something broke" scenario). */
export const exampleHealthKey = "example.health";

/** The most signed-out mailboxes a stored health may list. */
const healthAddressesMax = 20;

export interface ExampleOptions {
  /** Seed again even if the stored seed is current (a turn-on, a scenario pick). */
  readonly fresh?: boolean;
  /** Which variant of the example to seed (default "normal"). */
  readonly scenario?: Scenario;
}

/** An open example copy and its own database handle (prototype mode keeps its comments there). */
export interface ExampleCopy {
  readonly source: DataSource;
  /** The same handle the source uses: closing the source closes it. */
  readonly db: DatabaseSync;
}

/**
 * Opens the example database at `path`. A missing file, or one seeded by an older
 * `exampleSeedVersion`, is cleared and seeded again from the fixtures; otherwise it is kept as the
 * app left it. `options.fresh` seeds again in any case, from `options.scenario`. `now` is the clock
 * in ms (default `Date.now`).
 */
export function openExampleSource(
  path: string,
  now: () => number = Date.now,
  options: ExampleOptions = {},
): DataSource {
  return openExampleCopy(path, now, options).source;
}

/** `openExampleSource`, also handing back the database handle the source reads and writes. */
export function openExampleCopy(
  path: string,
  now: () => number = Date.now,
  options: ExampleOptions = {},
): ExampleCopy {
  const scenario = options.scenario ?? "normal";
  const db = openDatabase(path);
  try {
    const stored = Number(getMeta(db, seedKey) ?? 0);
    if (options.fresh === true || !(stored >= exampleSeedVersion)) {
      seed(db, now(), scenario);
    }
    const fixtures = exampleSeed(now(), scenario);
    const source = createSqliteSource(db, {
      source: "example",
      me: fixtures.me,
      now,
      extras: {
        presence: (id) => fixtures.presence[id] ?? { status: "away", doing: "" },
        counts: () => fixtures.counts,
        mateRun: () => fixtures.mateRun(now()),
      },
    });
    return { source, db };
  } catch (error) {
    db.close();
    throw error;
  }
}

const healthy: ExampleHealth = { signedOut: [], geminiOffline: false };

/** The open example copy's health, `{ signedOut: [], geminiOffline: false }` when none. */
export function readExampleHealth(source: Pick<DataSource, "readSetting">): ExampleHealth {
  const value = source.readSetting(exampleHealthKey);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return healthy;
  }
  const map = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(map);
  const { signedOut, geminiOffline } = map;
  if (
    keys.length !== 2 ||
    !keys.includes("signedOut") ||
    !keys.includes("geminiOffline") ||
    typeof geminiOffline !== "boolean" ||
    !Array.isArray(signedOut) ||
    signedOut.length > healthAddressesMax ||
    !(signedOut as unknown[]).every((address) => typeof address === "string")
  ) {
    return healthy;
  }
  return { signedOut: [...(signedOut as string[])], geminiOffline };
}

function seed(db: DatabaseSync, now: number, scenario: Scenario): void {
  const fixtures = exampleSeed(now, scenario);
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
      if (creator.details !== undefined) {
        upsertCreatorDetails(db, creator.id, creator.details);
      }
    }
    for (const [id, kit] of Object.entries(fixtures.kits)) {
      db.prepare(
        `UPDATE channel_state SET media_kit = ?, provided_data = ?, manual_engagement_rate = ?
         WHERE channel_id = ?`,
      ).run(
        kit.mediaKit === undefined ? null : JSON.stringify(kit.mediaKit),
        kit.provided === undefined ? null : JSON.stringify(kit.provided),
        kit.engagement ?? null,
        id,
      );
    }
    // The reject and never lines the readers take a creator's reasons from, and the date a
    // rejected creator leaves (the server's 7 days after the reject).
    for (const entry of fixtures.log) {
      addLogEntry(db, entry.who, entry);
    }
    for (const creator of fixtures.creators) {
      if (creator.archiveDueAt !== null) {
        db.prepare("UPDATE channel_state SET archive_due_at = ? WHERE channel_id = ?").run(
          new Date(creator.archiveDueAt).toISOString(),
          creator.id,
        );
      }
    }
    for (const brand of fixtures.brands) {
      upsertBrandDetails(db, brand, now);
    }
    for (const deal of fixtures.deals) {
      upsertDealDetails(db, deal, now);
    }
    for (const notification of fixtures.notifications) {
      upsertNotification(db, notification);
    }
    setNotify(db, {});
    setSetting(db, "mail.settings", fixtures.mailSettings);
    setSetting(db, "reach.mailboxes", fixtures.reachMailboxes);
    if (fixtures.health !== null) {
      setSetting(db, exampleHealthKey, fixtures.health);
    }
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
    outreach.commit({
      at: now,
      messages: fixtures.outreach.messages,
      sequences: fixtures.outreach.sequences,
    });
    // The inserts stamped every creator's stage with now: the log and the messages know better.
    db.exec(restampStageEventsSql);
    setMeta(db, seedKey, String(exampleSeedVersion));
  });
}
