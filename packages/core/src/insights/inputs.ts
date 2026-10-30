import type { AudienceKey } from "../close/audience";
import type { CreatorStage, RejectReason } from "../data/types";
import type { BrandStatus } from "../data/work-types";

import type { GoalSettings, HiddenAlerts, ReadingKind } from "./types";

/**
 * What the Insights reports are worked out from (plan step P8a). Main reads it from `gratovo.db`
 * and `pipeline.db` in one pass per report (`apps/desktop/src/main/insights/`), and the pure
 * functions in this folder turn it into an `InsightsReport`. Live and waiting channels come as rows
 * (thousands); the archive comes as totals worked out in SQL, because it holds hundreds of
 * thousands (design rule 12). Times are ms; "not known" is null, never 0.
 */

/** A channel in the catalog (live or waiting to be archived), or a creator with a state. */
export interface ChannelFacts {
  readonly id: string;
  readonly name: string;
  readonly handle: string | null;
  /** The app's stage; null for a found channel nobody has reviewed. */
  readonly stage: CreatorStage | null;
  /** Whether the channel is in `pipeline.db` `channels` (false: a state with no catalog row). */
  readonly inCatalog: boolean;
  /** When a search first found it (`channels.first_seen_at`). */
  readonly foundAt: number | null;
  /** Every keyword that found it, earliest first. */
  readonly keywords: readonly string[];
  readonly medianViews: number | null;
  readonly uploads30: number | null;
  readonly subscribers: number | null;
  readonly country: string | null;
  /** Sponsors seen on its videos; null when its videos were never read. */
  readonly sponsored: boolean | null;
  /** The fit score (`fitScore` in `find/fit.ts`), worked out by main from the catalog item. */
  readonly fit: number;
  /** "ok": its numbers were read; else why not (step 5d-2). */
  readonly read: "ok" | "notRead" | "retrying" | "gaveUp";
  /** Any address found for it. */
  readonly hasAddress: boolean;
  readonly confirmedAt: number | null;
  /** Where the confirmed (or best) address came from. */
  readonly addressSource: "about" | "video" | "typed" | "other" | null;
  readonly rejectReason: RejectReason | null;
  readonly rejectedAt: number | null;
  /** When it leaves for good (`archiveDate`); null for a reject with no date, or not rejected. */
  readonly leavesAt: number | null;
  /** The audience check's rows when a kit is in; null before. */
  readonly audit: Readonly<Record<AudienceKey, boolean | null>> | null;
}

/** One stage change (`stage_events`). */
export interface StageEvent {
  readonly channelId: string;
  readonly stage: CreatorStage;
  readonly at: number;
}

/** A shortlist, reject, bring back or never-contact line from the log, about a creator. */
export interface LogFact {
  readonly channelId: string;
  readonly action: "shortlist" | "reject" | "restore" | "never" | "allow";
  readonly at: number;
  /** A reject's reason; null otherwise or when not known. */
  readonly reason: RejectReason | null;
}

/** One email in or out (`outreach_messages`, with its draft's facts). */
export interface MessageFact {
  readonly id: string;
  readonly channelId: string;
  readonly direction: "in" | "out";
  readonly at: number;
  /** Out: first email or follow-up; in: null. Answers to replies are `reply`. */
  readonly kind: "first" | "followUp" | "reply" | null;
  /** 1 to 3 for a follow-up, else null. */
  readonly followUp: number | null;
  readonly mailbox: string | null;
  /** In: what the reply says (`readingKind`); null until read. */
  readonly reading: ReadingKind | null;
  readonly bounce: boolean;
  /** Out: whether a person edited the draft before sending; null when not known (imported). */
  readonly edited: boolean | null;
  /** Out: the rewrite used (Shorter, Warmer, More direct, New angle), or null. */
  readonly rewrite: string | null;
}

export interface MailboxFacts {
  readonly address: string;
  readonly dailyCap: number;
  readonly warmupStartedAt: number | null;
  readonly warmupDays: number | null;
  /** The slowdown rule's hold (20 a day), or null. */
  readonly heldAt: number | null;
  readonly paused: boolean;
}

export interface KeywordFacts {
  readonly keyword: string;
  /** Every channel it found, live, waiting and archived (from the links and the tombstones). */
  readonly found: number;
  /** Of those, archived by the rules (never passed them). */
  readonly sweptByRules: number;
  /** Its last run: channels new to us, already live, already archived; null when never run. */
  readonly lastRun: {
    readonly at: number;
    readonly fresh: number;
    readonly live: number;
    readonly archived: number;
  } | null;
}

