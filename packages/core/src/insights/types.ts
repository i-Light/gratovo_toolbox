import type { RejectReason } from "../data/types";
import type { AudienceKey } from "../close/audience";

/**
 * Insights (plan step P, part P8a; docs/product/insights-design.md). The report main works out for
 * one tab and period, and the pieces the rules in this folder return. Pure data: numbers, times in
 * ms and keys. No words: every sentence is made in the renderer's strings file from these facts,
 * so the rules that choose a sentence are tested here and the words stay in one place.
 *
 * P8a builds every tab but Money, without deals or money. P8b adds Money, Funnel › Brands and the
 * deal and money parts (the steps, alerts and levers marked "P8b" below).
 */

// ---------------------------------------------------------------------------------------------
// Keys

export const insightsTabs = ["overview", "funnel", "emails", "search", "money", "goal"] as const;
export type InsightsTab = (typeof insightsTabs)[number];

/** The tabs P8a reports on; `money` comes with P8b. */
export const reportTabs = ["overview", "funnel", "emails", "search", "money", "goal"] as const;
export type ReportTab = (typeof reportTabs)[number];

/** The period switch. Each is compared with the span of the same length just before it. */
export const periods = ["7d", "30d", "90d", "month"] as const;
export type Period = (typeof periods)[number];

/** Search's four views of the catalog (design 3.4). It opens on `live`. */
export const searchViews = ["live", "waiting", "archive", "everything"] as const;
export type SearchView = (typeof searchViews)[number];

/** On track, Watch, Act now, Too early to tell (design rule 2). */
export const verdicts = ["good", "watch", "act", "early"] as const;
export type Verdict = (typeof verdicts)[number];

/** A two-group comparison (design rule 5): a clear difference, could be chance, or too few. */
export type Difference = "clear" | "chance" | "early";

// ---------------------------------------------------------------------------------------------
// Small shapes

/** A rate with its count: `n` of `d`. Its value is n / d; `d` = 0 has none. */
export interface Ratio {
  readonly n: number;
  readonly d: number;
}

/** A span of time in ms: `from` included, `to` not. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/** The period asked for, and the one before it. */
export interface ReportWindow {
  readonly period: Period;
  /** The time the report was worked out. */
  readonly now: number;
  readonly current: Span;
  readonly previous: Span;
  /** Working days (Monday to Friday) in `current`, at least 1. */
  readonly workingDays: number;
}

/** One point of a series: the start of its day or week (local time), and its value. */
export interface Point {
  readonly at: number;
  /** Null: not known for that day or week (never shown as 0). */
  readonly value: number | null;
}

// ---------------------------------------------------------------------------------------------
// Where a number leads (design rule 4: a number opens the records behind it)

/**
 * The records behind a number. `insights:list` returns them, counted by the same query that counted
 * the number, so a number and its list always agree (design rule 8).
 */
export type Drill =
  | { readonly kind: "step"; readonly step: CreatorStep }
  | { readonly kind: "stuck"; readonly step: CreatorStep }
  | { readonly kind: "keyword"; readonly keyword: string }
  | { readonly kind: "live"; readonly group: LiveGroup }
  /** Rejected channels leaving on day `day` (0 = tomorrow ... 6). */
  | { readonly kind: "leaving"; readonly day: number }
  | { readonly kind: "mistakes" }
  | { readonly kind: "undated" }
  | { readonly kind: "rejected"; readonly reason: RejectReason | "unknown" }
  | { readonly kind: "secondLook"; readonly reason: RejectReason | "unknown" }
  /** Creators with a confirmed address not yet emailed. */
  | { readonly kind: "fuel" }
  /** Shortlisted creators whose address waits to be confirmed. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "repliesWaiting" }
  | {
      readonly kind: "unreadable";
      readonly which: "notRead" | "retrying" | "gaveUp" | "noCountry";
    }
  // P8b: brands and deals. Their rows open a brand or deal record (`DrillRow.record`).
  | { readonly kind: "brandStep"; readonly step: BrandStep }
  | { readonly kind: "brandStuck"; readonly step: BrandStep }
  /** Deals whose invoice is past due (money viewers only). */
  | { readonly kind: "lateInvoices" }
  /** Deals whose brand has paid and whose creator hasn't been (money viewers only). */
  | { readonly kind: "payoutsDue" }
  /** Deals at `step` for more than twice the usual time there; every stuck deal when null. */
  | { readonly kind: "stuckDeals"; readonly step: number | null }
  /** Deals under the margin floor in the last 90 days (money viewers only). */
  | { readonly kind: "underFloor" }
  /** Signed creators with no deal in `thresholds.idleDays`. */
  | { readonly kind: "idleCreators" }
  /** Finished 30-day reports with no next deal for that brand. */
  | { readonly kind: "noNextDeal" };

