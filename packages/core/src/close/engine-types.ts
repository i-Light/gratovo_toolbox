import type {
  AgencyFacts,
  AudienceShare,
  Brand,
  CreatorStage,
  Deal,
  ExclusivityLock,
  RelationshipModel,
} from "../data";
import type { ReachData } from "../data/reach-types";

/**
 * The contracts of the Close engine (plan step P1, P1-4): pricing, packages, brand-to-creator
 * matching, and the one next action for any record. Ported from v6's `engine.js:62-197`, with
 * every sentence replaced by a key and its facts (as Insights does, ADR 0022 A2): the renderer
 * turns them into words from `strings`. All pure; times in ms; money in whole dollars.
 */

/** What pricing needs to know of a creator. */
export interface PriceInput {
  /** The 12-video trimmed average, else the median; null when neither is known. */
  readonly views: number | null;
  /** The creator's own rate per integration; null when not known. */
  readonly rate: number | null;
  readonly relationship: RelationshipModel | null;
}

/** What a brand buys: a 60–90 s integration (the default), a 30 s shout-out, a dedicated video, a Short. */
export const priceFormats = ["integration", "shoutout", "dedicated", "short"] as const;

export type PriceFormat = (typeof priceFormats)[number];

export interface PriceOptions {
  readonly format?: PriceFormat;
  /** 30 days of paid-ad rights: +25%. */
  readonly whitelisting?: boolean;
  /** Videos in a bundle; 3 or more take 8% off the total. */
  readonly bundle?: number;
}

/** One of the three packages a pitch offers. */
export interface Package {
  readonly key: "single" | "bundle" | "takeover";
  readonly price: number;
  /** Creator ids the package covers, in order. */
  readonly creators: readonly string[];
  /** The views it promises: the first creator's (single, bundle) or every creator's together. */
  readonly views: number | null;
}

/** What matching needs to know of a creator. */
export interface MatchCreator extends PriceInput {
  readonly id: string;
  readonly name: string;
  /** The Find fit score, 0 to 100; null when the channel isn't in the catalog. */
  readonly fit: number | null;
  /** Brand names seen sponsoring the creator. */
  readonly sponsors: readonly string[];
  /** Largest share first. */
  readonly countries: readonly AudienceShare[];
  readonly locks: readonly ExclusivityLock[];
  readonly dreamBrands: readonly string[];
}

/** Why a pairing is good. */
export type MatchReason =
  | { readonly kind: "repeat" }
  | { readonly kind: "dream" }
  | { readonly kind: "usLed" }
  | { readonly kind: "share"; readonly pct: number }
  | {
      readonly kind: "budgetFits";
      readonly price: number;
      readonly low: number;
      readonly high: number;
    };

/** What could stop a pairing. Any warning keeps a brand out of `bestBrandFor`. */
export type MatchWarning =
  | { readonly kind: "sponsoredDirect" }
  | {
      readonly kind: "lock";
      readonly category: string;
      readonly brand: string;
      readonly until: number;
    }
  | { readonly kind: "competitor"; readonly brand: string }
  | { readonly kind: "overBudget"; readonly price: number; readonly high: number }
  /** In a live deal (before step 9) with another brand of the same category. */
  | { readonly kind: "liveClash"; readonly brandId: string }
  /** Two or more deals before go-live (steps 0 to 5). */
  | { readonly kind: "busy"; readonly deals: number };

export interface Match {
  /** 0 to 100. */
  readonly score: number;
  readonly why: readonly MatchReason[];
  readonly warn: readonly MatchWarning[];
  readonly price: number;
}

/** What matching reads besides the pair: every brand and deal, the clock and the facts. */
export interface MatchWorld {
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  readonly now: number;
  readonly facts: AgencyFacts;
}

/** A record the next action is for. */
export type RecordRef =
  | { readonly kind: "creator"; readonly id: string }
  | { readonly kind: "brand"; readonly id: string }
  | { readonly kind: "deal"; readonly id: string };

/** What `nextFor` reads. */
export interface NextWorld extends MatchWorld {
  readonly creators: readonly {
    readonly id: string;
    readonly stage: CreatorStage;
    readonly email: string | null;
    readonly emailConfirmed: boolean;
    readonly rejectedAt: number | null;
    readonly archiveDueAt: number | null;
    /** `details.lastUpdateAt`; null when not known. */
    readonly lastUpdateAt: number | null;
    /** When the media kit came in; null when not known. */
    readonly kitAt: number | null;
  }[];
  readonly reach: ReachData;
  /** The matching view of a signed creator; null when it can't be built. */
  readonly matchCreator: (id: string) => MatchCreator | null;
}

/**
 * The one next thing to do on a record, as a key and its facts. `waiting` is true when the next
 * move is someone else's (the record shows it quieter, with no main button).
 */
export type NextAction = { readonly waiting: boolean } &
  // creator, any stage: a draft waits for a person
  (
    | {
        readonly kind: "draft";
        readonly draftId: string;
        readonly draft: "first" | "followUp" | "reply";
        readonly n: number | null;
        readonly at: number;
      }
    // creator, by stage
    | { readonly kind: "review" }
    | { readonly kind: "confirmEmail"; readonly hasEmail: boolean }
    | { readonly kind: "firstEmail" }
    | { readonly kind: "followUpDue"; readonly n: number; readonly at: number }
    | { readonly kind: "sequenceDone" }
    | { readonly kind: "awaitReply"; readonly since: number | null }
    | { readonly kind: "askKit"; readonly repliedAt: number | null }
    | { readonly kind: "nudgeKit"; readonly askedAt: number }
    | { readonly kind: "awaitKit"; readonly askedAt: number; readonly nudgeAt: number }
    | { readonly kind: "checkAudience"; readonly kitAt: number | null }
    | { readonly kind: "warmth"; readonly days: number }
    | {
        readonly kind: "pitchCreator";
        readonly brandId: string | null;
        readonly score: number | null;
        readonly why: MatchReason | null;
      }
    | { readonly kind: "parked"; readonly until: number | null }
    | { readonly kind: "archived"; readonly at: number | null }
    | { readonly kind: "never" }
    // brand
    | { readonly kind: "qualify"; readonly seen: number }
    | { readonly kind: "pitchBrand"; readonly budget: { low: number; high: number } | null }
    | { readonly kind: "brandNudge"; readonly pitchedAt: number }
    | { readonly kind: "awaitBrand"; readonly pitchedAt: number; readonly nudgeAt: number }
    | { readonly kind: "agreePrice" }
    | { readonly kind: "nextCreator"; readonly deals: number }
    | { readonly kind: "notFit" }
    // deal
    | { readonly kind: "sendInvoice"; readonly goLiveAt: number | null }
    | { readonly kind: "payCreator"; readonly amount: number | null; readonly paidAt: number }
    | { readonly kind: "awaitPayment"; readonly dueAt: number | null }
    | {
        readonly kind: "dealStep";
        readonly step: number;
        /** The first unticked item of the step; null when every item is ticked (move on). */
        readonly item: number | null;
        readonly dueAt: number | null;
      }
  );
