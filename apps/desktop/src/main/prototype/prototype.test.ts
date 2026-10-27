import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exampleSeed } from "@gratovo/core/data";
import type { DataSource } from "@gratovo/core/data";
import { commentsMax } from "@gratovo/ipc";
import type { Comment, CommentNew } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/open-database";

import { insertComment, newCommentId } from "./comments";
import {
  commentsForExport,
  createPrototype,
  findRepoRoot,
  prototypeFile,
  prototypeFolder,
} from "./prototype";
import type { Prototype } from "./prototype";

const start = Date.UTC(2026, 9, 26, 9, 0, 0);

function baseWith(roles: readonly string[] | null): { source: () => DataSource | null } {
  if (roles === null) {
    return { source: () => null };
  }
  const fake = {
    frame: () =>
      Promise.resolve({
        me: "me",
        team: [
          { id: "mate", roles: ["owner"] },
          { id: "me", roles },
        ],
      }),
  };
  return { source: () => fake as unknown as DataSource };
}

const note: CommentNew = {
  kind: "fix",
  text: "  The board needs a hint  ",
  place: { global: false, screen: "reach", tab: "board", record: null, peek: null },
  anchor: {
    ui: "reach.board",
    path: "div:nth-of-type(1)",
    tag: "div",
    text: "Board",
    label: "Board",
    rx: 0.5,
    ry: 0.5,
  },
};