/** Where a button goes. `route` is checked against the live gate by the renderer. */
export type InsightsGo =
  | { readonly kind: "route"; readonly screen: string; readonly tab: string | null }
  | { readonly kind: "insights"; readonly tab: InsightsTab; readonly view: SearchView | null }
  | { readonly kind: "drill"; readonly drill: Drill };

/**
 * The short fact on a drill row: a waiting channel's reject reason, a live channel's fit, or that
 * the record is counted (its history is kept) but is no longer in the list. Worded in the renderer.
 */
export type DrillNote =
  | { readonly kind: "reason"; readonly reason: RejectReason | "unknown" }
  | { readonly kind: "fit"; readonly fit: number }
  | { readonly kind: "gone" }
  /** A deal's amount (late invoice, payout due) and how many days it waits. */
  | { readonly kind: "money"; readonly amount: number; readonly days: number | null }
  /** Days at a step (stuck deals and brands), or since the last deal (idle creators). */
  | { readonly kind: "days"; readonly days: number }
  /** A deal's margin, 0 to 1. */
  | { readonly kind: "margin"; readonly margin: number };

/** One record in a drill-down list. */
export interface DrillRow {
  /** The record's id; the row opens it, unless the note is `gone`. */
  readonly id: string;
  /** Which record the id names (P8b); a creator when absent. */
  readonly record?: "creator" | "brand" | "deal";
  /** The channel's name; the id when the record is gone. */
  readonly name: string;
  readonly handle: string | null;
  readonly note: DrillNote | null;
}

// ---------------------------------------------------------------------------------------------
// The creator funnel

/** Found → … → Signed → First deal → First payout (design 3.2). */
export const creatorSteps = [
  "found",
  "passed",
  "shortlisted",
  "confirmed",
  "emailed",
  "replied",
  "interested",
  "kit",
  "audience",
  "signed",
  "firstDeal",
  "firstPayout",
] as const;
export type CreatorStep = (typeof creatorSteps)[number];

export interface FunnelRow {
  readonly step: CreatorStep;
  readonly count: number;
  /** The share that made it from the step above; null for `found`. */
  readonly fromPrev: Ratio | null;
  /** The same share in the previous period; null when not known. */
  readonly before: Ratio | null;
  /** The usual (median) days at this step; null when fewer than 5 are known. */
  readonly medianDays: number | null;
  /** In the step for more than twice the usual time; null where it doesn't apply. */
  readonly stuck: number | null;
  /** True for `passed`: the rules drop most finds on purpose. */
  readonly byDesign: boolean;
}

/** Why a "replied, but said no" reply said no. */
export const noKinds = ["notNow", "notInterested", "manager", "money"] as const;
export type NoKind = (typeof noKinds)[number];

export interface FunnelExits {
  readonly triage: readonly { readonly reason: RejectReason | "unknown"; readonly count: number }[];
  readonly saidNo: readonly { readonly kind: NoKind; readonly count: number }[];
  readonly audience: readonly { readonly check: AudienceKey; readonly count: number }[];
  /** Never answered after the last follow-up. */
  readonly noAnswer: number;
  /** Still in their sequence (not an exit yet). */
  readonly stillInSequence: number;
  readonly bounced: number;
}

/** One week of first emails: the share that replied by day 3, 7, 14 and 30. */
export interface CohortRow {
  /** The Monday the week starts. */
  readonly week: number;
  readonly emailed: number;
  /** In order 3, 7, 14, 30; null where the week is too recent to have reached that day. */
  readonly by: readonly (Ratio | null)[];
}

/** The brand funnel's steps (design 3.2, Brands). */
export const brandSteps = [
  "found",
  "qualified",
  "pitched",
  "replied",
  "negotiating",
  "won",
  "live",
  "paid",
] as const;
export type BrandStep = (typeof brandSteps)[number];

