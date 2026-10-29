import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { checkAudience, kitView } from "@gratovo/core/close";
import type { InsightsLocal, InsightsLocalCreator, RejectReason } from "@gratovo/core/data";
import { creatorStageFrom, creatorStages, primaryEmail, rejectReasons } from "@gratovo/core/data";
import { goalSteps, readingKind, thresholds } from "@gratovo/core/insights";
import type {
  CatalogWeek,
  GoalSettings,
  GoalStep,
  HiddenAlerts,
  LogFact,
  MailboxFacts,
  MessageFact,
  StageEvent,
} from "@gratovo/core/insights";
import { effectiveCap, warmupDays } from "@gratovo/core/reach";

import { getSetting } from "./settings";

/**
 * What Insights reads from `gratovo.db` (plan step P8a, A8): the creators' local facts, the stage
 * events, the log lines about creators, the emails with their drafts' facts, the mailboxes and the
 * two Insights settings. One pass over each table; nothing is written here.
 */

export const goalSettingName = "insights.goal";
export const hiddenSettingName = "insights.hidden";

function num(value: SQLOutputValue | undefined): number {
  return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : 0;
}

function text(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** A stored ISO time (with or without a zone; no zone is UTC) as ms; null when it isn't one. */
function isoMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  let iso = value.trim().replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) {
    iso += "Z";
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------------------------
// Settings

/** The goal setting; anything damaged reads as the default (or drops that one override). */
export function goalFrom(raw: unknown): GoalSettings {
  const signs = isRecord(raw) ? raw["signsPerMonth"] : undefined;
  const signsPerMonth =
    typeof signs === "number" && Number.isInteger(signs) && signs >= 1 && signs <= 100
      ? signs
      : thresholds.signsPerMonth;
  const overrides: Partial<Record<GoalStep, number>> = {};
  const stored = isRecord(raw) ? raw["overrides"] : undefined;
  if (isRecord(stored)) {
    for (const step of goalSteps) {
      const rate = stored[step];
      if (typeof rate === "number" && rate > 0 && rate <= 1) {
        overrides[step] = rate;
      }
    }
  }
  return { signsPerMonth, overrides };
}

/** The hidden alerts: key → until (ms). Anything that is not a number is dropped. */
export function hiddenFrom(raw: unknown): HiddenAlerts {
  const out: Record<string, number> = {};
  if (isRecord(raw)) {
    for (const [key, until] of Object.entries(raw)) {
      if (typeof until === "number" && Number.isFinite(until)) {
        out[key] = until;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Creators

interface ContactFacts {
  readonly hasAddress: boolean;
  readonly confirmed: boolean;
  readonly source: InsightsLocalCreator["addressSource"];
}

/** The primary email's facts from the stored contacts. Bad JSON reads as no address. */
function contactFacts(json: string): ContactFacts {
  const primary = primaryEmail(json);
  if (primary === null) {
    return { hasAddress: false, confirmed: false, source: null };
  }
  const parsed = parseJson(json);
  const entry = (Array.isArray(parsed) ? (parsed as readonly unknown[]) : [])
    .filter(isRecord)
    .filter(
      (c) =>
        c["method"] === "email" && typeof c["value"] === "string" && c["value"].trim() === primary,
    )
    .sort((a, b) => Number(b["primary"] === true) - Number(a["primary"] === true))[0];
  const source = entry?.["source"];
  return {
    hasAddress: true,
    confirmed: entry?.["confirmed"] === true,
    source: source === "about" || source === "video" || source === "typed" ? source : "other",
  };
}

function readCreators(
  db: DatabaseSync,
  firstContact: ReadonlyMap<string, number>,
): InsightsLocalCreator[] {
  const rows = db
    .prepare(
      `SELECT s.channel_id, s.handle, s.vetting_status, s.pipeline_stage, s.creator_stage,
              s.contacts, s.manual_engagement_rate, s.media_kit, s.provided_data, s.updated_at,
              c.name
       FROM channel_state s LEFT JOIN channels c ON c.channel_id = s.channel_id
       ORDER BY s.rowid`,
    )
    .all();
  return rows.map((row) => {
    const id = String(row["channel_id"]);
    const contacts = contactFacts(String(row["contacts"]));
    const engagement = row["manual_engagement_rate"];
    const kit = kitView(
      parseJson(row["media_kit"]),
      parseJson(row["provided_data"]),
      typeof engagement === "number" ? engagement : null,
    );
    const audit =
      kit === null
        ? null
        : (Object.fromEntries(
            checkAudience(kit).rows.map((r) => [r.key, r.ok]),
          ) as InsightsLocalCreator["audit"]);
    const name = text(row["name"]);
    return {
      id,
      name: name === null || name === "" ? null : name,
      handle: String(row["handle"]),
      stage: creatorStageFrom({
        creatorStage: text(row["creator_stage"]),
        vettingStatus: String(row["vetting_status"]),
        pipelineStage: String(row["pipeline_stage"]),
      }),
      hasAddress: contacts.hasAddress,
      confirmedAt: contacts.confirmed ? (firstContact.get(id) ?? isoMs(row["updated_at"])) : null,
      addressSource: contacts.source,
      audit,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Events, log, messages, sequences

function readEvents(db: DatabaseSync): StageEvent[] {
  const known: readonly string[] = creatorStages;
  const events: StageEvent[] = [];
  for (const row of db
    .prepare("SELECT channel_id, stage, at FROM stage_events ORDER BY at, id")
    .all()) {
    const stage = String(row["stage"]);
    if (known.includes(stage)) {
      events.push({
        channelId: String(row["channel_id"]),
        stage: stage as StageEvent["stage"],
        at: num(row["at"]),
      });
    }
  }
  return events;
}

const logActions: Readonly<Record<string, LogFact["action"]>> = {
  "creator.shortlist": "shortlist",
  "creator.reject": "reject",
  "creator.restore": "restore",
  "creator.never": "never",
  "creator.allow": "allow",
};

function reasonIn(detail: unknown): RejectReason | null {
  const parsed = parseJson(detail);
  const reason = isRecord(parsed) ? parsed["reason"] : undefined;
  return rejectReasons.find((known) => known === reason) ?? null;
}

/** The lines about creators that an undo has not hidden (as `newestLog` reads them). */
function readLog(db: DatabaseSync): LogFact[] {
  const rows = db
    .prepare(
      `WITH hidden AS (
         SELECT line FROM (
           SELECT entity_id AS line, action,
                  ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY at_ms DESC, id DESC) AS n
           FROM activity_log
           WHERE entity_type = 'activity_log' AND action IN ('undo', 'redo')
         ) WHERE n = 1 AND action = 'undo'
       )
       SELECT entity_id, action, detail, at_ms, at FROM activity_log
       WHERE entity_type = 'channel' AND entity_id IS NOT NULL
         AND action IN ('creator.shortlist', 'creator.reject', 'creator.restore',
                        'creator.never', 'creator.allow')
         AND id NOT IN (SELECT line FROM hidden)
       ORDER BY at_ms, id`,
    )
    .all();
  const lines: LogFact[] = [];
  for (const row of rows) {
    const action = logActions[String(row["action"])];
    const at = typeof row["at_ms"] === "number" ? row["at_ms"] : isoMs(row["at"]);
    if (action === undefined || at === null) {
      continue;
    }
    lines.push({
      channelId: String(row["entity_id"]),
      action,
      at,
      reason: action === "reject" ? reasonIn(row["detail"]) : null,
    });
  }
  return lines;
}

/**
 * Whether an in-message is a bounce, as `outreach.ts` decides it: the reading says so, or it came
 * from a mail server's daemon address.
 */
function isBounce(replyType: string | null, peer: unknown): boolean {
  return (
    replyType === "any.bounce" ||
    (typeof peer === "string" && /^(?:mailer-daemon|postmaster)@/i.test(peer.trim()))
  );
}

function addressOf(value: SQLOutputValue | undefined): string | null {
  const address = text(value);
  return address === null || address.trim() === "" ? null : address.trim().toLowerCase();
}

function readMessages(db: DatabaseSync): MessageFact[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.channel_id, m.direction, m.kind, m.follow_up, m.at, m.mailbox, m.peer,
              m.reading, m.source, d.id AS draft_id, d.edited, d.steer
       FROM outreach_messages m LEFT JOIN outreach_drafts d ON d.id = m.draft_id
       ORDER BY m.at, m.rowid`,
    )
    .all();
  return rows.map((row): MessageFact => {
    const incoming = row["direction"] === "in";
    const kind = text(row["kind"]);
    let replyType: string | null = null;
    if (incoming) {
      const reading = parseJson(row["reading"]);
      const type = isRecord(reading) ? reading["replyType"] : undefined;
      replyType = typeof type === "string" ? type : null;
    }
    const bounce = incoming && isBounce(replyType, row["peer"]);
    const steer = parseJson(row["steer"]);
    const how = isRecord(steer) ? steer["how"] : undefined;
    const unknownDraft = incoming || row["draft_id"] === null || row["source"] === "imported";
    const messageKind = kind === "first" || kind === "followUp" || kind === "reply" ? kind : null;
    return {
      id: String(row["id"]),
      channelId: String(row["channel_id"]),
      direction: incoming ? "in" : "out",
      at: num(row["at"]),
      kind: incoming ? null : messageKind,
      followUp: !incoming && messageKind === "followUp" ? num(row["follow_up"]) : null,
      mailbox: addressOf(row["mailbox"]),
      reading: incoming ? readingKind(replyType, bounce) : null,
      bounce,
      edited: unknownDraft ? null : num(row["edited"]) === 1,
      rewrite: !incoming && typeof how === "string" && how.trim() !== "" ? how.trim() : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Mailboxes and weeks

/** A `YYYY-MM-DD` date as local midnight; null when it isn't one. */
function localDate(date: unknown): number | null {
  if (typeof date !== "string") {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (match === null) {
    return null;
  }
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isNaN(at) ? null : at;
}

/** The sending mailboxes with the owner's pause and the slowdown hold (`reach.mailboxes`). */
function readMailboxes(db: DatabaseSync): MailboxFacts[] {
  const settings = getSetting(db, "mail.settings");
  const list = isRecord(settings) ? settings["mailboxes"] : undefined;
  const flags = getSetting(db, "reach.mailboxes");
  const boxes: MailboxFacts[] = [];
  for (const item of Array.isArray(list) ? (list as readonly unknown[]) : []) {
    if (!isRecord(item) || typeof item["address"] !== "string") {
      continue;
    }
    const address = item["address"].trim().toLowerCase();
    const cap = item["dailyCap"];
    if (address === "" || typeof cap !== "number" || !Number.isFinite(cap) || cap < 0) {
      continue;
    }
    const entry = isRecord(flags) ? flags[address] : undefined;
    // A damaged entry reads as paused, as Reach reads it (a person may have paused it).
    const paused =
      entry === undefined ? false : isRecord(entry) ? flagOf(entry["paused"], true) : true;
    const slowed = isRecord(entry) && entry["slowed"] === true;
    const started = localDate(item["warmupStartedOn"]);
    boxes.push({
      address,
      dailyCap: cap,
      warmupStartedAt: started,
      warmupDays: started === null ? null : warmupDays,
      heldAt: slowed ? effectiveCap(cap, false, true) : null,
      paused,
    });
  }
  return boxes;
}

/** A stored flag: missing is false, a boolean is itself, anything else is `otherwise`. */
function flagOf(value: unknown, otherwise: boolean): boolean {
  return value === undefined ? false : typeof value === "boolean" ? value : otherwise;
}

function readWeeks(db: DatabaseSync): CatalogWeek[] {
  const weeks: CatalogWeek[] = [];
  for (const row of db
    .prepare("SELECT week, live, waiting, archive FROM catalog_weeks ORDER BY week")
    .all()) {
    const at = localDate(row["week"]);
    if (at !== null) {
      weeks.push({
        at,
        live: num(row["live"]),
        waiting: num(row["waiting"]),
        archive: num(row["archive"]),
      });
    }
  }
  return weeks;
}

// ---------------------------------------------------------------------------------------------

/** Everything Insights reads from the local database, in one pass per table. */
export function readInsightsLocal(db: DatabaseSync): InsightsLocal {
  const events = readEvents(db);
  const firstContact = new Map<string, number>();
  for (const event of events) {
    if (event.stage === "contact" && !firstContact.has(event.channelId)) {
      firstContact.set(event.channelId, event.at);
    }
  }
  return {
    creators: readCreators(db, firstContact),
    events,
    log: readLog(db),
    messages: readMessages(db),
    inSequence: db
      .prepare("SELECT channel_id FROM outreach_sequences WHERE stopped IS NULL")
      .all()
      .map((row) => String(row["channel_id"])),
    mailboxes: readMailboxes(db),
    weeks: readWeeks(db),
    goal: goalFrom(getSetting(db, goalSettingName)),
    hidden: hiddenFrom(getSetting(db, hiddenSettingName)),
  };
}