describe("prototype mode", () => {
  let folder: string;
  let clock: number;
  let reload: ReturnType<typeof vi.fn<() => void>>;
  const made: Prototype[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-prototype-"));
    clock = start;
    reload = vi.fn<() => void>();
  });

  afterEach(async () => {
    for (const proto of made.splice(0)) {
      proto.close();
    }
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function make(roles: readonly string[] | null = ["owner"]): Prototype {
    const proto = createPrototype({
      userData: folder,
      now: () => clock,
      base: baseWith(roles),
      reloadWindow: reload,
    });
    made.push(proto);
    return proto;
  }

  it("starts off, and says so without creating prototype.db", async () => {
    const proto = make();
    expect(proto.isOn()).toBe(false);
    expect(proto.source()).toBeNull();
    expect(await proto.status()).toEqual({ available: true, on: false, scenario: "normal" });
    expect(existsSync(join(folder, prototypeFile))).toBe(false);
  });

  it("is not available to a non-owner, and refuses to turn on", async () => {
    const proto = make(["scout"]);
    expect((await proto.status()).available).toBe(false);
    await expect(proto.set(true)).rejects.toThrow("prototype mode is for the owner");
    expect(proto.isOn()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to turn on with no base source", async () => {
    const proto = make(null);
    await expect(proto.set(true)).rejects.toThrow("prototype mode is for the owner");
    expect(existsSync(join(folder, prototypeFile))).toBe(false);
  });

  it("turns on for the owner: a fresh copy, an empty pipeline folder, one reload", async () => {
    const pipeline = join(folder, prototypeFolder);
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, "left-over.json"), "{}");
    const proto = make();

    expect(await proto.set(true)).toEqual({ available: true, on: true, scenario: "normal" });
    expect(proto.isOn()).toBe(true);
    expect(proto.source()).not.toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readdirSync(pipeline)).toEqual([]);
    expect((await proto.source()?.frame())?.source).toBe("example");

    // Setting the state it already has does nothing.
    await proto.set(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect((await proto.set(false)).on).toBe(false);
    expect(proto.source()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(2);
    await proto.set(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("refuses every comment call while off", async () => {
    const proto = make();
    const off = "prototype mode is off";
    expect(() => proto.comments.list()).toThrow(off);
    expect(() => proto.comments.add(note)).toThrow(off);
    expect(() => proto.comments.update({ id: "caaaaaa1", text: "x" })).toThrow(off);
    expect(() => proto.comments.remove("caaaaaa1")).toThrow(off);
    expect(() => proto.comments.exportTo(folder)).toThrow(off);
    await expect(proto.setScenario("broke")).rejects.toThrow(off);
  });

  it("adds, edits, marks done, reopens, deletes and restores a comment", async () => {
    const proto = make();
    await proto.set(true);

    const added = proto.comments.add(note);
    expect(added).toMatchObject({
      at: start,
      status: "open",
      doneAt: null,
      text: "The board needs a hint",
      scenario: "normal",
    });
    expect(added.id).toMatch(/^c[a-z0-9]{6,24}$/);
    expect(proto.comments.list()).toEqual([added]);

    clock = start + 1000;
    const edited = proto.comments.update({ id: added.id, text: "A clearer hint" });
    expect(edited).toEqual({ ...added, text: "A clearer hint" });

    clock = start + 2000;
    const done = proto.comments.update({ id: added.id, status: "done" });
    expect(done).toMatchObject({ status: "done", doneAt: start + 2000 });

    const reopened = proto.comments.update({ id: added.id, status: "open" });
    expect(reopened).toMatchObject({ status: "open", doneAt: null });

    expect(() => proto.comments.update({ id: "cnothere1", text: "x" })).toThrow();

    const removed = proto.comments.remove(added.id);
    expect(removed).toEqual(reopened);
    expect(proto.comments.remove(added.id)).toBeNull();
    expect(proto.comments.list()).toEqual([]);

    expect(proto.comments.restore(reopened)).toEqual(reopened);
    expect(proto.comments.list()).toEqual([reopened]);
    // Restoring one that is already there gives back the stored one.
    expect(proto.comments.restore({ ...reopened, text: "other" })).toEqual(reopened);
  });

  it("refuses an add and a restore at the most comments", async () => {
    const proto = make();
    await proto.set(true);
    proto.close();
    const db = openDatabase(join(folder, prototypeFile));
    db.exec("BEGIN");
    for (let i = 0; i < commentsMax; i += 1) {
      const comment: Comment = {
        id: `c${String(i).padStart(8, "0")}`,
        at: start + i,
        status: "open",
        doneAt: null,
        kind: note.kind,
        text: "x",
        scenario: "normal",
        place: note.place,
        anchor: note.anchor,
      };
      insertComment(db, comment, start);
    }
    db.exec("COMMIT");
    db.close();

    const again = make();
    await again.set(true);
    expect(again.comments.list()).toHaveLength(commentsMax);
    expect(() => again.comments.add(note)).toThrow(String(commentsMax));
    const extra: Comment = {
      id: newCommentId(start),
      at: start,
      status: "open",
      doneAt: null,
      scenario: "normal",
      ...note,
      text: "x",
    };
    expect(() => again.comments.restore(extra)).toThrow(String(commentsMax));
  });

  it("keeps the scenario across a new start, and the comments across picks and turns", async () => {
    const proto = make();
    await proto.set(true);
    const first = proto.comments.add(note);
    await proto.source()?.write([{ kind: "me.name", name: "Ada" }]);

    const status = await proto.setScenario("broke");
    expect(status).toEqual({ available: true, on: true, scenario: "broke" });
    expect(reload).toHaveBeenCalledTimes(2);
    // A fresh seed: the name is gone, the alerts are there, the comment stays.
    const frame = await proto.source()?.frame();
    expect(frame?.myName).toBeNull();
    expect(frame?.notifications).toHaveLength(exampleSeed(start, "broke").notifications.length);
    expect(proto.comments.list()).toEqual([first]);
    expect(proto.comments.add(note).scenario).toBe("broke");

    await proto.set(false);
    expect((await proto.status()).scenario).toBe("broke");
    await proto.set(true);
    expect(proto.comments.list()).toHaveLength(2);
    proto.close();

    const next = make();
    expect(await next.status()).toEqual({ available: true, on: false, scenario: "broke" });
    await next.set(true);
    expect((await next.status()).scenario).toBe("broke");
    expect((await next.source()?.frame())?.notifications).toHaveLength(
      exampleSeed(start, "broke").notifications.length,
    );
    expect(next.comments.list()).toHaveLength(2);
  });

  it("exports the comments for Claude, open first, numbered oldest first", async () => {
    const proto = make();
    await proto.set(true);
    const a = proto.comments.add(note);
    clock = start + 1000;
    const b = proto.comments.add({ ...note, kind: "idea", place: { ...note.place, global: true } });
    clock = start + 2000;
    const c = proto.comments.add({
      ...note,
      kind: "question",
      place: {
        global: false,
        screen: "find",
        tab: null,
        record: { kind: "creator", id: "UC1" },
        peek: { kind: "brand", id: "b1" },
      },
    });
    proto.comments.update({ id: a.id, status: "done" });

    const repo = join(folder, "repo");
    expect(proto.comments.exportTo(repo)).toEqual({
      ok: true,
      path: "docs/feedback/comments.json",
      count: 3,
    });
    const text = readFileSync(join(repo, "docs", "feedback", "comments.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual({
      exportedAt: new Date(start + 2000).toISOString(),
      open: 2,
      done: 1,
      comments: [
        { number: 2, where: "everywhere", ...b },
        { number: 3, where: "find › record creator:UC1 › peek brand:b1", ...c },
        {
          number: 1,
          where: "reach › board",
          ...a,
          status: "done",
          doneAt: start + 2000,
        },
      ],
    });
    expect(text).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(readdirSync(join(repo, "docs", "feedback"))).toEqual(["comments.json"]);

    expect(proto.comments.exportTo(null)).toEqual({ ok: false, problem: "no_repo" });
  });

  it("answers failed when the file can't be written, logging no text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const proto = make();
    await proto.set(true);
    proto.comments.add({ ...note, text: "private words" });
    const blocker = join(folder, "blocked");
    await writeFile(blocker, "a file, not a folder");
    expect(proto.comments.exportTo(blocker)).toEqual({ ok: false, problem: "failed" });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("private");
  });
});

describe("commentsForExport", () => {
  it("counts and orders an empty list", () => {
    expect(commentsForExport([])).toEqual({ open: 0, done: 0, comments: [] });
  });
});

describe("findRepoRoot", () => {
  const appPath = join("E:", "repo", "apps", "desktop");
  const root = join("E:", "repo");

  it("finds the root two levels above the app when it has the workspace and docs", () => {
    const exists = (p: string): boolean =>
      p === join(root, "pnpm-workspace.yaml") || p === join(root, "docs");
    expect(findRepoRoot({ packaged: false, appPath, exists })).toBe(root);
  });

  it("answers null when packaged", () => {
    expect(findRepoRoot({ packaged: true, appPath, exists: () => true })).toBeNull();
  });

  it("answers null when the workspace file or docs are missing", () => {
    expect(
      findRepoRoot({ packaged: false, appPath, exists: (p) => p.endsWith("docs") }),
    ).toBeNull();
    expect(
      findRepoRoot({ packaged: false, appPath, exists: (p) => p.endsWith(".yaml") }),
    ).toBeNull();
  });
});
