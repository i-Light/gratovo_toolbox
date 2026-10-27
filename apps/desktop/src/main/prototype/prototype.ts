import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isOwner as holdsOwner, scenarios } from "@gratovo/core/data";
import type { DataSource, Scenario } from "@gratovo/core/data";
import { commentNewSchema, commentSchema, commentsExportPath, commentsMax } from "@gratovo/ipc";
import type {
  Comment,
  CommentNew,
  CommentPatch,
  CommentsExportResult,
  PrototypeStatus,
} from "@gratovo/ipc";

import type { Account } from "../account/account";
import { openExampleCopy } from "../data";
import { getMeta, setMeta } from "../data/repositories";

import {
  countComments,
  deleteComment,
  getComment,
  insertComment,
  listComments,
  newCommentId,
  updateComment,
} from "./comments";

/**
 * Prototype mode (ADR 0004, step 7): the real app on a fresh example copy, `prototype.db`, for the
 * owner only. It is off at every start (D10); the scenario it last used is kept in that copy's
 * `_meta`. The owner's comments live in the same copy (D7) and are exported for Claude on demand.
 */

export interface PrototypeDeps {
  userData: string;
  now: () => number;
  /** The base account (unwrapped): its source decides who is the owner. */
  base: Pick<Account, "source">;
  /** Reloads the windows after the answer; the caller also runs the source watch. */
  reloadWindow: () => void;
}

export interface Prototype {
  status(): Promise<PrototypeStatus>;
  set(on: boolean): Promise<PrototypeStatus>;
  setScenario(scenario: Scenario): Promise<PrototypeStatus>;
  isOn(): boolean;
  /** The prototype copy while on, else null. */
  source(): DataSource | null;
  readonly comments: {
    list(): Comment[];
    add(c: CommentNew): Comment;
    update(p: CommentPatch): Comment;
    remove(id: string): Comment | null;
    restore(c: Comment): Comment;
    exportTo(repoRoot: string | null): CommentsExportResult;
  };
  close(): void;
}

export const prototypeFile = "prototype.db";
export const prototypeFolder = "prototype-pipeline";
/** The `_meta` key of the scenario prototype mode last used. */
export const scenarioKey = "prototype_scenario";

function toScenario(value: unknown): Scenario {
  return scenarios.find((scenario) => scenario === value) ?? "normal";
}

/** An error's kind for the log: its code or its name, never its message (it may hold a path). */
function kindOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : error.name;
  }
  return typeof error;
}

/** One comment as the export file lists it. */
export type ExportedComment = { readonly number: number; readonly where: string } & Comment;

/** Where a comment was left, from its place's keys: "everywhere", or "reach › board › …". */
function whereOf(comment: Comment): string {
  const { place } = comment;
  if (place.global) {
    return "everywhere";
  }
  const parts: string[] = [];
  if (place.screen !== null) parts.push(place.screen);
  if (place.tab !== null) parts.push(place.tab);
  if (place.record !== null) parts.push(`record ${place.record.kind}:${place.record.id}`);
  if (place.peek !== null) parts.push(`peek ${place.peek.kind}:${place.peek.id}`);
  return parts.length === 0 ? "everywhere" : parts.join(" › ");
}

/**
 * The export's counts and comments (D8): each numbered by its place in the oldest-first list (as
 * the pins show), open ones first, then done, each oldest first.
 */
export function commentsForExport(list: readonly Comment[]): {
  open: number;
  done: number;
  comments: ExportedComment[];
} {
  const oldestFirst = [...list].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const numbered = oldestFirst.map((comment, index): ExportedComment => ({
    number: index + 1,
    where: whereOf(comment),
    ...comment,
  }));
  const open = numbered.filter((comment) => comment.status === "open");
  const done = numbered.filter((comment) => comment.status === "done");
  return { open: open.length, done: done.length, comments: [...open, ...done] };
}

/**
 * The repository's root while the app runs from it (`pnpm dev`), else null. Modelled on
 * `findExtensionDir`: a packaged app has no repository, and `appPath` is `apps/desktop`, two
 * levels below the root. It counts only if `pnpm-workspace.yaml` and `docs` are there.
 */
export function findRepoRoot(o: {
  packaged: boolean;
  appPath: string;
  exists: (p: string) => boolean;
}): string | null {
  if (o.packaged) {
    return null;
  }
  const root = resolve(o.appPath, "..", "..");
  return o.exists(join(root, "pnpm-workspace.yaml")) && o.exists(join(root, "docs")) ? root : null;
}