export interface BrandFunnelRow {
  readonly step: BrandStep;
  readonly count: number;
  readonly fromPrev: Ratio | null;
  readonly before: Ratio | null;
  readonly medianDays: number | null;
  readonly stuck: number | null;
}

export interface BrandFunnel {
  /** Everyone so far, Found to Paid. */
  readonly rows: readonly BrandFunnelRow[];
  /** The biggest drop after Found, or null. */
  readonly biggestDrop: BrandStep | null;
  /** Brands marked "Not a fit", by the last step they reached. */
  readonly lost: readonly { readonly step: BrandStep; readonly count: number }[];
}

export interface FunnelReport {
  readonly tab: "funnel";
  readonly window: ReportWindow;
  /** Everyone so far. */
  readonly everyone: readonly FunnelRow[];
  /** Only those emailed in the period, followed forward (a cohort). */
  readonly cohort: readonly FunnelRow[];
  /** The biggest drop a person controls (never `passed`), or null. */
  readonly biggestDrop: CreatorStep | null;
  readonly exits: FunnelExits;
  /** Median days between steps, in step order; null when fewer than 5 are known. */
  readonly stepDays: readonly {
    readonly from: CreatorStep;
    readonly to: CreatorStep;
    readonly days: number | null;
  }[];
  /** Newest week first, at most 12. */
  readonly cohorts: readonly CohortRow[];
  /** Whether the recent weeks are clearly worse than the older ones. */
  readonly cohortTrend: Difference;
  /** The brand funnel (P8b). */
  readonly brands: BrandFunnel;
}

// ---------------------------------------------------------------------------------------------
// Emails

/** What Gemini (or a person, "That's not it") read in a reply (design 3.3). */
export const readingKinds = [
  "interested",
  "question",
  "rate",
  "notNow",
  "no",
  "manager",
  "auto",
  "bounce",
  "other",
] as const;
export type ReadingKind = (typeof readingKinds)[number];
/** The kinds that count as a way forward (the positive reply rate). */
export const positiveReadings: readonly ReadingKind[] = ["interested", "question", "rate"];

/** The batch diagnosis (design 3.3, three plain rules). */
export const diagnoses = ["early", "delivery", "writing", "targeting", "healthy"] as const;
export type Diagnosis = (typeof diagnoses)[number];

export interface Batch {
  /** 1 is the oldest batch. */
  readonly index: number;
  readonly from: number;
  readonly to: number;
  /** First emails in the batch, at most 50. */
  readonly sent: number;
  readonly bounced: number;
  readonly replied: number;
  readonly positive: number;
  readonly signed: number;
  readonly diagnosis: Diagnosis;
  /** When the bounces mostly come from one mailbox, that mailbox. */
  readonly bounceMailbox: string | null;
}

export const patternKinds = [
  "edited",
  "rewrite",
  "size",
  "country",
  "keyword",
  "weekday",
  "hour",
] as const;
export type PatternKind = (typeof patternKinds)[number];

/** One split of the reply rate of first emails (design 3.3 item 6). */
export interface PatternSplit {
  readonly kind: PatternKind;
  /** Group keys: "edited"/"asWritten", a rewrite name, a size band, a country code, a keyword… */
  readonly groups: readonly { readonly key: string; readonly rate: Ratio }[];
  readonly result: Difference;
  /** The better group when the result is clear. */
  readonly best: string | null;
}

export interface MailboxRow {
  readonly address: string;
  /** Day of the warm-up (1-based), or null when warmed up. */
  readonly warmupDay: number | null;
  readonly warmupDays: number | null;
  /** The daily limit the slowdown rule holds it at, or null. */
  readonly heldAt: number | null;
  /** Last 7 days. */
  readonly sent: number;
  /** What the mailbox allowed over the same 7 days. */
  readonly room: number;
  /** Last 7 days. */
  readonly bounced: Ratio;
  /** Last 30 days' first emails. */
  readonly replies: Ratio;
  readonly verdict: Verdict;
}

