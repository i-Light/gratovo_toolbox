import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { commentsForExport, findRepoRoot, writeCommentsExport } from "./export";

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

describe("writeCommentsExport", () => {
  it("answers no_repo without reading the comments", () => {
    const read = vi.fn(() => []);
    expect(writeCommentsExport(read, null, 0)).toEqual({ ok: false, problem: "no_repo" });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers failed when the comments can't be read, logging only the kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const repo = await mkdtemp(join(tmpdir(), "gratovo-export-"));
    try {
      const read = () => {
        throw Object.assign(new Error("C:\\Users\\maya\\private"), { code: "SQLITE_BUSY" });
      };
      expect(writeCommentsExport(read, repo, 0)).toEqual({ ok: false, problem: "failed" });
      expect(String(warn.mock.calls[0]?.[0])).toContain("SQLITE_BUSY");
      expect(warn.mock.calls.flat().join(" ")).not.toContain("maya");
    } finally {
      warn.mockRestore();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("writes an empty list, leaving no temporary file", async () => {
    const repo = await mkdtemp(join(tmpdir(), "gratovo-export-"));
    try {
      await writeFile(join(repo, "keep.txt"), "x");
      expect(writeCommentsExport(() => [], repo, 0)).toEqual({
        ok: true,
        path: "docs/feedback/comments.json",
        count: 0,
      });
      expect(await readdir(join(repo, "docs", "feedback"))).toEqual(["comments.json"]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
