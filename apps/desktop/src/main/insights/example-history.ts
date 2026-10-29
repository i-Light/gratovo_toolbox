import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { exampleHistory } from "@gratovo/core/data";
import type { ExampleHistory, Scenario } from "@gratovo/core/data";

import { inTransaction } from "../data/sqlite-source";
import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";
import { kindOf } from "../prototype/kind-of";

/**
 * Loading the example history into a fresh prototype copy (plan step P8a, decision A7).
 *
 * The history's `gratovo` part is written into `gratovo.db` here, in one transaction. Its
 * `pipeline` part (the catalog and the archive of about 150,000) is written as one JSON file into
 * the prototype's pipeline folder and handed to the Python job `example.load`, which owns
 * `pipeline.db`'s schema and writes it. Nothing here may stop prototype mode from opening: a
 * failure is logged by kind and swallowed.
 */

export const historyFile = "history.json";
/** The longest the Python load is waited for. */
export const loadWaitMs = 60_000;

type Gratovo = ExampleHistory["gratovo"];

/** The columns a table takes, in the order of its row type. */
function insertSql(table: string, columns: readonly string[], replace = false): string {
  const marks = columns.map(() => "?").join(", ");
  return `INSERT ${replace ? "OR REPLACE " : ""}INTO ${table} (${columns.join(", ")}) VALUES (${marks})`;
}

/** Prepares `sql` once and runs it for every row; `values` lists a row's values in column order. */
function insertAll<T>(
  db: DatabaseSync,
  sql: string,
  rows: readonly T[],
  values: (row: T) => SQLInputValue[],
): void {
  const statement = db.prepare(sql);
  for (const row of rows) {
    statement.run(...values(row));
  }
}

/** Reads each named key of a row, in order. */
function pick<T extends object>(
  row: T,
  columns: readonly Extract<keyof T, string>[],
): SQLInputValue[] {
  return columns.map((column) => row[column] as SQLInputValue);
}

const creatorColumns = [
  "channel_id",
  "handle",
  "vetting_status",
  "pipeline_stage",
  "creator_stage",
  "archive_due_at",
  "channel_tags",
  "contacts",
  "updated_at",
] as const satisfies readonly Extract<keyof Gratovo["creators"][number], string>[];

const logColumns = [
  "id",
  "at",
  "at_ms",
  "actor_id",
  "actor_name",
  "actor_role",
  "action",
  "entity_type",
  "entity_id",
  "entity_label",
  "field",
  "old_value",
  "new_value",
  "detail",
] as const;

const draftColumns = [
  "id",
  "channel_id",
  "kind",
  "follow_up",
  "state",
  "subject",
  "body",
  "mailbox",
  "send_at",
  "approved_by",
  "proposal",
  "gates_ok",
  "edited",
  "checked_text",
  "steer",
  "reply_to",
  "problem",
  "goal",
  "created_at",
  "updated_at",
] as const satisfies readonly Extract<keyof Gratovo["drafts"][number], string>[];

const messageColumns = [
  "id",
  "channel_id",
  "direction",
  "kind",
  "follow_up",
  "subject",
  "body",
  "body_cut",
  "at",
  "mailbox",
  "peer",
  "peer_name",
  "conversation_key",
  "gmail_message_id",
  "gmail_thread_id",
  "draft_id",
  "by",
  "source",
  "reading",
] as const satisfies readonly Extract<keyof Gratovo["messages"][number], string>[];

const sequenceColumns = [
  "channel_id",
  "conversation_key",
  "mailbox",
  "started_at",
  "steps",
  "stopped",
  "park_until",
  "updated_at",
] as const satisfies readonly Extract<keyof Gratovo["sequences"][number], string>[];

const weekColumns = [
  "week",
  "live",
  "waiting",
  "archive",
  "written_at",
] as const satisfies readonly Extract<keyof Gratovo["weeks"][number], string>[];

/**
 * Writes the history's local part into `gratovo.db`, in one transaction. Inserting `creators`
 * fires the stage-event triggers (source `change`, stamped with now): those rows are removed for
 * the history's creators and the history's own `events` take their place. The seed has already put
 * times on its own creators' events (`restampStageEventsSql`).
 */