export interface EmailsReport {
  readonly tab: "emails";
  readonly window: ReportWindow;
  /** One per day of the period, oldest first; the last is today so far. */
  readonly daily: readonly {
    readonly at: number;
    readonly sent: number;
    readonly replies: number;
  }[];
  readonly sent: number;
  /** The reply rate of emails: replies ÷ emails sent (design rule 10). */
  readonly rate: Ratio;
  readonly rateBefore: Ratio;
  readonly rateVerdict: Verdict;
  /** Last 90 days: the first email (step 0) and follow-ups 1 to 3. */
  readonly bySteps: readonly {
    readonly step: number;
    readonly rate: Ratio;
    /** This step's share of all replies. */
    readonly share: Ratio;
  }[];
  /** Last 90 days, in `readingKinds` order, bounces left out. */
  readonly readings: readonly { readonly kind: ReadingKind; readonly count: number }[];
  readonly positive: Ratio;
  /** Newest first, at most 12. */
  readonly batches: readonly Batch[];
  /** Clearest first; only splits with enough emails. */
  readonly patterns: readonly PatternSplit[];
  readonly answer: {
    /** Median hours from a creator's reply to our answer, last 30 days. */
    readonly medianHours: number | null;
    readonly overDay: number;
    readonly verdict: Verdict;
  };
  readonly mailboxes: readonly MailboxRow[];
  /** Sent against room over the last 7 days, all mailboxes. */
  readonly capacity: Ratio;
}

// ---------------------------------------------------------------------------------------------
// Search (design 3.4)

/** The Live band's steps and set-aside groups. */
export const liveGroups = [
  "notReviewed",
  "shortlisted",
  "outreach",
  "signed",
  "parked",
  "never",
] as const;
export type LiveGroup = (typeof liveGroups)[number];

export const keywordVerdicts = ["keep", "watch", "drop", "early"] as const;
export type KeywordVerdict = (typeof keywordVerdicts)[number];

export interface KeywordRow {
  readonly keyword: string;
  /** Every channel the keyword ever found, live, waiting and archived. */
  readonly found: number;
  /** Kept per 1,000 found: channels that passed the rules and a person's review, of `found`. */
  readonly kept: Ratio;
  readonly live: number;
  readonly emailed: number;
  readonly replied: number;
  readonly signed: number;
  readonly verdict: KeywordVerdict;
  /** Why it is not `keep`: worn out (its last run mostly known), nobody answers, too few emailed. */
  readonly why: "wornOut" | "noAnswers" | "tooFew" | null;
  /** Its last run: channels new to us, already live, already archived. */
  readonly lastRun: {
    readonly at: number;
    readonly fresh: number;
    readonly live: number;
    readonly archived: number;
  } | null;
}

/** A rejected channel still waiting whose fit is 85 or more (design 3.4). */
export interface Mistake {
  readonly id: string;
  readonly name: string;
  readonly handle: string | null;
  readonly reason: RejectReason | "unknown";
  readonly fit: number;
  readonly medianViews: number | null;
  /** When it leaves for good. */
  readonly leavesAt: number;
}

/** The usual channel in one group (Archive's last panel). Null: not known for that group. */
export interface GroupProfile {
  readonly group: "live" | "waiting" | "person" | "rules";
  readonly medianViews: number | null;
  readonly uploads30: number | null;
  readonly subscribers: number | null;
  readonly sponsored: Ratio | null;
  readonly inMarkets: Ratio | null;
  readonly addressFound: Ratio | null;
}

