import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";

import {
  draftBodyMax,
  draftKinds,
  draftProblems,
  draftStates,
  draftSubjectMax,
  messageBodyMax,
  reachDraftsMax,
  reachThreadsMax,
  replyFactKeys,
  rewriteHows,
  sequenceStops,
  threadPreviewMax,
} from "@gratovo/core/data";
import type {
  DataWrite,
  DraftFinding,
  DraftKind,
  DraftPatch,
  DraftProblem,
  DraftProposal,
  DraftState,
  EngineGate,
  NewDraft,
  NewMessage,
  OutreachDraft,
  OutreachStore,
  ReplyFact,
  ReplyReading,
  RewriteHow,
  Sequence,
  SequenceStep,
  StoredDraft,
  ThreadLastIn,
  ThreadMessage,
  ThreadSummary,
} from "@gratovo/core/data";

/** A day, in ms: the time a sent or skipped draft stays in the frame. */
const day = 24 * 60 * 60 * 1000;

type Row = Record<string, SQLOutputValue>;

/** The hash a check ran on: subject and body (a stable sha256, hex). */
export function textHash(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex");
}

// Reading JSON columns: a bad value reads as the empty one and never throws.

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).filter((x) => typeof x === "string") : [];
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function parseProposal(text: unknown): DraftProposal | null {
  const value = parseJson(text);
  if (!isRecord(value)) {
    return null;
  }
  const status = oneOf(["ready", "needs_human", "blocked", "no_message"] as const, value["status"]);
  if (status === null) {
    return null;
  }
  const findings: DraftFinding[] = [];
  for (const item of Array.isArray(value["findings"]) ? (value["findings"] as unknown[]) : []) {
    if (isRecord(item) && typeof item["rule"] === "string" && typeof item["text"] === "string") {
      findings.push({
        rule: item["rule"],
        text: item["text"],
        blocking: item["blocking"] === true,
      });
    }
  }
  const gates: EngineGate[] = [];
  for (const item of Array.isArray(value["gates"]) ? (value["gates"] as unknown[]) : []) {
    const kind = isRecord(item)
      ? oneOf(["price", "terms", "claim", "ethics", "fact_missing", "other"] as const, item["kind"])
      : null;
    if (isRecord(item) && kind !== null && typeof item["key"] === "string") {
      gates.push({
        key: item["key"],
        kind,
        text: typeof item["text"] === "string" ? item["text"] : "",
      });
    }
  }
  const situation = value["situation"];
  return {
    status,
    why: typeof value["why"] === "string" ? value["why"] : "",
    rules: strings(value["rules"]),
    findings,
    gates,
    situation:
      isRecord(situation) &&
      typeof situation["side"] === "string" &&
      typeof situation["stage"] === "string" &&
      typeof situation["summary"] === "string"
        ? {
            side: situation["side"],
            stage: situation["stage"],
            replyType: typeof situation["replyType"] === "string" ? situation["replyType"] : null,
            summary: situation["summary"],
          }
        : null,
    model: typeof value["model"] === "string" ? value["model"] : null,
  };
}

function parseFacts(value: unknown): ReplyFact[] {
  const facts: ReplyFact[] = [];
  for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
    if (!isRecord(item) || oneOf(replyFactKeys, item["key"]) === null) {
      continue;
    }
    // Facts are written by main from a checked source; keep the shape that is there.
    facts.push(item as unknown as ReplyFact);
  }
  return facts;
}

function parseReading(text: unknown): ReplyReading | null {
  const value = parseJson(text);
  if (!isRecord(value)) {
    return null;
  }
  return {
    replyType: typeof value["replyType"] === "string" ? value["replyType"] : null,
    label: typeof value["label"] === "string" ? value["label"] : "",
    summary: typeof value["summary"] === "string" ? value["summary"] : "",
    side: typeof value["side"] === "string" ? value["side"] : "",
    corrected: value["corrected"] === true,
    facts: parseFacts(value["facts"]),
  };
}

function parseSteps(text: unknown): SequenceStep[] {
  const value = parseJson(text);
  const steps: SequenceStep[] = [];
  for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
    const state = isRecord(item)
      ? oneOf(["planned", "drafted", "sent", "skipped"] as const, item["state"])
      : null;
    if (
      isRecord(item) &&
      state !== null &&
      typeof item["n"] === "number" &&
      typeof item["dueAt"] === "number"
    ) {
      steps.push({
        n: item["n"],
        dueAt: item["dueAt"],
        state,
        sentAt: typeof item["sentAt"] === "number" ? item["sentAt"] : null,
      });
    }
  }
  return steps;
}

