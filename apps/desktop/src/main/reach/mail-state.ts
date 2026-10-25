import { randomUUID } from "node:crypto";

import type { DataSource, MailboxCounts, MailboxView } from "@gratovo/core/data";
import {
  effectiveCap as capFor,
  mailboxStatus,
  rateOf,
  slowedNext,
  warmupDays,
} from "@gratovo/core/reach";

import type { JobOutcome } from "../pipeline/jobs";
import type { ResultData } from "../pipeline/protocol";
import { readMailRows, sameAddress, type MailboxRow } from "../settings/connections-store";

import { mailboxKey, noFlags, readMailboxFlags, writeMailboxFlags } from "./mailbox-settings";
import { mailboxStrings } from "./strings";

/**
 * The sending mailboxes as Reach sees them (plan step 6, D9, the 6a part). A view is built from
 * three things: the mailbox rows in `mail.settings` (the owner's cap and warm-up date), the last
 * `mail.status` answer for the account (connected, signed out, Gmail's count of today's sends),
 * and the app's own count of today's sends from `outreach_messages`, which is never older than the
 * status. Of the two counts the larger wins, so a send just made counts before Gmail is asked.
 *
 * It also holds the owner's pause and the slowdown state (the `reach.mailboxes` setting) and the
 * bounce and reply rates from the app's own messages (D20). After each refresh it applies the
 * slowdown rule: a mailbox whose bounces pass 3% is slowed, and the change is written to the
 * setting and to the activity log.
 *
 * Example data runs no job: every mailbox its `mail.settings` lists counts as connected, and the
 * counts are the app's own.
 */
export interface MailState {
  views(): MailboxView[];
  /**
   * Reads Gmail's numbers again (`mail.status`); one at a time. Then the slowdown rule runs on
   * the rates, whatever the status said.
   */
  refresh(): Promise<"ok" | "busy" | "no_mail" | "no_data">;
  /** A send finished: read the numbers again, after a status already running if one is. */
  afterSend(): void;
}

export interface MailStateDeps {
  mode(): "example" | "live" | null;
  source(): DataSource | null;
  /** A `mail.status` through the quick queue; null when no start could be built (no live data). */
  runStatus(): Promise<JobOutcome | null>;
  /** The addresses with a stored refresh token. */
  connected(): Promise<readonly string[]>;
  now?: () => number;
  newId?: () => string;
  log?: (line: string) => void;
}

const dayMs = 86_400_000;

type StatusAccount = ResultData<"mail.status">["accounts"][number];

interface Known {
  readonly connected: boolean;
  readonly signedOut: boolean;
  readonly sentToday: number | null;
  readonly checkedAt: number;
}

const key = mailboxKey;

/** The rates are counted again after this long (a refresh counts them again at once). */
const countsTtlMs = 30_000;

/** Local midnight of the day `at` falls on. */
export function localMidnight(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The warm-up day (1 = the start date), or null when none is set, it is over, or not started. */
export function warmupDay(startedOn: string | null, now: number): number | null {
  if (startedOn === null) {
    return null;
  }
  const [y, m, d] = startedOn.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    return null;
  }
  const start = new Date(y, m - 1, d).getTime();
  if (Number.isNaN(start)) {
    return null;
  }
  // Rounded: a day across a clock change is 23 or 25 hours long.
  const day = Math.round((localMidnight(now) - start) / dayMs) + 1;
  return day >= 1 && day <= warmupDays ? day : null;
}