export interface SearchReport {
  readonly tab: "search";
  readonly window: ReportWindow;
  readonly counts: {
    readonly live: number;
    readonly waiting: number;
    readonly archive: number;
    /** live + waiting + archive. */
    readonly everything: number;
  };
  /** Live, to be archived and the archive at the end of each of the last 12 weeks, oldest first. */
  readonly weeks: readonly {
    readonly at: number;
    readonly live: number | null;
    readonly waiting: number | null;
    readonly archive: number | null;
  }[];
  /** Every keyword, most live channels first (the screen shows 6). */
  readonly keywords: readonly KeywordRow[];
  readonly live: {
    readonly groups: Readonly<Record<LiveGroup, number>>;
    readonly joinedThisWeek: number;
    readonly leftThisWeek: number;
    /** Last 12 weeks, oldest first. */
    readonly weekly: readonly {
      readonly at: number;
      readonly joined: number;
      readonly left: number;
    }[];
    readonly backlog: {
      readonly count: number;
      readonly oldestAt: number | null;
      /** Last 14 days, per day: new finds that passed the rules, and channels a person reviewed. */
      readonly foundPerDay: number;
      readonly reviewedPerDay: number;
      /** Days of reviewing the backlog holds at your pace; null when nothing was reviewed. */
      readonly days: number | null;
      readonly verdict: Verdict;
    };
    readonly addresses: {
      /** Shortlisted in the last 30 days. */
      readonly shortlisted: number;
      readonly found: Ratio;
      readonly confirmed: Ratio;
      readonly sources: {
        readonly about: number;
        readonly video: number;
        readonly typed: number;
        readonly other: number;
      };
      readonly medianDaysToConfirm: number | null;
      readonly waiting: number;
    };
    readonly trust: {
      readonly notRead: number;
      readonly retrying: number;
      readonly gaveUp: number;
      readonly noCountry: number;
    };
  };
  readonly waiting: {
    /** Rejected with a date: they leave on their own. */
    readonly dated: number;
    /** Rejected before dates were kept: never swept. */
    readonly undated: number;
    /** Leaving on each of the next 7 days, tomorrow first. */
    readonly leaving: readonly { readonly at: number; readonly count: number }[];
    readonly mistakes: {
      readonly total: number;
      readonly tomorrow: number;
      /** Highest fit first, at most 50. */
      readonly top: readonly Mistake[];
    };
    readonly reasons: readonly {
      readonly reason: RejectReason | "unknown";
      readonly count: number;
    }[];
    /** The keywords behind the top reason, most first, at most 3. */
    readonly topReasonKeywords: readonly { readonly keyword: string; readonly count: number }[];
    /** Brought back in the last 90 days, by why they had left. */
    readonly secondLooks: readonly {
      readonly reason: RejectReason | "unknown";
      readonly back: number;
      readonly emailed: number;
      readonly replied: number;
      readonly signed: number;
    }[];
  };
  readonly archive: {
    readonly byRules: number;
    readonly byPerson: number;
    /** The rules' sweeps by the tombstone's label, most first. */
    readonly ruleLabels: readonly { readonly label: string; readonly count: number }[];
    readonly personReasons: readonly {
      readonly reason: RejectReason | "unknown";
      readonly count: number;
    }[];
    /** Archived channels a search found again in the last 7 days (wasted results). */
    readonly refoundThisWeek: number;
    /** Brought back in the last 30 days, and how many of those replied since. */
    readonly broughtBack: Ratio;
    /** Average a week over the last 12 weeks: all, and by the rules. */
    readonly growthPerWeek: number;
    readonly growthByRulesPerWeek: number;
    readonly profiles: readonly GroupProfile[];
  };
  readonly everything: {
    readonly found: number;
    readonly swept: number;
    readonly passed: number;
    readonly rejectedWaiting: number;
    readonly rejectedArchived: number;
    readonly live: number;
  };
}

// ---------------------------------------------------------------------------------------------
// Money (design 3.5, P8b; money viewers only)

/** Unpaid invoices by age, all Net 30. */
export const owedBuckets = ["notDue", "late30", "late60", "over60"] as const;
export type OwedBucket = (typeof owedBuckets)[number];

export interface MoneyMonth {
  /** The 1st of the month, 00:00 local. */
  readonly month: number;
  /** What brands paid the agency that month (gross). */
  readonly paid: number;
  /** What the agency kept of it (price less the creator's payout). */
  readonly net: number;
  /**
   * The current month only: where `paid` ends at this pace; null for past months, and for a month
   * too young for its pace to say anything (before `paceMinDays` working days).
   */
  readonly projected: number | null;
}

