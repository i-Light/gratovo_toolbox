import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AppEventPayload, ImportCandidates, ImportResult, PickedPath } from "@gratovo/ipc";

import { findFileName, readFindFile, rulesFromOldFiles, writeFindFile } from "../find/find-store";
import type { JobOutcome } from "../pipeline/jobs";
import {
  protocolVersion,
  type EndErrorCode,
  type ImportReport,
  type Start,
} from "../pipeline/protocol";
import type { ImporterService } from "../services";

/**
 * Importing the old app's `gratovo.db` (plan step 4, D2 to D6). Main checks the path, runs the
 * pipeline's `import.legacy` job in the store lane, then records the import, copies `find.json`
 * beside the backup, seeds the local channel names and (if asked) maps the old search rules. The
 * job has committed by then, so a step after it that fails is a warning on a successful result.
 */

/** How a store-lane job ended, as this service needs it. */
export type StoreJobOutcome =
  | {
      ok: true;
      state: "done" | "stopped" | "failed";
      code: EndErrorCode | null;
      report: ImportReport | null;
    }
  | { ok: false; problem: "running" | "no_python" };

/** For the wiring: turns what `runJob` resolves with into a `StoreJobOutcome`. */
export function storeOutcomeOf(outcome: JobOutcome): StoreJobOutcome {
  if (!outcome.ok) {
    return outcome;
  }
  const exit = outcome.exit;
  if (exit.kind !== "ended") {
    return { ok: true, state: "failed", code: "crash", report: null };
  }
  const result = exit.result;
  return {
    ok: true,
    state: exit.end.state,
    code: exit.end.error?.code ?? null,
    report: result !== null && result.kind === "import.legacy" ? result.data : null,
  };
}

export interface ImportFs {
  stat(path: string): Stats | null;
  exists(path: string): boolean;
  copyFile(from: string, to: string): void;
  mkdir(path: string): void;
  readJson(path: string): unknown;
  /** The real path (links, junctions and 8.3 short names resolved); null when it can't be. */
  realpath(path: string): string | null;
}

export const realImportFs: ImportFs = {
  stat(path) {
    try {
      return statSync(path);
    } catch {
      return null;
    }
  },
  exists: (path) => existsSync(path),
  copyFile: (from, to) => {
    copyFileSync(from, to);
  },
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
  realpath(path) {
    try {
      return realpathSync.native(path);
    } catch {
      return null;
    }
  },
};

export interface ImporterDeps {
  userDataDir: string;
  /** `process.env.LOCALAPPDATA`, or null. */
  localAppData: string | null;
  isLive(): boolean;
  /** The open live source's pipeline folder; null when none is open. */
  pipelineDataDir(): string | null;
  /** The worker id the start message carries. */
  worker(): string;
  /** Runs a start message in the store lane; `onProgress` sees each `progress` line. */
  runStoreJob(
    start: Start,
    onProgress: (line: { table: string; done: number; total: number }) => void,
  ): Promise<StoreJobOutcome>;
  pickFile(): Promise<string | null>;
  fs?: ImportFs;
  /** Gives the local channel names to the data source; returns how many were new. */
  seedChannelNames(rows: { channelId: string; name: string }[]): number;
  writeSetting(key: string, value: unknown): void;
  /** Defaults to `readPipelineChannels`. */
  readPipelineChannels?(dataDir: string): { channelId: string; name: string }[];
  emitProgress(event: AppEventPayload<"import:progress">): void;
  now(): Date;
}

