/**
 * The uploader (plan D7, D8, D9): sends the outbox to Supabase, oldest first, in the order the
 * changes were made. Ported from the old app's `mirror_uploader.dart` (its order and refusal rules,
 * not its code).
 *
 * Strict FIFO: the head goes first, and a failure that might succeed next time stops the drain,
 * because "sending entry 7 after entry 6 failed would apply an edit on a state the server never
 * reached". A refusal the server has already judged (`classifyUploadError` says `drop`) moves the
 * entry to `_outbox_dropped`, marks its row for a re-fetch (D10) and lets the drain go on, so one
 * refused write can't jam everything behind it. An expired session stops the pass without counting
 * an attempt. Logs carry the kind, the sequence number and a code, never a payload.
 */

import type { DatabaseSync } from "node:sqlite";

import { getMeta, setMeta } from "../data/repositories/meta";
import { dropEntry, head, headRun, noteFailure, removeEntries } from "../data/repositories/outbox";
import type { OutboxEntry, OutboxKind } from "../data/repositories/outbox";
import { inTransaction } from "../data/sqlite-source";
import { NetworkRefusedError } from "../net/network";
import { AuthError } from "../supabase/auth-client";
import { RestError } from "../supabase/rest";
import type { Rest } from "../supabase/rest";
import { classifyUploadError } from "./refusal";
import type { Verdict } from "./refusal";

export interface DrainResult {
  /** Entries that reached the server and left the outbox. */
  readonly sent: number;
  /** Entries moved to `_outbox_dropped` in this drain. */
  readonly dropped: number;
  /** Why the drain stopped before the outbox was empty, or null when it emptied it. */
  readonly stoppedOn: Verdict | null;
  /**
   * Every server table a sent entry touched. The broadcast (D25) names the ones teammates pull;
   * `notification_switches` is only ever your own row, so the announcer leaves it out.
   */
  readonly tables: ReadonlySet<string>;
}

/** Consecutive `activity.add` entries sent in one request (D7). */
export const logBatchMax = 200;

/** The `_meta` key of the rows to read again by key (D10 (3)); JSON `[{ table, key }]`. */
export const refetchKey = "sync.refetch";

/** Adds a row to `sync.refetch` once. Run it in the caller's transaction. */
export function markRefetch(db: DatabaseSync, target: { table: string; key: string }): void {
  let list: { table: string; key: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(getMeta(db, refetchKey) ?? "[]");
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (item): item is { table: string; key: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>)["table"] === "string" &&
          typeof (item as Record<string, unknown>)["key"] === "string",
      );
    }
  } catch {
    // A damaged list starts over; the next pull brings the rows anyway.
  }
  if (!list.some((item) => item.table === target.table && item.key === target.key)) {
    list.push({ table: target.table, key: target.key });
  }
  setMeta(db, refetchKey, JSON.stringify(list));
}

/**
 * The fields `apply_channel_edit` writes (its hard-coded whitelist, S17's migration). The uploader
 * never sends another one: the server would refuse it with 22023 anyway, so it drops here, visibly,
 * without a round trip. A test keeps this list equal to the migration's text.
 */
export const editableFields: readonly string[] = [
  "notes",
  "vetting_status",
  "pipeline_stage",
  "channel_tags",
  "relevance_criteria",
  "provided_data",
  "contacts",
  "media_kit",
  "creator_gender",
  "creator_stage",
];

/** A payload this build can't send. It can never succeed, so it is dropped (visibly). */
class BadPayloadError extends Error {
  readonly code: string;

  constructor(code = "bad_payload") {
    super("An outbox payload is not readable.");
    this.name = "BadPayloadError";
    this.code = code;
  }
}

function record(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new BadPayloadError();
  }
  return payload as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadPayloadError();
  }
  return value;
}

function eqFilter(column: string, value: string): string {
  return `${column}=eq.${encodeURIComponent(value)}`;
}

/** A short, payload-free code for a failure, kept in `_outbox.last_code` and the log. */
function failureCode(error: unknown): string {
  if (error instanceof RestError) {
    if (error.code !== null) {
      return error.code;
    }
    return error.kind === "offline" ? "offline" : `http_${String(error.status ?? 0)}`;
  }
  if (error instanceof AuthError) {
    return `auth_${error.kind}`;
  }
  if (error instanceof NetworkRefusedError) {
    return "refused";
  }
  if (error instanceof BadPayloadError) {
    return error.code;
  }
  return "error";
}

/** What an RPC's answer means for its entry: sent (maybe with a row to read again), or try later. */
export type RpcOutcome =
  | { readonly result: "done"; readonly refetch?: { readonly table: string; readonly key: string } }
  | { readonly result: "retry"; readonly code: string };

const sentOk: RpcOutcome = { result: "done" };

/** `apply_channel_edit`'s answers (S17's migration). */
const editOutcomes: ReadonlySet<string> = new Set(["noop", "auto", "applied", "conflict"]);