export interface MoneyReport {
  readonly tab: "money";
  readonly window: ReportWindow;
  /** The name of every creator and brand id this report mentions (the frame holds only some). */
  readonly names: Readonly<Record<string, string>>;
  /** Six months, oldest first; the last is the current one. */
  readonly months: readonly MoneyMonth[];
  /** The goal as brand payments: the net goal over the usual margin; null without a money goal. */
  readonly goalPaid: number | null;
  /** The net goal a month; null when none is set. */
  readonly goalNet: number | null;
  /** The usual margin behind `goalPaid`, 0 to 1; null when not known. */
  readonly usualMargin: number | null;
  readonly paceVerdict: Verdict;
  readonly owed: {
    readonly buckets: readonly {
      readonly bucket: OwedBucket;
      readonly amount: number;
      readonly count: number;
    }[];
    /** Late invoices, most days late first, at most 10. */
    readonly late: readonly {
      readonly dealId: string;
      readonly amount: number;
      readonly daysLate: number;
    }[];
    /** Median days from invoice to payment, by brand (paid invoices); `unpaid` when it never paid. */
    readonly payDays: readonly {
      readonly brandId: string;
      readonly days: number | null;
      readonly unpaid: boolean;
    }[];
    readonly verdict: Verdict;
  };
  readonly payouts: {
    /** The brand paid; the creator hasn't been. Oldest payment first. */
    readonly due: readonly {
      readonly dealId: string;
      readonly amount: number;
      readonly brandPaidAt: number;
    }[];
    readonly dueTotal: number;
    /** Waiting on the brand. */
    readonly locked: number;
    readonly lockedCount: number;
  };
  readonly margin: {
    /** The average margin over the last 90 days' deals, 0 to 1; null when none. */
    readonly average: number | null;
    /** The floor, 0 to 1. */
    readonly floor: number;
    readonly under: readonly { readonly dealId: string; readonly margin: number }[];
    readonly verdict: Verdict;
  };
  readonly dealSize: {
    /** The average price of the last 90 days' deals; null when none. */
    readonly average: number | null;
    /** The same over the 90 days before; null when none. */
    readonly before: number | null;
    /** Price per 1,000 of the creators' usual views; null when not known. */
    readonly per1000: number | null;
    /** The average price by month, oldest first, as `months`. */
    readonly trend: readonly Point[];
  };
  readonly basket: {
    readonly brand: { readonly id: string; readonly share: number } | null;
    readonly creator: { readonly id: string; readonly share: number } | null;
    readonly verdict: Verdict;
  };
  /** Every signed creator, most revenue first. */
  readonly roster: readonly {
    readonly creatorId: string;
    readonly deals: number;
    readonly revenue: number;
    readonly lastDealAt: number | null;
    readonly signedAt: number | null;
    /** Views at 30 days against their usual, 1 = 100%, averaged over reported deals; null before one. */
    readonly delivered: number | null;
    /** Signed, no deal in `thresholds.idleDays`. */
    readonly idle: boolean;
  }[];
  /** Across every reported deal; null before one. */
  readonly deliveredAverage: number | null;
  /** The 10 deal steps in DEAL_FLOW order. */
  readonly steps: readonly {
    readonly step: number;
    readonly medianDays: number | null;
    readonly stuck: number;
  }[];
  readonly stuckDeals: readonly {
    readonly dealId: string;
    readonly step: number;
    readonly days: number;
    readonly usual: number;
  }[];
  readonly repeat: {
    /** Brands with a second deal, of brands with a deal. */
    readonly came: Ratio;
    /** Deal ids: finished 30-day reports with no newer deal for that brand. */
    readonly noNext: readonly string[];
  };
}

// ---------------------------------------------------------------------------------------------
// Goal (design 3.6). P8a: in emails and creators, from a "creators to sign a month" target. P8b
// puts the money lines on top (revenue → bookings → deals → brand pitches → creators to sign).

/**
 * The chain from the top down. The money lines (`revenue` to `pitches`) show only to money viewers
 * with a money goal (P8b); the rest always show.
 */
export const goalSteps = [
  "revenue",
  "bookings",
  "deals",
  "pitches",
  "signed",
  "replied",
  "firstEmails",
  "triage",
  "find",
] as const;
export type GoalStep = (typeof goalSteps)[number];

/** The rate a goal line is worked out with, and where it came from. */
export interface GoalRate {
  readonly value: number;
  readonly source: "yours" | "course" | "guess" | "override";
  /** Your own count behind it (last 90 days) when `source` is "yours". */
  readonly count: Ratio | null;
}