/** The `steer` column: `{how, note, rewriting}`; any part may be missing. */
interface SteerJson {
  how: RewriteHow | null;
  note: string | null;
  rewriting: RewriteHow | null;
}

function parseSteer(text: unknown): SteerJson {
  const value = parseJson(text);
  if (!isRecord(value)) {
    return { how: null, note: null, rewriting: null };
  }
  return {
    how: oneOf(rewriteHows, value["how"]),
    note: typeof value["note"] === "string" ? value["note"] : null,
    rewriting: oneOf(rewriteHows, value["rewriting"]),
  };
}

function steerText(steer: SteerJson): string | null {
  return steer.how === null && steer.note === null && steer.rewriting === null
    ? null
    : JSON.stringify(steer);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function optNum(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function optStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function storedDraft(row: Row): StoredDraft {
  const subject = String(row["subject"]);
  const body = String(row["body"]);
  const edited = num(row["edited"]) === 1;
  const checkedHash = optStr(row["checked_text"]);
  const steer = parseSteer(row["steer"]);
  const hasSteer = steer.how !== null || steer.note !== null;
  return {
    id: String(row["id"]),
    creator: String(row["channel_id"]),
    kind: oneOf(draftKinds, row["kind"]) ?? "first",
    followUp: optNum(row["follow_up"]),
    state: oneOf(draftStates, row["state"]) ?? "failed",
    subject,
    body,
    mailbox: optStr(row["mailbox"]),
    sendAt: optNum(row["send_at"]),
    proposal: parseProposal(row["proposal"]),
    gatesOk: [...new Set(strings(parseJson(row["gates_ok"])))],
    edited,
    checked: !edited || checkedHash === textHash(subject, body),
    rewriting: steer.rewriting,
    replyTo: optStr(row["reply_to"]),
    problem: oneOf<DraftProblem>(draftProblems, row["problem"]),
    createdAt: num(row["created_at"]),
    updatedAt: num(row["updated_at"]),
    approvedBy: optStr(row["approved_by"]),
    checkedHash,
    steer: hasSteer ? { how: steer.how, note: steer.note } : null,
  };
}

/** The frame carries a draft without what only main needs. */
function frameDraft(draft: StoredDraft): OutreachDraft {
  return {
    id: draft.id,
    creator: draft.creator,
    kind: draft.kind,
    followUp: draft.followUp,
    state: draft.state,
    subject: draft.subject,
    body: draft.body,
    mailbox: draft.mailbox,
    sendAt: draft.sendAt,
    proposal: draft.proposal,
    gatesOk: draft.gatesOk,
    edited: draft.edited,
    checked: draft.checked,
    rewriting: draft.rewriting,
    replyTo: draft.replyTo,
    problem: draft.problem,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function sequenceFrom(row: Row): Sequence {
  return {
    creator: String(row["channel_id"]),
    mailbox: String(row["mailbox"]),
    startedAt: num(row["started_at"]),
    steps: parseSteps(row["steps"]),
    stopped: oneOf(sequenceStops, row["stopped"]),
    parkUntil: optNum(row["park_until"]),
  };
}

function messageFrom(row: Row): ThreadMessage {
  return {
    id: String(row["id"]),
    direction: row["direction"] === "in" ? "in" : "out",
    kind: oneOf<DraftKind>(draftKinds, row["kind"]),
    followUp: optNum(row["follow_up"]),
    subject: String(row["subject"]),
    body: String(row["body"]),
    bodyCut: num(row["body_cut"]) === 1,
    at: num(row["at"]),
    mailbox: optStr(row["mailbox"]),
    peer: optStr(row["peer"]),
    peerName: optStr(row["peer_name"]),
    by: optStr(row["by"]),
    source: oneOf(["app", "sweep", "pasted", "imported"] as const, row["source"]) ?? "app",
    reading: parseReading(row["reading"]),
  };
}

/** The first non-empty line, cut to the preview length. */
function previewOf(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (text !== "") {
      return text.slice(0, threadPreviewMax);
    }
  }
  return "";
}

// The four draft writes (plan D5). A refused one is a no-op: it logs its kind only, never text.

function refused(kind: string): void {
  console.warn(`A ${kind} write was refused: the draft is not in a state that allows it.`);
}

function draftState(db: DatabaseSync, id: string): DraftState | null {
  const row = db.prepare("SELECT state FROM outreach_drafts WHERE id = ?").get(id);
  return row === undefined ? null : oneOf(draftStates, row["state"]);
}

const fromReady: readonly DraftState[] = ["ready", "failed"];
const fromTaken: readonly DraftState[] = ["approved", "scheduled", "skipped"];

/** `draft.state`: only between ready/failed and approved/scheduled/skipped, and back to ready. */
/** How long an approved email waits before it goes, so Undo can take it back (D11). */
export const sendHoldMs = 10_000;

export function writeDraftState(
  db: DatabaseSync,
  write: Extract<DataWrite, { kind: "draft.state" }>,
  me: string,
  now: number,
): void {
  const from = draftState(db, write.id);
  if (from === null) {
    return;
  }
  const to = write.state;
  const allowed = to === "ready" ? fromTaken.includes(from) : fromReady.includes(from);
  if (!allowed) {
    refused(write.kind);
    return;
  }
  if (to === "approved" || to === "scheduled") {
    // Main sets the hold, not the page: an approval always gets its full 10 s from now, and a
    // later time never less. A Redo, or an Undo that puts back an old approval, carries a time
    // already past, and must not send at once (plan step 6, D11).
    const sendAt =
      to === "approved" ? now + sendHoldMs : Math.max(write.sendAt ?? 0, now + sendHoldMs);
    db.prepare(
      "UPDATE outreach_drafts SET state = ?, approved_by = ?, send_at = ?, updated_at = ? WHERE id = ?",
    ).run(to, me, sendAt, now, write.id);
    return;
  }
  // `ready` also clears the problem; `skipped` leaves it.
  db.prepare(
    `UPDATE outreach_drafts SET state = ?, approved_by = NULL, send_at = NULL, updated_at = ?${
      to === "ready" ? ", problem = NULL" : ""
    } WHERE id = ?`,
  ).run(to, now, write.id);
}

/** `draft.text`: stores the text and marks it edited; not on a draft that is going or gone. */
export function writeDraftText(
  db: DatabaseSync,
  write: Extract<DataWrite, { kind: "draft.text" }>,
  now: number,
): void {
  const state = draftState(db, write.id);
  if (state === null) {
    return;
  }
  if (state === "sending" || state === "sent") {
    refused(write.kind);
    return;
  }
  db.prepare(
    "UPDATE outreach_drafts SET subject = ?, body = ?, edited = 1, updated_at = ? WHERE id = ?",
  ).run(write.subject.slice(0, draftSubjectMax), write.body.slice(0, draftBodyMax), now, write.id);
}

/** `draft.mailbox`: first emails only (D3). */
export function writeDraftMailbox(
  db: DatabaseSync,
  write: Extract<DataWrite, { kind: "draft.mailbox" }>,
  now: number,
): void {
  const row = db.prepare("SELECT kind, state FROM outreach_drafts WHERE id = ?").get(write.id);
  if (row === undefined) {
    return;
  }
  if (row["kind"] !== "first" || row["state"] === "sending" || row["state"] === "sent") {
    refused(write.kind);
    return;
  }
  db.prepare("UPDATE outreach_drafts SET mailbox = ?, updated_at = ? WHERE id = ?").run(
    write.mailbox,
    now,
    write.id,
  );
}

/** `draft.gate`: adds or removes a key in `gates_ok`, once, in order. */
export function writeDraftGate(
  db: DatabaseSync,
  write: Extract<DataWrite, { kind: "draft.gate" }>,
  now: number,
): void {
  const row = db.prepare("SELECT gates_ok, state FROM outreach_drafts WHERE id = ?").get(write.id);
  if (row === undefined) {
    return;
  }
  if (row["state"] === "sending" || row["state"] === "sent") {
    refused(write.kind);
    return;
  }
  const keys = [...new Set(strings(parseJson(row["gates_ok"])))].filter((k) => k !== write.gate);
  if (write.ok) {
    keys.push(write.gate);
  }
  db.prepare("UPDATE outreach_drafts SET gates_ok = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(keys),
    now,
    write.id,
  );
}

/** How the store reaches the source's transaction and its one write path. */
export interface OutreachDeps {
  /** Runs `fn` in one transaction (commits on return, rolls back on a throw). */
  readonly transaction: (fn: () => void) => void;
  /** Applies writes through the source's own path, inside the caller's transaction. */
  readonly applyWrites: (writes: readonly DataWrite[]) => void;
}

/** The outreach rows behind `DataSource.outreach`. */
export function createOutreachStore(db: DatabaseSync, deps: OutreachDeps): OutreachStore {
  const draftRows = (sql: string, ...params: SQLInputValue[]): StoredDraft[] =>
    db
      .prepare(sql)
      .all(...params)
      .map(storedDraft);

  function updateDraft(id: string, patch: DraftPatch, at: number): boolean {
    const row = db.prepare("SELECT steer FROM outreach_drafts WHERE id = ?").get(id);
    if (row === undefined) {
      return false;
    }
    const sets: string[] = ["updated_at = ?"];
    const params: SQLInputValue[] = [at];
    const set = (column: string, value: SQLInputValue): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.state !== undefined) set("state", patch.state);
    if (patch.subject !== undefined) set("subject", patch.subject.slice(0, draftSubjectMax));
    if (patch.body !== undefined) set("body", patch.body.slice(0, draftBodyMax));
    if (patch.mailbox !== undefined) set("mailbox", patch.mailbox);
    if (patch.sendAt !== undefined) set("send_at", patch.sendAt);
    if (patch.proposal !== undefined) {
      set("proposal", patch.proposal === null ? null : JSON.stringify(patch.proposal));
    }
    if (patch.gatesOk !== undefined) set("gates_ok", JSON.stringify([...new Set(patch.gatesOk)]));
    if (patch.checkedHash !== undefined) set("checked_text", patch.checkedHash);
    if (patch.problem !== undefined) set("problem", patch.problem);
    if (patch.edited !== undefined) set("edited", patch.edited ? 1 : 0);
    if (patch.steer !== undefined || patch.rewriting !== undefined) {
      const steer = parseSteer(row["steer"]);
      if (patch.steer !== undefined) {
        steer.how = patch.steer === null ? null : patch.steer.how;
        steer.note = patch.steer === null ? null : patch.steer.note;
      }
      if (patch.rewriting !== undefined) {
        steer.rewriting = patch.rewriting;
      }
      set("steer", steerText(steer));
    }
    params.push(id);
    db.prepare(`UPDATE outreach_drafts SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return true;
  }

  function insertMessage(message: NewMessage): void {
    db.prepare(
      `INSERT OR IGNORE INTO outreach_messages
         (id, channel_id, direction, kind, follow_up, subject, body, body_cut, at, mailbox, peer,
          peer_name, conversation_key, gmail_message_id, gmail_thread_id, draft_id, by, source,
          reading)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      message.creator,
      message.direction,
      message.direction === "out" ? message.kind : null,
      message.followUp,
      message.subject,
      message.body.slice(0, messageBodyMax),
      message.bodyCut || message.body.length > messageBodyMax ? 1 : 0,
      message.at,
      message.mailbox,
      message.peer,
      message.peerName,
      message.conversationKey,
      message.gmailMessageId,
      message.gmailThreadId,
      message.draftId,
      message.by,
      message.source,
      message.reading === null ? null : JSON.stringify(message.reading),
    );
  }

  function upsertSequence(sequence: Sequence, at: number): void {
    db.prepare(
      `INSERT INTO outreach_sequences
         (channel_id, conversation_key, mailbox, started_at, steps, stopped, park_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel_id) DO UPDATE SET
         conversation_key = excluded.conversation_key, mailbox = excluded.mailbox,
         started_at = excluded.started_at, steps = excluded.steps, stopped = excluded.stopped,
         park_until = excluded.park_until, updated_at = excluded.updated_at`,
    ).run(
      sequence.creator,
      `c:${sequence.creator}`,
      sequence.mailbox,
      sequence.startedAt,
      JSON.stringify(sequence.steps),
      sequence.stopped,
      sequence.parkUntil,
      at,
    );
  }

  function threads(): ThreadSummary[] {
    const heads = db
      .prepare(
        `SELECT channel_id, COUNT(*) AS n,
                MAX(CASE WHEN direction = 'out' THEN at END) AS last_out, MAX(at) AS newest
         FROM outreach_messages GROUP BY channel_id ORDER BY newest DESC, channel_id LIMIT ?`,
      )
      .all(reachThreadsMax);
    const newest = (where: string): Map<string, Row> => {
      const rows = db
        .prepare(
          `SELECT * FROM (
             SELECT id, channel_id, direction, at, reading, substr(body, 1, 2000) AS body,
                    ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY at DESC, rowid DESC) AS n
             FROM outreach_messages ${where}
           ) WHERE n = 1`,
        )
        .all();
      return new Map(rows.map((row) => [String(row["channel_id"]), row]));
    };
    const lastIn = newest("WHERE direction = 'in'");
    const last = newest("");
    return heads.map((head) => {
      const id = String(head["channel_id"]);
      const incoming = lastIn.get(id);
      let incomingSummary: ThreadLastIn | null = null;
      if (incoming !== undefined) {
        const reading = parseReading(incoming["reading"]);
        incomingSummary = {
          id: String(incoming["id"]),
          at: num(incoming["at"]),
          reading,
          preview: previewOf(String(incoming["body"])),
          bounce: reading?.replyType === "any.bounce",
        };
      }
      return {
        creator: id,
        count: num(head["n"]),
        lastOutAt: optNum(head["last_out"]),
        lastIn: incomingSummary,
        answered: last.get(id)?.["direction"] === "out",
      };
    });
  }

  return {
    reachParts(now) {
      const drafts = draftRows(
        `SELECT * FROM outreach_drafts
         WHERE state NOT IN ('sent', 'skipped') OR updated_at >= ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        now - day,
        reachDraftsMax,
      ).map(frameDraft);
      const sequences = db
        .prepare("SELECT * FROM outreach_sequences ORDER BY started_at, channel_id")
        .all()
        .map(sequenceFrom);
      return { drafts, sequences, threads: threads() };
    },
    draft: (id) => draftRows("SELECT * FROM outreach_drafts WHERE id = ?", id)[0] ?? null,
    draftsIn(states) {
      if (states.length === 0) {
        return [];
      }
      return draftRows(
        `SELECT * FROM outreach_drafts WHERE state IN (${states.map(() => "?").join(", ")})
         ORDER BY created_at, rowid`,
        ...states,
      );
    },
    openDraft: (creator) =>
      draftRows(
        `SELECT * FROM outreach_drafts WHERE channel_id = ? AND state NOT IN ('sent', 'skipped')
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        creator,
      )[0] ?? null,
    insertDraft(draft: NewDraft) {
      db.prepare(
        `INSERT INTO outreach_drafts
           (id, channel_id, kind, follow_up, state, mailbox, reply_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'drafting', ?, ?, ?, ?)`,
      ).run(
        draft.id,
        draft.creator,
        draft.kind,
        draft.followUp,
        draft.mailbox,
        draft.replyTo,
        draft.at,
        draft.at,
      );
    },
    updateDraft,
    thread(creator, limit) {
      const rows = db
        .prepare(
          `SELECT * FROM outreach_messages WHERE channel_id = ?
           ORDER BY at DESC, rowid DESC LIMIT ?`,
        )
        .all(creator, Math.max(0, Math.floor(limit)));
      return rows.map(messageFrom).reverse();
    },
    hasOutbound: (creator) =>
      db
        .prepare(
          "SELECT 1 AS found FROM outreach_messages WHERE channel_id = ? AND direction = 'out' LIMIT 1",
        )
        .get(creator) !== undefined,
    recentOutbound: (limit) =>
      db
        .prepare(
          `SELECT channel_id, body FROM outreach_messages WHERE direction = 'out'
           ORDER BY at DESC, rowid DESC LIMIT ?`,
        )
        .all(Math.max(0, Math.floor(limit)))
        .map((row) => ({ creator: String(row["channel_id"]), body: String(row["body"]) })),
    sentSince: (since) =>
      db
        .prepare(
          `SELECT mailbox, COUNT(*) AS n FROM outreach_messages
           WHERE direction = 'out' AND mailbox IS NOT NULL AND at >= ?
           GROUP BY mailbox ORDER BY mailbox`,
        )
        .all(since)
        .map((row) => ({ mailbox: String(row["mailbox"]), count: num(row["n"]) })),
    sequence: (creator) => {
      const row = db.prepare("SELECT * FROM outreach_sequences WHERE channel_id = ?").get(creator);
      return row === undefined ? null : sequenceFrom(row);
    },
    commit(change) {
      deps.transaction(() => {
        for (const { id, patch } of change.drafts ?? []) {
          updateDraft(id, patch, change.at);
        }
        for (const message of change.messages ?? []) {
          insertMessage(message);
        }
        for (const sequence of change.sequences ?? []) {
          upsertSequence(sequence, change.at);
        }
        if (change.writes !== undefined && change.writes.length > 0) {
          deps.applyWrites(change.writes);
        }
      });
    },
  };
}
