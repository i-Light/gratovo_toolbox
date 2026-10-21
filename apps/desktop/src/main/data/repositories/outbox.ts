import type { DatabaseSync } from "node:sqlite";

// The outbox of intent (step 3d-2b): changes made here and not yet sent, oldest first. Callers
// run these inside their own transaction where the plan says so (a local write and its entry
// must commit together).

export type OutboxKind =
  | "profile.name"
  | "activity.add"
  | "notify.set"
  | "channel.edit"
  | "conflict.resolve"
  | "brand.set"
  | "deal.step";

export interface OutboxEntry {
  readonly seq: number;
  readonly userId: string;
  readonly kind: OutboxKind;
  readonly payload: unknown;
  readonly target: { readonly table: string; readonly key: string } | null;
  readonly attempts: number;
  readonly createdAt: string;
}

function toEntry(row: Record<string, unknown>): OutboxEntry {
  const table = row["target_table"];
  const key = row["target_key"];
  return {
    seq: Number(row["seq"]),
    userId: String(row["user_id"]),
    kind: String(row["kind"]) as OutboxKind,
    payload: JSON.parse(String(row["payload"])) as unknown,
    target: typeof table === "string" && typeof key === "string" ? { table, key } : null,
    attempts: Number(row["attempts"]),
    createdAt: String(row["created_at"]),
  };
}

/** Adds an entry at the end of the queue and returns its sequence number. */
export function enqueue(
  db: DatabaseSync,
  e: {
    userId: string;
    kind: OutboxKind;
    payload: unknown;
    target: { table: string; key: string } | null;
    now: number;
  },
): number {
  const result = db
    .prepare(
      "INSERT INTO _outbox (user_id, kind, payload, target_table, target_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      e.userId,
      e.kind,
      JSON.stringify(e.payload),
      e.target?.table ?? null,
      e.target?.key ?? null,
      new Date(e.now).toISOString(),
    );
  return Number(result.lastInsertRowid);
}

/** The oldest entry of this user, or null. */
export function head(db: DatabaseSync, userId: string): OutboxEntry | null {
  const row = db
    .prepare("SELECT * FROM _outbox WHERE user_id = ? ORDER BY seq ASC LIMIT 1")
    .get(userId);
  return row === undefined ? null : toEntry(row);
}

/** Up to `max` entries of `kind` in a row from the head: stops at the first entry of another kind. */
export function headRun(
  db: DatabaseSync,
  userId: string,
  kind: OutboxKind,
  max: number,
): OutboxEntry[] {
  const rows = db
    .prepare("SELECT * FROM _outbox WHERE user_id = ? ORDER BY seq ASC LIMIT ?")
    .all(userId, Math.max(0, max));
  const run: OutboxEntry[] = [];
  for (const row of rows) {
    if (row["kind"] !== kind) {
      break;
    }
    run.push(toEntry(row));
  }
  return run;
}

export function removeEntries(db: DatabaseSync, seqs: readonly number[]): void {
  const remove = db.prepare("DELETE FROM _outbox WHERE seq = ?");
  for (const seq of seqs) {
    remove.run(seq);
  }
}

/** Moves an entry to `_outbox_dropped` (the server refused it). Run it in the caller's transaction. */
export function dropEntry(db: DatabaseSync, entry: OutboxEntry, code: string, now: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO _outbox_dropped (seq, user_id, kind, payload, code, dropped_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    entry.seq,
    entry.userId,
    entry.kind,
    JSON.stringify(entry.payload),
    code,
    new Date(now).toISOString(),
  );
  db.prepare("DELETE FROM _outbox WHERE seq = ?").run(entry.seq);
}

/** One more failed attempt on this entry. */
export function noteFailure(db: DatabaseSync, seq: number, code: string): void {
  db.prepare("UPDATE _outbox SET attempts = attempts + 1, last_code = ? WHERE seq = ?").run(
    code,
    seq,
  );
}

/** Entries waiting: this user's, or everyone's when no user is given. */
export function pendingCount(db: DatabaseSync, userId?: string): number {
  const row =
    userId === undefined
      ? db.prepare("SELECT COUNT(*) AS n FROM _outbox").get()
      : db.prepare("SELECT COUNT(*) AS n FROM _outbox WHERE user_id = ?").get(userId);
  return Number(row?.["n"] ?? 0);
}

/** Whether an unsent entry targets this row. */
export function hasPending(db: DatabaseSync, table: string, key: string): boolean {
  const row = db
    .prepare("SELECT 1 AS one FROM _outbox WHERE target_table = ? AND target_key = ? LIMIT 1")
    .get(table, key);
  return row !== undefined;
}

/** The payload of this user's newest entry of that kind, or null. */
export function pendingPayload(
  db: DatabaseSync,
  userId: string,
  kind: "profile.name" | "notify.set",
): unknown {
  const row = db
    .prepare("SELECT payload FROM _outbox WHERE user_id = ? AND kind = ? ORDER BY seq DESC LIMIT 1")
    .get(userId, kind);
  return row === undefined ? null : (JSON.parse(String(row["payload"])) as unknown);
}

/**
 * The entries the uploader has on the wire right now. An undo must not cancel one of these: its
 * request may already have reached the server, so the line needs an undo marker instead.
 */
const sending = new Set<number>();

export function markSending(seqs: readonly number[]): void {
  for (const seq of seqs) {
    sending.add(seq);
  }
}

export function clearSending(seqs: readonly number[]): void {
  for (const seq of seqs) {
    sending.delete(seq);
  }
}

/**
 * Deletes an unsent `activity.add` for this log line. True when one was removed; false when there
 * is none, or it is being sent right now (the caller adds an undo marker then).
 */
export function cancelActivityAdd(db: DatabaseSync, lineId: string): boolean {
  const rows = db
    .prepare(
      "SELECT seq FROM _outbox WHERE kind = 'activity.add' AND json_extract(payload, '$.row.id') = ?",
    )
    .all(lineId);
  if (rows.length === 0 || rows.some((row) => sending.has(Number(row["seq"])))) {
    return false;
  }
  const result = db
    .prepare(
      "DELETE FROM _outbox WHERE kind = 'activity.add' AND json_extract(payload, '$.row.id') = ?",
    )
    .run(lineId);
  return Number(result.changes) > 0;
}

/** Deletes every entry that is not this user's; returns how many. */
export function removeOtherUsers(db: DatabaseSync, userId: string): number {
  const result = db.prepare("DELETE FROM _outbox WHERE user_id <> ?").run(userId);
  return Number(result.changes);
}