export interface GoalLine {
  readonly step: GoalStep;
  /** Needed a month. */
  readonly month: number;
  /** The rate from the line below to this one; null for the top line. */
  readonly rate: GoalRate | null;
  /** Needed a working day; null for lines counted a month only. */
  readonly perDay: number | null;
  /** What you do a working day now (last 30 days); null when not counted a day. */
  readonly actualPerDay: number | null;
  /**
   * The money lines (revenue, bookings, deals) only: what the last 30 days did (net paid, booked,
   * deals made), against `month`. Null for every other line.
   */
  readonly actualMonth: number | null;
  readonly verdict: Verdict;
  /** How many a day short, when short. */
  readonly shortBy: number | null;
}

export interface Lever {
  readonly kind: "replyRate" | "signRate" | "dealSize" | "closeRate";
  readonly from: number;
  readonly to: number;
  /** First emails needed a working day, before and after. */
  readonly emailsFrom: number;
  readonly emailsTo: number;
}

export interface GoalReport {
  readonly tab: "goal";
  readonly window: ReportWindow;
  readonly settings: GoalSettings;
  readonly lines: readonly GoalLine[];
  /** The step falling short the most, or null when every line is on track. */
  readonly shortStep: GoalStep | null;
  /** Biggest cut in daily work first. */
  readonly levers: readonly Lever[];
  readonly room: {
    /** First emails plus their follow-ups a day. */
    readonly needed: number;
    readonly capacity: number;
  };
}

/** Kept in `local_settings` (key `insights.goal`). */
export interface GoalSettings {
  readonly signsPerMonth: number;
  /**
   * Net revenue a month, in dollars (P8b). When set, money viewers see the money lines lead the
   * chain, and the creators to sign are worked out from it. Null: no money goal.
   */
  readonly revenuePerMonth: number | null;
  /** Rates a person set by hand, by the step they lead to. */
  readonly overrides: Readonly<Partial<Record<GoalStep, number>>>;
}

// ---------------------------------------------------------------------------------------------
// The early-warning list and What's working (design section 4)

/** invoiceLate, payoutDue, behindGoal, basket and marginLow are for money viewers only. */
export type Alert =
  | { readonly kind: "mailboxBounces"; readonly mailbox: string; readonly bounced: Ratio }
  | {
      readonly kind: "repliesFell";
      readonly batch: number;
      readonly rate: Ratio;
      readonly usual: Ratio;
    }
  | {
      readonly kind: "fuelLow";
      readonly ready: number;
      readonly days: number;
      readonly waitingConfirm: number;
    }
  | { readonly kind: "repliesFalling"; readonly batches: number }
  | { readonly kind: "roomUnused"; readonly used: Ratio }
  | {
      readonly kind: "keywordWeak";
      readonly keyword: string;
      readonly replied: Ratio;
      readonly others: Ratio;
    }
  | { readonly kind: "keywordWornOut"; readonly keyword: string; readonly known: Ratio }
  | {
      readonly kind: "stepShort";
      readonly step: GoalStep;
      readonly perDay: number;
      readonly needed: number;
    }
  | { readonly kind: "noSearch"; readonly days: number; readonly fuelDays: number }
  | { readonly kind: "backlogGrowing"; readonly count: number; readonly days: number }
  | { readonly kind: "reFindsArchive"; readonly keyword: string; readonly archived: Ratio }
  | { readonly kind: "mistakesLeaving"; readonly count: number }
  | {
      readonly kind: "rejectsTooStrict";
      readonly reason: RejectReason | "unknown";
      readonly back: number;
      readonly replied: number;
    }
  | { readonly kind: "unreadable"; readonly count: Ratio }
  | { readonly kind: "auditFailing"; readonly check: AudienceKey; readonly failed: Ratio }
  | {
      readonly kind: "invoiceLate";
      readonly dealId: string;
      readonly days: number;
      readonly amount: number;
    }
  | {
      readonly kind: "payoutDue";
      readonly dealId: string;
      readonly amount: number;
      readonly since: number;
    }
  | {
      readonly kind: "dealStuck";
      readonly dealId: string;
      readonly step: number;
      readonly days: number;
      readonly usual: number;
    }
  | { readonly kind: "behindGoal"; readonly projected: number; readonly goal: number }
  | { readonly kind: "basket"; readonly brandId: string; readonly share: number }
  | { readonly kind: "idleCreator"; readonly creatorId: string; readonly days: number | null }
  | {
      readonly kind: "marginLow";
      readonly dealId: string;
      readonly margin: number;
      readonly floor: number;
    };