/** `channel_id, name` from `<dataDir>/pipeline.db`, opened read-only. Empty when it can't be read. */
export function readPipelineChannels(dataDir: string): { channelId: string; name: string }[] {
  const file = join(dataDir, "pipeline.db");
  if (!existsSync(file)) {
    return [];
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT channel_id, name FROM channels").all();
    const out: { channelId: string; name: string }[] = [];
    for (const row of rows) {
      const id = row["channel_id"];
      const name = row["name"];
      if (typeof id === "string" && id !== "" && typeof name === "string" && name !== "") {
        out.push({ channelId: id, name });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

type Reason = Extract<ImportResult, { ok: false }>["reason"];
type Warning = NonNullable<Extract<ImportResult, { ok: true }>["warnings"]>[number];

const reasonOfCode: Partial<Record<EndErrorCode, Reason>> = {
  source_unreadable: "not_found",
  not_sqlite: "not_sqlite",
  no_channels_table: "no_channels",
  source_in_data_dir: "own_data",
  old_app_open: "old_app_open",
};

function clamp(n: number, max: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.trunc(n))) : 0;
}

function sameOrInside(folder: string, path: string): boolean {
  const fold = (p: string): string =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  const rel = relative(fold(folder), fold(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** `\\?\...` and `\\.\...`: Win32 namespace paths, which skip the usual path rules. */
function isNamespacePath(path: string): boolean {
  return /^[\\/]{2}[?.][\\/]/.test(path);
}

/** `\\server\share\...` (or `\\?\UNC\...`): a network share, which SQLite can't open here. */
function isNetworkPath(path: string): boolean {
  return /^[\\/]{2}[?.][\\/]unc[\\/]/i.test(path) || /^[\\/]{2}[^\\/?.]/.test(path);
}

function stampOf(backup: string): string {
  const base = basename(backup, extname(backup));
  const stamp = base.replace(/^pipeline[-_.]?/, "");
  return stamp === "" ? base : stamp;
}

export function createImporter(deps: ImporterDeps): ImporterService {
  const fs = deps.fs ?? realImportFs;
  let busy = false;

  const fail = (reason: Reason): ImportResult => ({ ok: false, reason });

  /**
   * The checks before any job. Answers the real path (links, junctions and 8.3 short names
   * resolved), which is what the job gets, so the file checked is the file read.
   */
  function check(
    path: string,
  ): { ok: true; dataDir: string; source: string } | { ok: false; result: ImportResult } {
    if (!deps.isLive()) {
      return { ok: false, result: fail("example_data") };
    }
    const dataDir = deps.pipelineDataDir();
    if (dataDir === null) {
      return { ok: false, result: fail("no_data") };
    }
    if (isNetworkPath(path)) {
      return { ok: false, result: fail("network_path") };
    }
    if (!isAbsolute(path) || isNamespacePath(path)) {
      return { ok: false, result: fail("not_found") };
    }
    if (sameOrInside(deps.userDataDir, path)) {
      return { ok: false, result: fail("own_data") };
    }
    const source = fs.realpath(path);
    if (source === null || isNamespacePath(source)) {
      return { ok: false, result: fail("not_found") };
    }
    if (isNetworkPath(source)) {
      return { ok: false, result: fail("network_path") }; // a mapped drive
    }
    if (sameOrInside(fs.realpath(deps.userDataDir) ?? deps.userDataDir, source)) {
      return { ok: false, result: fail("own_data") };
    }
    return { ok: true, dataDir, source };
  }

  function startOf(
    dataDir: string,
    job: { source: string; dryRun: boolean; backupDir: string | null },
  ): Start {
    return {
      type: "start",
      protocol: protocolVersion,
      source: "live",
      dataDir,
      worker: deps.worker(),
      job: { kind: "import.legacy", ...job },
      settings: {},
      secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
    };
  }

  async function runImportJob(
    path: string,
    dataDir: string,
    dryRun: boolean,
    backupDir: string | null,
  ): Promise<{ ok: true; report: ImportReport } | { ok: false; result: ImportResult }> {
    const outcome = await deps.runStoreJob(
      startOf(dataDir, { source: path, dryRun, backupDir }),
      (line) => {
        deps.emitProgress({
          table: line.table.slice(0, 64) || "table",
          done: clamp(line.done, 50),
          total: clamp(line.total, 50),
        });
      },
    );
    if (!outcome.ok) {
      return { ok: false, result: fail(outcome.problem) };
    }
    if (outcome.state !== "done" || outcome.report === null) {
      const reason = (outcome.code !== null ? reasonOfCode[outcome.code] : undefined) ?? "failed";
      return { ok: false, result: fail(reason) };
    }
    return { ok: true, report: outcome.report };
  }

  async function guarded(work: () => Promise<ImportResult>): Promise<ImportResult> {
    if (busy) {
      return fail("running");
    }
    busy = true;
    try {
      return await work();
    } catch (error) {
      console.error("Import failed:", error instanceof Error ? error.message : "unexpected error");
      return fail("failed");
    } finally {
      busy = false;
    }
  }

  function applyOldRules(path: string, dataDir: string): void {
    const oldDir = dirname(dirname(path));
    const read = (name: string): unknown => {
      try {
        return fs.readJson(join(oldDir, name));
      } catch {
        return null;
      }
    };
    const file = readFindFile(dataDir);
    const rules = rulesFromOldFiles(read("run_config.json"), read("settings.json"), file.rules);
    writeFindFile(dataDir, { ...file, rules });
  }

  return {
    candidates(): Promise<ImportCandidates> {
      const candidates: ImportCandidates["candidates"] = [];
      if (deps.localAppData !== null && deps.localAppData !== "") {
        const file = join(
          deps.localAppData,
          "Gratovo IMA ToolBox",
          "data",
          "database",
          "gratovo.db",
        );
        const stat = fs.stat(file);
        if (stat !== null && stat.isFile()) {
          candidates.push({ path: file, modifiedAt: stat.mtime.toISOString(), size: stat.size });
        }
      }
      return Promise.resolve({ candidates });
    },

    async pick(): Promise<PickedPath> {
      return { path: await deps.pickFile() };
    },

    dryRun(path) {
      return guarded(async () => {
        const checked = check(path);
        if (!checked.ok) {
          return checked.result;
        }
        const done = await runImportJob(checked.source, checked.dataDir, true, null);
        return done.ok ? { ok: true, report: done.report } : done.result;
      });
    },

    run(path, useOldRules) {
      return guarded(async () => {
        const checked = check(path);
        if (!checked.ok) {
          return checked.result;
        }
        const { dataDir, source } = checked;
        const backupDir = join(deps.userDataDir, "backups");
        fs.mkdir(backupDir);
        const done = await runImportJob(source, dataDir, false, backupDir);
        if (!done.ok) {
          return done.result;
        }
        // The job has committed: from here a step that fails is a warning, not a failure.
        const { report } = done;
        const warnings: Warning[] = [];
        const step = (name: Warning, work: () => void): boolean => {
          try {
            work();
            return true;
          } catch (error) {
            // The error's kind only: a message can carry a path.
            console.warn(
              `Import: the ${name} step failed:`,
              error instanceof Error ? error.name : "unexpected error",
            );
            warnings.push(name);
            return false;
          }
        };
        step("import_state", () => {
          const counts: Record<string, number> = {};
          for (const table of report.tables) {
            counts[table.name] = table.toAdd;
          }
          deps.writeSetting("import", {
            at: deps.now().toISOString(),
            source,
            counts,
            backup: report.backup,
          });
        });
        const findSaved = step("find_backup", () => {
          const findFile = join(dataDir, findFileName);
          if (report.backup !== null && fs.exists(findFile)) {
            fs.copyFile(
              findFile,
              join(dirname(report.backup), `find-${stampOf(report.backup)}.json`),
            );
          }
        });
        step("channel_names", () => {
          deps.seedChannelNames((deps.readPipelineChannels ?? readPipelineChannels)(dataDir));
        });
        if (useOldRules) {
          if (findSaved) {
            step("old_rules", () => {
              applyOldRules(source, dataDir);
            });
          } else {
            // Without the copy of find.json, mapping the old rules would lose the current ones.
            warnings.push("old_rules");
          }
        }
        return warnings.length > 0 ? { ok: true, report, warnings } : { ok: true, report };
      });
    },
  };
}
