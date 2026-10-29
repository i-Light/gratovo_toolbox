import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isOwner as holdsOwner, scenarios } from "@gratovo/core/data";
import type { DataSource, Scenario } from "@gratovo/core/data";
import type { PrototypeStatus } from "@gratovo/ipc";

import type { Account } from "../account/account";
import { openExampleCopy } from "../data";
import { getMeta, setMeta } from "../data/repositories";

import { createCommentStore, type CommentStore } from "./comments";
import { kindOf } from "./kind-of";

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
  /**
   * Stops what must not run across a switch: a search, a job on the pipeline lane. Called inside
   * the switch's queue once the switch will be tried (after the owner check), and right before the
   * swap, so nothing started meanwhile carries on into the other data. A rejection stops the switch.
   */
  beforeSwitch: () => Promise<void>;
  /** Removes a folder and everything in it (tests give one that fails). */
  removeFolder?: (path: string) => Promise<void>;
  /** Opens a fresh example copy (tests give one that fails). */
  openCopy?: typeof openExampleCopy;
  /**
   * Fills a fresh copy with the example history (plan P8a, A7): awaited after the copy opens (a
   * turn-on or a scenario pick) and before the windows reload. It must not throw or start a
   * search; a rejection is logged and prototype mode opens anyway.
   */
  loadHistory?: (o: { db: DatabaseSync; scenario: Scenario; folder: string }) => Promise<void>;
}

export interface Prototype {
  status(): Promise<PrototypeStatus>;
  set(on: boolean): Promise<PrototypeStatus>;
  setScenario(scenario: Scenario): Promise<PrototypeStatus>;
  isOn(): boolean;
  /** The prototype copy while on, else null. */
  source(): DataSource | null;
  readonly comments: CommentStore;
  close(): void;
}

type Copy = { source: DataSource; db: DatabaseSync };

export const prototypeFile = "prototype.db";
export const prototypeFolder = "prototype-pipeline";
/** The `_meta` key of the scenario prototype mode last used. */
export const scenarioKey = "prototype_scenario";

function toScenario(value: unknown): Scenario {
  return scenarios.find((scenario) => scenario === value) ?? "normal";
}

export function createPrototype(deps: PrototypeDeps): Prototype {
  const file = join(deps.userData, prototypeFile);
  const folder = join(deps.userData, prototypeFolder);

  // The copy is opened with `openExampleCopy`, which hands back the source and the one database
  // handle it uses. The comments and `_meta` go through that same handle: no second connection to
  // keep in step, and closing the source closes everything.
  let copy: Copy | null = null;
  /** The open copy's scenario; while off, the one last opened (null: none yet). */
  let scenario: Scenario | null = null;
  /** Set by `close` (the app quits): no switch opens a copy after it. */
  let closed = false;
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

  const removeFolder =
    deps.removeFolder ??
    ((path: string) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  /** Empties the prototype's pipeline folder: that one folder, nothing else. */
  async function emptyFolder(path: string): Promise<void> {
    if (path !== join(deps.userData, prototypeFolder)) {
      throw new Error("Only the prototype pipeline folder may be emptied");
    }
    await removeFolder(path);
    await mkdir(path, { recursive: true });
  }

  /** A fresh copy of `next`, with `next` stored as the scenario. */
  function openFresh(next: Scenario): Copy {
    const opened = (deps.openCopy ?? openExampleCopy)(file, deps.now, {
      fresh: true,
      scenario: next,
    });
    try {
      setMeta(opened.db, scenarioKey, next);
    } catch (error) {
      opened.source.close();
      throw error;
    }
    return opened;
  }

  /**
   * Closes the open copy and opens `next` in its place (or nothing: off), in one synchronous step,
   * so nothing ever sees prototype mode off part-way. If `next` won't open, the previous scenario
   * opens again (its stored scenario unchanged); if even that fails, prototype mode is off.
   */
  function swap(next: Scenario | null): void {
    const previous = copy;
    const previousScenario = scenario;
    copy = null;
    previous?.source.close();
    if (next === null) {
      return;
    }
    try {
      copy = openFresh(next);
      scenario = next;
    } catch (error) {
      console.warn(`The prototype copy could not be opened (${kindOf(error)}).`);
      if (previous !== null && previousScenario !== null) {
        try {
          copy = openFresh(previousScenario);
        } catch (again) {
          console.warn(`Prototype mode turned off: no copy would open (${kindOf(again)}).`);
        }
      }
      throw error;
    }
  }

  /**
   * Moves to a fresh copy of `next`, or off (null). The waiting comes first with the open copy left
   * as it is (the switch is never half done while it waits), then the swap. The windows reload at
   * the end, whether it worked or not, so the page and the source watch match what is open.
   */
  async function switchTo(next: Scenario | null): Promise<void> {
    try {
      if (next !== null) {
        if (copy !== null) {
          // A search in the prototype's folder ends before the folder is emptied.
          await deps.beforeSwitch();
        }
        await emptyFolder(folder);
      }
      // Anything that started while this waited ends too.
      await deps.beforeSwitch();
      if (closed) {
        return;
      }
      swap(next);
      if (next !== null && copy !== null && deps.loadHistory !== undefined) {
        try {
          await deps.loadHistory({ db: copy.db, scenario: next, folder });
        } catch (error) {
          console.warn(`Prototype: the example history could not be loaded (${kindOf(error)}).`);
        }
      }
    } finally {
      deps.reloadWindow();
    }
  }

  function shut(): void {
    closed = true;
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

  const comments = createCommentStore({
    db,
    now: deps.now,
    scenario: () => toScenario(getMeta(db(), scenarioKey)),
  });

  return {
    status,
    set(on) {
      return serial(async () => {
        if (on === (copy !== null)) {
          return status();
        }
        if (on && !(await isOwner())) {
          throw new Error("prototype mode is for the owner");
        }
        await switchTo(on ? storedScenario() : null);
        return status();
      });
    },
    setScenario(next) {
      return serial(async () => {
        db();
        if (!scenarios.includes(next)) {
          throw new Error("There is no such scenario");
        }
        await switchTo(next);
        return status();
      });
    },
    isOn: () => copy !== null,
    source: () => copy?.source ?? null,
    comments,
    close: shut,
  };
}
