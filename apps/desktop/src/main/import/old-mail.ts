import { constants, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { NewMessage } from "@gratovo/core/data";

/**
 * The old app's mail history (plan step 6, D19), brought in with the old data. Two parts:
 * - its `mailbox.db` (what Gmail did: the conversations, sent and inbound ids), copied beside the
 *   pipeline's own only when there is none yet, so a mailbox already in use is never replaced;
 * - its email log (`outreach_threads` and `outreach_messages` in the old `gratovo.db`), read as
 *   messages with `source: "imported"`. DMs and rows with no creator are left out.
 * Both open the old files read-only. Nothing here starts a sequence or drafts an answer.
 */

/** The most old messages one import brings in. */
export const oldMessagesMax = 50_000;

/** What happened to the old `mailbox.db`. */
export type OldMailbox = "copied" | "kept" | "none";

const mailboxName = "mailbox.db";

/**
 * Copies `<oldDir>/mailbox.db` to `<dataDir>/mailbox.db` when the old one exists and the new one
 * doesn't. `VACUUM INTO` makes a whole, consistent copy from a read-only open; it goes to a
 * temporary file first and then only to a path that is still free.
 */
export function copyOldMailbox(oldDir: string, dataDir: string): OldMailbox {
  const from = join(oldDir, mailboxName);
  const to = join(dataDir, mailboxName);
  if (existsSync(to)) {
    return "kept";
  }
  if (!existsSync(from)) {
    return "none";
  }
  const temp = `${to}.import-${String(process.pid)}`;
  rmSync(temp, { force: true });
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(temp);
  } finally {
    db.close();
  }
  try {
    copyFileSync(temp, to, constants.COPYFILE_EXCL);
  } catch (error) {
    // A mail job made its own file meanwhile: that one is in use, so it stays.
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return "kept";
    }
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
  return "copied";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The old ISO time as ms; null when it isn't one. */
function timeOf(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** The old app's email log as messages to store, oldest first. Empty when it has none. */
export function readOldEmails(oldDb: string): NewMessage[] {
  const db = new DatabaseSync(oldDb, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row["name"])),
    );
    if (!tables.has("outreach_threads") || !tables.has("outreach_messages")) {
      return [];
    }
    const rows = db
      .prepare(
        `SELECT m.id, t.channel_id, m.direction, m.subject, m.body, m.peer_email, m.at
         FROM outreach_messages m JOIN outreach_threads t ON t.id = m.thread_id
         WHERE t.channel_id IS NOT NULL AND t.channel_id != ''
           AND (m.method IS NULL OR m.method = 'email')
           AND m.direction IN ('outbound', 'inbound')
         ORDER BY m.at, m.id LIMIT ?`,
      )
      .all(oldMessagesMax);
    const out: NewMessage[] = [];
    for (const row of rows) {
      const id = text(row["id"]);
      const creator = text(row["channel_id"]);
      const at = timeOf(row["at"]);
      if (id === null || creator === null || at === null) {
        continue;
      }
      out.push({
        // Stable, so bringing the old data in again adds nothing twice.
        id: `imported-${id}`,
        creator,
        direction: row["direction"] === "outbound" ? "out" : "in",
        kind: null,
        followUp: null,
        subject: text(row["subject"]) ?? "",
        body: typeof row["body"] === "string" ? row["body"] : "",
        bodyCut: false,
        at,
        mailbox: null,
        peer: text(row["peer_email"]),
        peerName: null,
        conversationKey: null,
        gmailMessageId: null,
        gmailThreadId: null,
        draftId: null,
        by: null,
        source: "imported",
        reading: null,
      });
    }
    return out;
  } finally {
    db.close();
  }
}