export function writeHistoryLocal(db: DatabaseSync, history: Gratovo): void {
  inTransaction(db, () => {
    insertAll(db, insertSql("channel_state", creatorColumns), history.creators, (row) =>
      pick(row, creatorColumns),
    );
    insertAll(db, insertSql("channels", ["channel_id", "name"]), history.names, (row) => [
      row.channel_id,
      row.name,
    ]);
    insertAll(db, insertSql("activity_log", logColumns), history.log, (row) =>
      logColumns.map((column) => {
        const value = row[column];
        if (column === "detail") {
          return JSON.stringify(value);
        }
        // `at_ms` must be a whole number (the table is strict).
        return (column === "at_ms" ? Math.round(row.at_ms) : value) as SQLInputValue;
      }),
    );
    insertAll(db, insertSql("outreach_drafts", draftColumns), history.drafts, (row) =>
      pick(row, draftColumns),
    );
    insertAll(db, insertSql("outreach_messages", messageColumns), history.messages, (row) =>
      pick(row, messageColumns),
    );
    insertAll(db, insertSql("outreach_sequences", sequenceColumns), history.sequences, (row) =>
      pick(row, sequenceColumns),
    );
    // A week may be there from an earlier copy: the history's row wins.
    insertAll(db, insertSql("catalog_weeks", weekColumns, true), history.weeks, (row) =>
      pick(row, weekColumns),
    );

    // The triggers stamped the creators with now; the history knows when they really moved.
    const forget = db.prepare(
      "DELETE FROM stage_events WHERE source = 'change' AND channel_id = ?",
    );
    for (const row of history.creators) {
      forget.run(row.channel_id);
    }
    // An earlier copy's example events (the same ids come again) must not double.
    db.exec("DELETE FROM stage_events WHERE source = 'example'");
    insertAll(
      db,
      "INSERT INTO stage_events (channel_id, stage, at, source) VALUES (?, ?, ?, ?)",
      history.events,
      (row) => [row.channel_id, row.stage, row.at, row.source],
    );
  });
}

export interface LoadHistoryOptions {
  /** The prototype copy's database. */
  db: DatabaseSync;
  scenario: Scenario;
  now: number;
  /** The prototype's pipeline folder (where `pipeline.db` is written). */
  folder: string;
  /** Runs one job on the store lane and resolves when it has ended. */
  runJob: (start: Start) => Promise<JobOutcome>;
  /**
   * Sets the owner's archive days (Settings › Search rules) for the data now open, to the number
   * the history was built with. Called after the load, even when the load failed.
   */
  setArchiveDays?: (days: number) => void;
  /** The longest to wait for the load. Default `loadWaitMs`. */
  waitMs?: number;
}

function failure(kind: string): void {
  console.warn(`Prototype: the example history could not be loaded (${kind}).`);
}

/** The reason a job did not finish `done`, or null when it did. */
function problemOf(outcome: JobOutcome): string | null {
  if (!outcome.ok) {
    return outcome.problem;
  }
  const exit = outcome.exit;
  if (exit.kind === "failed") {
    return exit.reason;
  }
  return exit.end.state === "done" ? null : (exit.end.error?.code ?? exit.end.state);
}

/**
 * Loads the example history for `scenario`: nothing for "first". Never throws: prototype mode
 * opens with whatever landed.
 */
export async function loadHistory(o: LoadHistoryOptions): Promise<void> {
  let history: ExampleHistory | null;
  try {
    history = exampleHistory(o.now, o.scenario);
  } catch (error) {
    failure(kindOf(error));
    return;
  }
  if (history === null) {
    return;
  }
  try {
    writeHistoryLocal(o.db, history.gratovo);
  } catch (error) {
    failure(`local ${kindOf(error)}`);
    return;
  }
  const file = join(o.folder, historyFile);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    mkdirSync(o.folder, { recursive: true });
    writeFileSync(file, JSON.stringify(history.pipeline));
    const start: Start = {
      type: "start",
      protocol: 1,
      source: "example",
      dataDir: o.folder,
      worker: "prototype",
      job: { kind: "example.load", file: historyFile },
      settings: {},
      secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
    };
    const waited = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        resolve("timeout");
      }, o.waitMs ?? loadWaitMs);
    });
    const outcome = await Promise.race([o.runJob(start), waited]);
    if (outcome === "timeout") {
      failure("timeout");
    } else {
      const problem = problemOf(outcome);
      if (problem !== null) {
        failure(problem);
      }
    }
  } catch (error) {
    failure(kindOf(error));
  } finally {
    clearTimeout(timer);
    try {
      rmSync(file, { force: true });
    } catch {
      // The job deletes it too; a file left behind is only a stale copy of example data.
    }
  }
  try {
    o.setArchiveDays?.(history.gratovo.settings.archiveDays);
  } catch (error) {
    failure(`archive days ${kindOf(error)}`);
  }
}