export function createMailState(deps: MailStateDeps): MailState {
  const now = deps.now ?? Date.now;
  const log =
    deps.log ??
    ((line: string) => {
      console.info(line);
    });
  // The last status per account (lower case), and the addresses with a stored token.
  const known = new Map<string, Known>();
  let tokens = new Set<string>();
  let running = false;
  let again = false;
  const newId = deps.newId ?? randomUUID;
  // The message counts behind the rates; they change only when a message is stored.
  let counted: { at: number; counts: ReadonlyMap<string, MailboxCounts> } | null = null;

  function countsNow(source: DataSource): ReadonlyMap<string, MailboxCounts> {
    if (counted === null || now() - counted.at >= countsTtlMs || now() < counted.at) {
      counted = { at: now(), counts: source.outreach.mailboxCounts(now()) };
    }
    return counted.counts;
  }

  function ratesOf(
    counts: ReadonlyMap<string, MailboxCounts>,
    address: string,
  ): { bounceRate: number | null; replyRate: number | null } {
    const found = counts.get(key(address));
    return {
      bounceRate: found === undefined ? null : rateOf(found.bounced7, found.sent7),
      replyRate: found === undefined ? null : rateOf(found.replied30, found.firsts30),
    };
  }

  function view(
    row: MailboxRow,
    example: boolean,
    ours: number,
    flags: { paused: boolean; slowed: boolean },
    rates: { bounceRate: number | null; replyRate: number | null },
  ): MailboxView {
    const status = example ? undefined : known.get(key(row.address));
    const connected = example || (tokens.has(key(row.address)) && status?.connected !== false);
    const signedOut = !example && status?.signedOut === true;
    const day = warmupDay(row.warmupStartedOn, now());
    const effectiveCap = capFor(row.dailyCap, day !== null, flags.slowed);
    const sentToday = Math.max(ours, status?.sentToday ?? 0);
    return {
      address: row.address,
      connected,
      signedOut,
      dailyCap: row.dailyCap,
      effectiveCap,
      sentToday,
      leftToday: Math.max(0, effectiveCap - sentToday),
      warmup: day === null ? null : { day, of: warmupDays },
      paused: flags.paused,
      status: mailboxStatus({
        signedOut,
        paused: flags.paused,
        slowed: flags.slowed,
        warming: day !== null,
      }),
      ...rates,
      checkedAt: status?.checkedAt ?? null,
    };
  }

  function views(): MailboxView[] {
    const mode = deps.mode();
    const source = deps.source();
    if (mode === null || source === null) {
      return [];
    }
    const rows = readMailRows(source).mailboxes;
    if (rows.length === 0) {
      return [];
    }
    const sent = source.outreach.sentSince(localMidnight(now()));
    const flags = readMailboxFlags(source);
    const counts = countsNow(source);
    return rows.map((row) => {
      const ours = sent
        .filter((s) => sameAddress(s.mailbox, row.address))
        .reduce((total, s) => total + s.count, 0);
      return view(
        row,
        mode === "example",
        ours,
        flags.get(key(row.address)) ?? noFlags,
        ratesOf(counts, row.address),
      );
    });
  }

  function remember(account: StatusAccount, at: number): void {
    if (account.account === null) {
      return;
    }
    known.set(key(account.account), {
      connected: account.connected,
      signedOut: account.error?.code === "mail_auth",
      sentToday: account.limits?.sentToday ?? null,
      checkedAt: at,
    });
  }

  async function check(): Promise<"ok" | "no_mail" | "no_data"> {
    const mode = deps.mode();
    const source = deps.source();
    if (mode === null || source === null) {
      return "no_data";
    }
    const rows = readMailRows(source).mailboxes;
    if (rows.length === 0) {
      return "no_mail";
    }
    if (mode === "example") {
      return "ok";
    }
    tokens = new Set((await deps.connected()).map(key));
    if (!rows.some((row) => tokens.has(key(row.address)))) {
      return "no_mail";
    }
    const outcome = await deps.runStatus();
    if (outcome === null) {
      return "no_data";
    }
    if (!outcome.ok) {
      log(`Reach: the mailbox check couldn't start (${outcome.problem}).`);
      return "ok";
    }
    const exit = outcome.exit;
    if (exit.kind !== "ended") {
      log(`Reach: the mailbox check failed (${exit.reason}).`);
      return "ok";
    }
    if (exit.end.state !== "done" || exit.result?.kind !== "mail.status") {
      const code = exit.end.error?.code ?? exit.end.state;
      log(`Reach: the mailbox check ended without an answer (${code}).`);
      return code === "mail_not_connected" ? "no_mail" : "ok";
    }
    const at = now();
    for (const account of exit.result.data.accounts) {
      remember(account, at);
    }
    return "ok";
  }

  /**
   * The slowdown rule (D20): for each mailbox, the next state from its bounce rate. A change is
   * written to the setting and told in the activity log, once; no change writes nothing.
   */
  async function applySlowdown(source: DataSource): Promise<void> {
    counted = null;
    const counts = countsNow(source);
    for (const row of readMailRows(source).mailboxes) {
      const was = readMailboxFlags(source).get(key(row.address)) ?? noFlags;
      const { bounceRate } = ratesOf(counts, row.address);
      const slowed = slowedNext(was.slowed, bounceRate);
      if (slowed === was.slowed) {
        continue;
      }
      const name = row.address.split("@")[0] ?? row.address;
      const warming = warmupDay(row.warmupStartedOn, now()) !== null;
      // The line first: when it can't be written the flag stays, and the next refresh tries both
      // again, so a change is never made without its line (review of 6b).
      await source.write([
        {
          kind: "log.add",
          id: newId(),
          at: now(),
          text: slowed
            ? mailboxStrings.slowed(name, capFor(row.dailyCap, false, true), bounceRate ?? 0)
            : mailboxStrings.recovered(name, capFor(row.dailyCap, warming, false)),
          ref: null,
          action: null,
          detail: null,
        },
      ]);
      writeMailboxFlags(source, row.address, { ...was, slowed });
    }
  }

  async function refresh(): Promise<"ok" | "busy" | "no_mail" | "no_data"> {
    if (running) {
      return "busy";
    }
    running = true;
    try {
      const answer = await check();
      const source = deps.source();
      if (answer !== "no_data" && source !== null) {
        try {
          await applySlowdown(source);
        } catch {
          log("Reach: the slowdown check of the mailboxes failed.");
        }
      }
      return answer;
    } finally {
      running = false;
      if (again) {
        again = false;
        void refresh().catch(() => {
          log("Reach: the mailbox check after a send failed.");
        });
      }
    }
  }

  return {
    views,
    refresh,
    afterSend() {
      if (deps.mode() !== "live") {
        return;
      }
      if (running) {
        again = true;
        return;
      }
      void refresh().catch(() => {
        log("Reach: the mailbox check after a send failed.");
      });
    },
  };
}