/** The archive as totals (`channel_archive`, worked out in SQL). */
export interface ArchiveFacts {
  readonly total: number;
  /** Tombstones whose label is a rule's (not "rejected"). */
  readonly byRules: number;
  readonly byPerson: number;
  readonly ruleLabels: readonly { readonly label: string; readonly count: number }[];
  /** People's rejects by the reason in their last reject line. */
  readonly personReasons: readonly {
    readonly reason: RejectReason | "unknown";
    readonly count: number;
  }[];
  /** Archived per week (Monday), all and by the rules, for the last 13 weeks, oldest first. */
  readonly weekly: readonly {
    readonly at: number;
    readonly all: number;
    readonly byRules: number;
  }[];
  /** Archived channels a search found again in the last 7 days (`archive_keyword_pending`). */
  readonly refoundThisWeek: number;
  /** The usual tombstone of each kind; null where tombstones never had it. */
  readonly person: ArchiveProfile;
  readonly rules: ArchiveProfile;
}

export interface ArchiveProfile {
  readonly medianViews: number | null;
  readonly uploads30: number | null;
  readonly subscribers: number | null;
  /** Shares as n of d; null when not known for this group. */
  readonly sponsored: { readonly n: number; readonly d: number } | null;
  readonly inMarkets: { readonly n: number; readonly d: number } | null;
  readonly addressFound: { readonly n: number; readonly d: number } | null;
}

/** Totals at the end of a week, written by the sweep (`catalog_weeks`). */
export interface CatalogWeek {
  /** The Monday (local) the week starts. */
  readonly at: number;
  readonly live: number;
  readonly waiting: number;
  readonly archive: number;
}

/**
 * A deal, as the money reports need it (plan step P8b). Amounts are whole dollars; for a viewer who
 * doesn't see money main never builds a money report, and passes the amounts as null.
 */
export interface DealFact {
  readonly id: string;
  readonly brandId: string;
  readonly creatorId: string;
  /** An index into DEAL_FLOW. */
  readonly step: number;
  readonly price: number | null;
  readonly payout: number | null;
  readonly createdAt: number | null;
  readonly goLiveAt: number | null;
  readonly invoiceSentAt: number | null;
  readonly invoiceDueAt: number | null;
  readonly invoicePaidAt: number | null;
  readonly paidCreatorAt: number | null;
  /** Views at 30 days (the 30-day report); null before it. */
  readonly reportViews: number | null;
  /** The creator's usual views when the deal was made (the report's target); null when not known. */
  readonly usualViews: number | null;
  /** The 30-day report went out. */
  readonly reportSentAt: number | null;
}

/** A brand, as the brand funnel needs it. */
export interface BrandFact {
  readonly id: string;
  readonly name: string;
  readonly status: BrandStatus;
  /** When it was added; null when not known. */
  readonly since: number | null;
}

/** One deal step change (`deal_events`, migration 0009). */
export interface DealEvent {
  readonly dealId: string;
  readonly step: number;
  readonly at: number;
}

/** One brand status change (`brand_events`, migration 0009). */
export interface BrandEvent {
  readonly brandId: string;
  readonly status: BrandStatus;
  readonly at: number;
}

export interface InsightsInputs {
  readonly now: number;
  /** The owner's archive days (Settings › Search rules). */
  readonly archiveDays: number;
  readonly channels: readonly ChannelFacts[];
  readonly events: readonly StageEvent[];
  readonly log: readonly LogFact[];
  readonly messages: readonly MessageFact[];
  /** Creators whose follow-ups still run (no stop, not finished). */
  readonly inSequence: readonly string[];
  readonly mailboxes: readonly MailboxFacts[];
  readonly keywords: readonly KeywordFacts[];
  readonly archive: ArchiveFacts;
  readonly weeks: readonly CatalogWeek[];
  /** Start times of the search runs, newest first. */
  readonly runs: readonly number[];
  readonly goal: GoalSettings;
  readonly hidden: HiddenAlerts;
  /** Every deal (P8b). */
  readonly deals: readonly DealFact[];
  /** Every brand (P8b). */
  readonly brands: readonly BrandFact[];
  readonly dealEvents: readonly DealEvent[];
  readonly brandEvents: readonly BrandEvent[];
  /** Whether the viewer sees money: without it no money report, line, alert or win is made. */
  readonly seesMoney: boolean;
  /** The least margin a deal may have, in % of its price (Settings › Agency facts). */
  readonly marginFloorPct: number;
}