export type AlertKind = Alert["kind"];

/** An alert as the Overview lists it. */
export interface AlertLine {
  /** Stable while the problem lasts (kind plus subject), so Hide for 7 days can find it again. */
  readonly key: string;
  readonly verdict: "act" | "watch";
  readonly alert: Alert;
  readonly go: InsightsGo;
}

export type Win =
  | { readonly kind: "edited"; readonly edited: Ratio; readonly asWritten: Ratio }
  | {
      readonly kind: "keyword";
      readonly keyword: string;
      readonly replied: Ratio;
      readonly signed: number;
    }
  | { readonly kind: "mailbox"; readonly mailbox: string; readonly replies: Ratio }
  | {
      readonly kind: "followUp";
      readonly step: number;
      readonly share: Ratio;
      readonly rate: Ratio;
    }
  /** The brand that pays fastest (money viewers only). */
  | { readonly kind: "brandPaysFast"; readonly brandId: string; readonly days: number };

export interface WinLine {
  readonly result: Difference | "good";
  readonly win: Win;
  readonly go: InsightsGo | null;
}

// ---------------------------------------------------------------------------------------------
// Overview (design 3.1)

/** The parts of "This period in a few sentences", in order. The renderer words each one. */
export type SummaryPart =
  | {
      readonly kind: "sent";
      readonly sent: number;
      readonly change: number;
      readonly onPace: boolean | null;
    }
  | {
      readonly kind: "replies";
      readonly replied: number;
      readonly rate: Ratio;
      readonly signed: number;
    }
  | { readonly kind: "needs"; readonly alerts: readonly AlertLine[] }
  | { readonly kind: "quiet" };

export interface OverviewReport {
  readonly tab: "overview";
  readonly window: ReportWindow;
  readonly summary: readonly SummaryPart[];
  readonly vitals: {
    readonly emails: {
      readonly sent: number;
      readonly before: number;
      readonly firstEmails: number;
      readonly firstPerDay: number;
      /** From the Goal tab; null when no goal is set. */
      readonly neededPerDay: number | null;
      readonly verdict: Verdict;
      readonly trend: readonly Point[];
    };
    readonly replyRate: {
      readonly now: Ratio;
      readonly before: Ratio;
      readonly difference: Difference;
      readonly verdict: Verdict;
      readonly trend: readonly Point[];
    };
    readonly signedPer1000: {
      readonly now: Ratio;
      /** The last 90 days, for when the period alone is too small. */
      readonly ninety: Ratio;
      readonly verdict: Verdict;
    };
    readonly fuel: {
      readonly ready: number;
      readonly firstPerDay: number;
      /** Days of sending at the current pace; null when nothing is sent. */
      readonly days: number | null;
      readonly waitingConfirm: number;
      readonly verdict: Verdict;
    };
    /** Money viewers: this month's brand payments against the goal; null for everyone else. */
    readonly revenue: {
      readonly month: number;
      readonly paid: number;
      /** Where the month ends at this pace; null while it is too early to say. */
      readonly projected: number | null;
      /** The goal as brand payments; null without a money goal. */
      readonly goal: number | null;
      readonly verdict: Verdict;
      /** The last six months' payments. */
      readonly trend: readonly Point[];
    } | null;
    /** Shown in place of revenue to those who don't see money. */
    readonly repliesWaiting: {
      readonly count: number;
      readonly oldestAt: number | null;
      readonly verdict: Verdict;
    };
  };
  /** Most urgent first, hidden ones left out. The screen shows 6 with "Show all". */
  readonly attention: readonly AlertLine[];
  readonly hidden: number;
  /** At most 3. */
  readonly wins: readonly WinLine[];
  /** Everyone so far, Found to First payout (design 3.1's "Paid"). */
  readonly pipeline: readonly FunnelRow[];
  readonly biggestDrop: CreatorStep | null;
}

export type InsightsReport =
  OverviewReport | FunnelReport | EmailsReport | SearchReport | MoneyReport | GoalReport;

/** Kept in `local_settings` (key `insights.hidden`): alert key → hidden until (ms). */
export type HiddenAlerts = Readonly<Record<string, number>>;