/** `resolve_edit_conflict`'s answers: its own two, or the forced `apply_channel_edit`'s. */
const resolveOutcomes: ReadonlySet<string> = new Set([
  ...editOutcomes,
  "missing",
  "already_resolved",
]);

/** An answer this build doesn't know may be a newer server's: keep the entry, never drop it. */
const badOutcome: RpcOutcome = { result: "retry", code: "bad_outcome" };

/**
 * `channel.edit`: `noop`, `auto` and `applied` are sent. `conflict` is sent too (the server filed
 * the clash and kept its value), and the channel is read again so the local stage reverts to the
 * server's while the pull's conflict read brings the notice (D10 (3), D27).
 */
function editOutcome(answer: unknown, channel: { table: string; key: string }): RpcOutcome {
  if (typeof answer !== "string" || !editOutcomes.has(answer)) {
    return badOutcome;
  }
  return answer === "conflict" ? { result: "done", refetch: channel } : sentOk;
}

/**
 * `conflict.resolve`: every known answer is sent (`missing` and `already_resolved` included: the
 * conflict is gone either way), and the channel is read again to show the value that won.
 */
function resolveOutcome(
  answer: unknown,
  channel: { table: string; key: string } | null,
): RpcOutcome {
  if (typeof answer !== "string" || !resolveOutcomes.has(answer)) {
    return badOutcome;
  }
  return channel === null ? sentOk : { result: "done", refetch: channel };
}

type UploadRest = Pick<Rest, "patch" | "upsert" | "rpc">;

/** The step that sends one entry (or one run of log rows) and names the tables it touched. */
interface Sent {
  readonly tables: readonly string[];
  readonly outcome: RpcOutcome;
}

async function send(rest: UploadRest, userId: string, entry: OutboxEntry): Promise<Sent> {
  const p = record(entry.payload);
  switch (entry.kind) {
    case "profile.name":
      await rest.patch("profiles", eqFilter("id", userId), { display_name: text(p["name"]) });
      return { tables: ["profiles"], outcome: sentOk };
    case "notify.set":
      await rest.upsert(
        "notification_switches",
        [{ profile_id: userId, switches: record(p["switches"]) }],
        { onConflict: "profile_id" },
      );
      return { tables: ["notification_switches"], outcome: sentOk };
    case "brand.set":
      await rest.upsert(
        "brands",
        [
          {
            id: text(p["id"]),
            name: text(p["name"]),
            sells: text(p["sells"]),
            status: text(p["status"]),
          },
        ],
        { onConflict: "id" },
      );
      return { tables: ["brands"], outcome: sentOk };
    case "deal.step": {
      const step = p["step"];
      if (typeof step !== "number" || !Number.isInteger(step)) {
        throw new BadPayloadError();
      }
      await rest.patch("deals", eqFilter("id", text(p["id"])), { flow_step: step });
      return { tables: ["deals"], outcome: sentOk };
    }
    case "channel.edit": {
      const channelId = text(p["channelId"]);
      const field = text(p["field"]);
      if (!editableFields.includes(field)) {
        throw new BadPayloadError("bad_field");
      }
      // Base and next go as JSON values (jsonb on the server); a missing one is JSON null.
      const answer = await rest.rpc<unknown>("apply_channel_edit", {
        p_channel_id: channelId,
        p_field: field,
        p_base: p["base"] ?? null,
        p_new: p["next"] ?? null,
        p_force: false,
        p_label: typeof p["label"] === "string" ? p["label"] : null,
      });
      return {
        tables: ["channel_state"],
        outcome: editOutcome(answer, { table: "channel_state", key: channelId }),
      };
    }
    case "conflict.resolve": {
      const answer = await rest.rpc<unknown>("resolve_edit_conflict", {
        p_id: text(p["id"]),
        p_resolution: text(p["resolution"]),
        p_value: p["value"] ?? null,
      });
      return {
        tables: ["channel_state", "edit_conflicts"],
        outcome: resolveOutcome(answer, entry.target),
      };
    }
    case "activity.add":
      // Runs are sent by `sendLogRun`; a single one goes the same way.
      await rest.upsert("activity_log", [record(p["row"])], {
        onConflict: "id",
        ignoreDuplicates: true,
      });
      return { tables: ["activity_log"], outcome: sentOk };
  }
}

const knownKinds: ReadonlySet<string> = new Set<OutboxKind>([
  "profile.name",
  "activity.add",
  "notify.set",
  "channel.edit",
  "conflict.resolve",
  "brand.set",
  "deal.step",
]);