export function createPrototype(deps: PrototypeDeps): Prototype {
  const file = join(deps.userData, prototypeFile);
  const folder = join(deps.userData, prototypeFolder);

  // The copy is opened with `openExampleCopy`, which hands back the source and the one database
  // handle it uses. The comments and `_meta` go through that same handle: no second connection to
  // keep in step, and closing the source closes everything.
  let copy: { source: DataSource; db: DatabaseSync } | null = null;
  let scenario: Scenario | null = null;
  // Turns and scenario picks run one at a time, so two quick clicks can't open two copies.
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  /** The stored scenario. While off it reads the file read-only, and never creates it. */
  function storedScenario(): Scenario {
    if (copy !== null) {
      return toScenario(getMeta(copy.db, scenarioKey));
    }
    if (scenario !== null) {
      return scenario;
    }
    if (!existsSync(file)) {
      return "normal";
    }
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      return toScenario(getMeta(db, scenarioKey));
    } catch (error) {
      console.warn(`The prototype scenario could not be read (${kindOf(error)}).`);
      return "normal";
    } finally {
      db?.close();
    }
  }

  async function isOwner(): Promise<boolean> {
    const base = deps.base.source();
    if (base === null) {
      return false;
    }
    try {
      const frame = await base.frame();
      const me = frame.team.find((member) => member.id === frame.me);
      return me !== undefined && holdsOwner(me);
    } catch (error) {
      console.warn(`The owner check could not read the frame (${kindOf(error)}).`);
      return false;
    }
  }

  /** Empties the prototype's pipeline folder: that one folder, nothing else. */
  async function emptyFolder(path: string): Promise<void> {
    if (path !== join(deps.userData, prototypeFolder)) {
      throw new Error("Only the prototype pipeline folder may be emptied");
    }
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await mkdir(path, { recursive: true });
  }

  async function open(next: Scenario): Promise<void> {
    await emptyFolder(folder);
    copy = openExampleCopy(file, deps.now, { fresh: true, scenario: next });
    scenario = next;
  }

  function shut(): void {
    const open = copy;
    copy = null;
    open?.source.close();
  }

  async function status(): Promise<PrototypeStatus> {
    const on = copy !== null;
    return { available: on || (await isOwner()), on, scenario: storedScenario() };
  }

  /** The open copy's database, or throws: every comment call needs prototype mode on. */
  function db(): DatabaseSync {
    if (copy === null) {
      throw new Error("prototype mode is off");
    }
    return copy.db;
  }

  function current(): Scenario {
    return toScenario(getMeta(db(), scenarioKey));
  }

  function refuseAtMax(handle: DatabaseSync): void {
    if (countComments(handle) >= commentsMax) {
      throw new Error(`prototype mode keeps at most ${String(commentsMax)} comments`);
    }
  }

  const comments: Prototype["comments"] = {
    list() {
      return listComments(db());
    },
    add(input) {
      const handle = db();
      const valid = commentNewSchema.parse(input);
      refuseAtMax(handle);
      const at = deps.now();
      const comment: Comment = {
        id: newCommentId(at),
        at,
        status: "open",
        doneAt: null,
        kind: valid.kind,
        text: valid.text,
        scenario: current(),
        place: valid.place,
        anchor: valid.anchor,
      };
      insertComment(handle, comment, at);
      return comment;
    },
    update(patch) {
      const handle = db();
      const existing = getComment(handle, patch.id);
      if (existing === null) {
        throw new Error("There is no comment with that id");
      }
      const now = deps.now();
      const status = patch.status ?? existing.status;
      const text = patch.text === undefined ? existing.text : patch.text.trim();
      if (text === "") {
        throw new Error("A comment needs some text");
      }
      // Done again keeps the time it was first marked done; open clears it.
      const doneAt = status === "open" ? null : existing.status === "done" ? existing.doneAt : now;
      const next: Comment = { ...existing, text, status, doneAt };
      updateComment(handle, next, now);
      return next;
    },
    remove(id) {
      const handle = db();
      const existing = getComment(handle, id);
      // A row that doesn't read back still goes, so the list and the table agree.
      deleteComment(handle, id);
      return existing;
    },
    restore(input) {
      const handle = db();
      const comment = commentSchema.parse(input);
      const existing = getComment(handle, comment.id);
      if (existing !== null) {
        return existing;
      }
      refuseAtMax(handle);
      insertComment(handle, comment, deps.now());
      return comment;
    },
    exportTo(repoRoot) {
      const handle = db();
      if (repoRoot === null) {
        return { ok: false, problem: "no_repo" };
      }
      let temp: string | null = null;
      try {
        const list = listComments(handle);
        const dir = join(repoRoot, "docs", "feedback");
        mkdirSync(dir, { recursive: true });
        const body = {
          exportedAt: new Date(deps.now()).toISOString(),
          ...commentsForExport(list),
        };
        temp = join(dir, `.comments-${randomBytes(6).toString("hex")}.tmp`);
        writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
        renameSync(temp, join(dir, "comments.json"));
        temp = null;
        return { ok: true, path: commentsExportPath, count: list.length };
      } catch (error) {
        console.warn(`The comments could not be exported (${kindOf(error)}).`);
        if (temp !== null) {
          rmSync(temp, { force: true });
        }
        return { ok: false, problem: "failed" };
      }
    },
  };

  return {
    status,
    set(on) {
      return serial(async () => {
        if (on === (copy !== null)) {
          return status();
        }
        if (on) {
          if (!(await isOwner())) {
            throw new Error("prototype mode is for the owner");
          }
          await open(storedScenario());
        } else {
          shut();
        }
        deps.reloadWindow();
        return status();
      });
    },
    setScenario(next) {
      return serial(async () => {
        const handle = db();
        if (!scenarios.includes(next)) {
          throw new Error("There is no such scenario");
        }
        setMeta(handle, scenarioKey, next);
        shut();
        await open(next);
        deps.reloadWindow();
        return status();
      });
    },
    isOn: () => copy !== null,
    source: () => copy?.source ?? null,
    comments,
    close: shut,
  };
}
