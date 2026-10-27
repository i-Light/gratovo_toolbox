import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import { commentsExportPath } from "@gratovo/ipc";
import type { Comment, CommentsExportResult } from "@gratovo/ipc";

import { kindOf } from "./kind-of";

/**
 * "Export for Claude" (plan D8): the owner's comments written to `docs/feedback/comments.json` in
 * the repository, when the app runs from it.
 */

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

/**
 * Writes the comments `read` gives to the export file under `repoRoot`, replacing it whole
 * (through a temporary file and a rename, so a reader never sees half of it). `no_repo` without a
 * repository; `failed`, logging only the error's kind, when they can't be read or written.
 */
export function writeCommentsExport(
  read: () => readonly Comment[],
  repoRoot: string | null,
  now: number,
): CommentsExportResult {
  if (repoRoot === null) {
    return { ok: false, problem: "no_repo" };
  }
  let temp: string | null = null;
  try {
    const list = read();
    const dir = join(repoRoot, "docs", "feedback");
    mkdirSync(dir, { recursive: true });
    const body = { exportedAt: new Date(now).toISOString(), ...commentsForExport(list) };
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
}