export function createUploader(o: {
  db: DatabaseSync;
  rest: UploadRest;
  userId: string;
  now: () => number;
  log: (line: string) => void;
}): { drain(): Promise<DrainResult> } {
  const { db, rest, userId, log } = o;

  function describe(entry: OutboxEntry): string {
    return `kind=${entry.kind} seq=${String(entry.seq)}`;
  }

  function drop(entries: readonly OutboxEntry[], code: string): void {
    inTransaction(db, () => {
      for (const entry of entries) {
        dropEntry(db, entry, code, o.now());
        if (entry.target !== null) {
          markRefetch(db, entry.target);
        }
      }
    });
    for (const entry of entries) {
      log(`upload.dropped ${describe(entry)} code=${code}`);
    }
  }

  function finish(entries: readonly OutboxEntry[], refetch?: { table: string; key: string }): void {
    inTransaction(db, () => {
      removeEntries(
        db,
        entries.map((entry) => entry.seq),
      );
      if (refetch !== undefined) {
        markRefetch(db, refetch);
      }
    });
  }

  return {
    async drain(): Promise<DrainResult> {
      let sent = 0;
      let dropped = 0;
      const tables = new Set<string>();
      let lastSeq = 0;

      const stop = (stoppedOn: Verdict): DrainResult => ({ sent, dropped, stoppedOn, tables });

      for (;;) {
        const first = head(db, userId);
        if (first === null) {
          return { sent, dropped, stoppedOn: null, tables };
        }
        if (first.seq <= lastSeq) {
          // The head didn't leave the outbox: never send the same entry twice in one drain.
          log(`upload.stalled ${describe(first)}`);
          return stop("retry");
        }

        if (!knownKinds.has(first.kind)) {
          // A newer build's entry: keep it (and everything behind it) for that build.
          noteFailure(db, first.seq, "unknown_kind");
          log(`upload.retry ${describe(first)} code=unknown_kind`);
          return stop("retry");
        }

        // A run of log rows goes in one request; any other kind goes alone.
        const run =
          first.kind === "activity.add"
            ? headRun(db, userId, "activity.add", logBatchMax)
            : [first];
        lastSeq = run[run.length - 1]?.seq ?? first.seq;

        let result: Sent;
        try {
          result = run.length > 1 ? await sendLogRun(run) : await send(rest, userId, first);
        } catch (error) {
          const code = failureCode(error);
          const verdict = error instanceof BadPayloadError ? "drop" : classifyUploadError(error);
          if (verdict === "drop") {
            if (run.length > 1) {
              // One refused line must not take the good ones with it: send them one at a time.
              const outcome = await sendOneByOne(run);
              sent += outcome.sent;
              dropped += outcome.dropped;
              if (outcome.sent > 0) {
                tables.add("activity_log");
              }
              if (outcome.stoppedOn !== null) {
                return stop(outcome.stoppedOn);
              }
              continue;
            }
            drop(run, code);
            dropped += run.length;
            continue;
          }
          if (verdict === "session") {
            log(`upload.session ${describe(first)} code=${code}`);
            return stop("session");
          }
          noteFailure(db, first.seq, code);
          log(`upload.retry ${describe(first)} code=${code}`);
          return stop("retry");
        }

        if (result.outcome.result === "retry") {
          noteFailure(db, first.seq, result.outcome.code);
          log(`upload.retry ${describe(first)} code=${result.outcome.code}`);
          return stop("retry");
        }
        finish(run, result.outcome.refetch);
        sent += run.length;
        for (const table of result.tables) {
          tables.add(table);
        }
        log(`upload.sent ${describe(first)} count=${String(run.length)}`);
      }
    },
  };

  async function sendLogRun(run: readonly OutboxEntry[]): Promise<Sent> {
    const rows = run.map((entry) => record(record(entry.payload)["row"]));
    await rest.upsert("activity_log", rows, { onConflict: "id", ignoreDuplicates: true });
    return { tables: ["activity_log"], outcome: sentOk };
  }

  /** After a refused run: each line alone, so only the refused ones drop. Stops as `drain` does. */
  async function sendOneByOne(
    run: readonly OutboxEntry[],
  ): Promise<{ sent: number; dropped: number; stoppedOn: Verdict | null }> {
    let sent = 0;
    let dropped = 0;
    for (const entry of run) {
      try {
        await send(rest, userId, entry);
      } catch (error) {
        const code = failureCode(error);
        const verdict = error instanceof BadPayloadError ? "drop" : classifyUploadError(error);
        if (verdict === "drop") {
          drop([entry], code);
          dropped += 1;
          continue;
        }
        if (verdict === "session") {
          log(`upload.session ${describe(entry)} code=${code}`);
          return { sent, dropped, stoppedOn: "session" };
        }
        noteFailure(db, entry.seq, code);
        log(`upload.retry ${describe(entry)} code=${code}`);
        return { sent, dropped, stoppedOn: "retry" };
      }
      finish([entry]);
      sent += 1;
      log(`upload.sent ${describe(entry)} count=1`);
    }
    return { sent, dropped, stoppedOn: null };
  }
}
