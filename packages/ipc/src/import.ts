import { z } from "zod";

/**
 * The import of the old app's data (plan step 4, D2 to D6). The page names a file it was offered
 * or picked; main refuses anything that isn't an old `gratovo.db`, opens it read-only, and hands it
 * to the pipeline's `import.legacy` job. Paths are this computer's, shown to the owner; no value
 * here is a secret.
 */

/** A file or folder on this computer, as main's dialogs and the pipeline's `dataDir` allow. */
export const localPath = z.string().min(1).max(1024);

/** A UTC instant as ISO 8601 text, such as "2026-10-24T09:30:00.000Z". */
export const isoTime = z.iso.datetime();

/** Rows in one table of the old file. */
const rows = z.number().int().min(0).max(1_000_000_000);
/**
 * A table's name in the old file (`channels`, `_outbox`), and a settings file's name beside it
 * (`run_config.json`). As the pipeline's result allows them, so main passes the report on as it is;
 * the page shows them as text.
 */
const tableName = z.string().min(1).max(64);
const fileName = z.string().min(1).max(64);

/** Why a table of the old file isn't copied. */
export const importSkipReasons = ["synced", "bookkeeping", "not-ported"] as const;

/**
 * What a dry run or an import found. The same field names as the pipeline's `import.legacy`
 * result (C1b), so main passes it on as it is.
 */
export const importReportSchema = z.strictObject({
  /** The old file that was read. */
  source: localPath,
  /** Each table that is copied: rows in the old file, rows to add, rows the new app already has. */
  tables: z
    .array(z.strictObject({ name: tableName, inOld: rows, toAdd: rows, already: rows }))
    .max(50),
  /** Tables left out: the sync brings them, old bookkeeping, or not ported. */
  skipped: z
    .array(z.strictObject({ name: tableName, rows, why: z.enum(importSkipReasons) }))
    .max(100),
  /** Old work never sent to the server: it doesn't move, so the owner sends it from the old app. */
  unsent: z.strictObject({ outbox: rows, activity: rows }),
  /** The old settings files looked for beside the database. */
  settingsFiles: z.array(z.strictObject({ name: fileName, found: z.boolean() })).max(20),
  dryRun: z.boolean(),
  /** The copy of `pipeline.db` made before a real import; null on a dry run or a first import. */
  backup: localPath.nullable(),
});
export type ImportReport = z.output<typeof importReportSchema>;

/**
 * Why an import (or its dry run) didn't happen. `not_built` is the step 4 stub's answer until the
 * import service is wired.
 */
export const importProblems = [
  "not_built",
  /** Example data is open: the import writes only the live pipeline folder. */
  "example_data",
  /** Signed out or waiting: no data is open. */
  "no_data",
  "not_found",
  /** The path is inside the new app's own data folder. */
  "own_data",
  /** On a network share or a mapped drive: the owner copies the file to this computer first. */
  "network_path",
  /** The old app is open, or left an unfinished `-wal` file: open and close it once. */
  "old_app_open",
  "not_sqlite",
  /** A SQLite file, but not the old app's: it has no `channels` table. */
  "no_channels",
  /** An import or a search is running. */
  "running",
  "no_python",
  "failed",
] as const;

/**
 * Steps after a successful import that didn't work out. The data is in either way, so the result
 * stays a success and names them: the `find.json` copy beside the backup, the local channel names,
 * the old search rules (skipped when the `find.json` copy failed, so no rules are lost), and the
 * `import` setting.
 */
export const importWarnings = [
  "find_backup",
  "channel_names",
  "old_rules",
  "import_state",
] as const;

export const importResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    report: importReportSchema,
    warnings: z.array(z.enum(importWarnings)).max(importWarnings.length).optional(),
  }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(importProblems) }),
]);
export type ImportResult = z.output<typeof importResultSchema>;

/** The old databases main found on its own, newest first. */
export const importCandidatesSchema = z.strictObject({
  candidates: z
    .array(
      z.strictObject({
        path: localPath,
        modifiedAt: isoTime,
        size: z.number().int().min(0).max(1_000_000_000_000),
      }),
    )
    .max(20),
});
export type ImportCandidates = z.output<typeof importCandidatesSchema>;

/** What a file or folder dialog answers: null when the owner cancelled. */
export const pickedPathSchema = z.strictObject({ path: localPath.nullable() });
export type PickedPath = z.output<typeof pickedPathSchema>;

export const importDryRunRequestSchema = z.strictObject({ path: localPath });
export const importRunRequestSchema = z.strictObject({
  path: localPath,
  /** "Use my old search rules": map the old `run_config.json` and `settings.json` into Find's rules. */
  useOldRules: z.boolean(),
});

/** One line per table while the job copies (or counts) it. */
export const importProgressSchema = z.strictObject({
  table: tableName,
  /** Tables finished so far, out of `total`. */
  done: z.number().int().min(0).max(50),
  total: z.number().int().min(0).max(50),
});
