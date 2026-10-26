import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { draftSubjectMax, messageBodyMax } from "@gratovo/core/data";
import type { NewMessage } from "@gratovo/core/data";

/**
 * The old app's email log (plan step 6, D19), brought in with the old data: `outreach_threads`
 * and `outreach_messages` in the old `gratovo.db`, read as messages with `source: "imported"`.
 * DMs and rows with no creator are left out. The old `mailbox.db` is merged by the pipeline's
 * `mail.import` job, not here. Nothing here starts a sequence or drafts an answer.
 */

/** The most old messages one import brings in: the newest ones. */
export const oldMessagesMax = 50_000;

const idPrefix = "imported-";
/** The frame's id limit (`packages/ipc/src/reach.ts`). */
const idMax = 100;
/** A creator id the frame accepts. */
const creatorId = /^[A-Za-z0-9_-]{1,64}$/;

export interface OldEmails {
  readonly messages: NewMessage[];
  /** True when the log held more than `oldMessagesMax` and the oldest were left out. */
  readonly capped: boolean;
}

/** Opens an old file so SQLite never writes beside it (no `-wal`, no `-shm`). */
export function openOldFile(path: string): DatabaseSync {
  const url = pathToFileURL(path);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url, { readOnly: true });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The old ISO time as ms; null when it isn't one. A time with no zone reads as local time. */
function timeOf(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** The old app's email log as messages to store, oldest first. Empty when it has none. */
export function readOldEmails(oldDb: string): OldEmails {
  const db = openOldFile(oldDb);
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row["name"])),
    );
    if (!tables.has("outreach_threads") || !tables.has("outreach_messages")) {
      return { messages: [], capped: false };
    }
    // The newest first, so a cut keeps the mail that matters most.
    const rows = db
      .prepare(
        `SELECT m.id, t.channel_id, m.direction, m.subject, substr(m.body, 1, ?) AS body,
                length(m.body) AS length, m.peer_email, m.at
         FROM outreach_messages m JOIN outreach_threads t ON t.id = m.thread_id
         WHERE t.channel_id IS NOT NULL AND t.channel_id != ''
           AND (m.method IS NULL OR m.method = 'email')
           AND m.direction IN ('outbound', 'inbound')
         ORDER BY m.at DESC, m.id DESC LIMIT ?`,
      )
      .all(messageBodyMax, oldMessagesMax + 1);
    const capped = rows.length > oldMessagesMax;
    const out: NewMessage[] = [];
    for (const row of rows.slice(0, oldMessagesMax)) {
      const id = text(row["id"]);
      const creator = text(row["channel_id"]);
      const at = timeOf(row["at"]);
      if (
        id === null ||
        idPrefix.length + id.length > idMax ||
        creator === null ||
        !creatorId.test(creator) ||
        at === null
      ) {
        continue;
      }
      out.push({
        // Stable, so bringing the old data in again adds nothing twice.
        id: `${idPrefix}${id}`,
        creator,
        direction: row["direction"] === "outbound" ? "out" : "in",
        kind: null,
        followUp: null,
        subject: (text(row["subject"]) ?? "").slice(0, draftSubjectMax),
        body: typeof row["body"] === "string" ? row["body"] : "",
        bodyCut: typeof row["length"] === "number" && row["length"] > messageBodyMax,
        at,
        mailbox: null,
        peer: text(row["peer_email"])?.slice(0, 320) ?? null,
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
    return { messages: out.sort((a, b) => a.at - b.at), capped };
  } finally {
    db.close();
  }
}
