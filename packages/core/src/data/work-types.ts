/**
 * The full brand, deal and creator-details shapes the Close and Deliver screens read (plan step P1,
 * contracts P1-0). Pure types and constants. Everything here past the fields the sync already
 * carries lives in local-only tables (`brand_details`, `deal_details`, `creator_details`, migration
 * 0008) that the sync never reads (ADR 0021 D5). A field the app doesn't know is null, never 0 or
 * "": live rows read before step 8 or 9 wires them show "not known".
 *
 * Money is in whole US dollars, as `Deal.price` always was. Every amount is null for a viewer who
 * doesn't see money (`Frame.seesMoney`), and the `*Known` flags say a value is stored all the same.
 */

/** Where a brand is, in the order of Close › Brands' lanes; `lost` is the "Not a fit" lane. */
export const brandStatuses = [
  "found",
  "qualified",
  "pitched",
  "negotiating",
  "won",
  "lost",
] as const;

export type BrandStatus = (typeof brandStatuses)[number];

/** A person at a brand. */
export interface BrandContact {
  readonly name: string;
  /** Their title, such as "Head of Partnerships"; null when not known. */
  readonly role: string | null;
  readonly email: string | null;
}

/** The brand's budget for one integration, in dollars, low to high. */
export interface BudgetRange {
  readonly low: number;
  readonly high: number;
}

/** A pitch sent to a brand: when, which creators, and whether they knew us. */
export interface BrandPitch {
  readonly at: number;
  /** Creator ids, in the order pitched. */
  readonly creators: readonly string[];
  readonly mode: "cold" | "warm";
}

/** A company that sponsors creators. */
export interface Brand {
  readonly id: string;
  readonly name: string;
  /** What the brand sells, in a few words. */
  readonly sells: string;
  readonly status: BrandStatus;
  /** A short product category key such as "code" or "voice"; matching compares it. */
  readonly category: string | null;
  /** ISO-2, upper case. */
  readonly country: string | null;
  /** The web site, without the scheme. */
  readonly site: string | null;
  readonly headcount: number | null;
  /** Who to write to at a company of this size. */
  readonly recommendedTitle: string | null;
  /** We have seen them pay a creator for an integration (not only affiliate links). */
  readonly paidSpenderVerified: boolean | null;
  /** A campaign of theirs a pitch can open with. */
  readonly pastCampaignHook: string | null;
  /** Null when not known, or hidden from a viewer who doesn't see money. */
  readonly budget: BudgetRange | null;
  readonly budgetKnown: boolean;
  /** The first is the main contact; at most `brandContactsMax`. */
  readonly contacts: readonly BrandContact[];
  /** Creator ids we have seen this brand sponsor. */
  readonly seen: readonly string[];
  /** When the brand was added; null when not known. */
  readonly since: number | null;
  readonly pitched: BrandPitch | null;
  /** A member id; null for nobody. */
  readonly owner: string | null;
  /**
   * Notes a person typed, at most `notesMax` (R7); "" for none. Local only: the local note, or
   * else the synced one.
   */
  readonly notes: string;
  /** The stored notes were longer than `notesMax`: `notes` holds the cut text, read only. */
  readonly notesCut: boolean;
}

export const brandContactsMax = 4;

/** How a creator works with the agency: our markup on their rate, or 25% of the brand's price. */
export const relationshipModels = ["brokered", "exclusive_25"] as const;

export type RelationshipModel = (typeof relationshipModels)[number];

/** The seven clauses every contract must have, in the order the audit lists them. */
export const contractClauses = [
  "deliverable",
  "dates",
  "revisions",
  "usage",
  "exclusivity",
  "payment",
  "compliance",
] as const;

export type ContractClause = (typeof contractClauses)[number];

/** The six clauses in a brand's contract we push back on. */
export const redlineClauses = [
  "perpetual",
  "broad_excl",
  "net60",
  "unilateral_cancel",
  "unlimited_rev",
  "creator_liable",
] as const;

export type RedlineClause = (typeof redlineClauses)[number];

/** The checks a creator's draft video passes before the brand sees it. */
export const qcChecks = ["placement", "disclosure", "music", "link", "claims"] as const;

export type QcCheck = (typeof qcChecks)[number];

/** The invoice for a deal. Its amount is the deal's price. */
export interface DealInvoice {
  /** Such as "GR-2026-034"; null until one is given. */
  readonly number: string | null;
  readonly sentAt: number | null;
  readonly dueAt: number | null;
  readonly paidAt: number | null;
}

/** The 30-day report on a live video. */
export interface DealReport {
  readonly dueAt: number;
  readonly sentAt: number | null;
  readonly views: number | null;
  readonly targetViews: number | null;
  readonly clicks: number | null;
  /** In %. */
  readonly ctr: number | null;
  /** In %, across the sponsor segment. */
  readonly retention: number | null;
  readonly verdict: "over" | "under" | null;
  /** What we offer the brand when the video underperformed. */
  readonly makeGood: string | null;
}

/** A product the brand sends the creator, and the links the video uses. */
export interface DealShipping {
  /** False: nothing to ship (a software product). */
  readonly required: boolean;
  readonly item: string | null;
  readonly carrier: string | null;
  readonly tracking: string | null;
  readonly shippedAt: number | null;
  readonly deliveredAt: number | null;
  readonly promoCode: string | null;
  readonly utmLink: string | null;
}

/** The posts after go-live that keep a video's views coming: done or not. */
export interface DealHype {
  readonly h24: boolean;
  readonly d7: boolean;
  readonly d14: boolean;
  readonly d30: boolean;
}

/** A price-per-view deal: the rate per 1,000 views, its cap, and the views we promise. */
export interface DealCpm {
  readonly rate: number;
  readonly cap: number;
  readonly viewGuarantee: number;
}

/** One offer in a negotiation. */
export interface DealOffer {
  readonly who: "us" | "brand" | "creator";
  readonly amount: number;
  readonly at: number;
  readonly note: string | null;
}

/** Where a price talk stands. */
export interface DealNegotiation {
  /** What we asked the brand for. */
  readonly ask: number;
  /** The brand's latest offer; null before one. */
  readonly offer: number | null;
  /** The creator's rate for this deal. */
  readonly creatorRate: number | null;
  /** The least margin we accept, in % of the price. */
  readonly floorPct: number;
  /** Oldest first. */
  readonly history: readonly DealOffer[];
}

/** A sponsorship between one brand and one creator. */
export interface Deal {
  readonly id: string;
  /** A brand id. */
  readonly brand: string;
  /** A creator id. */
  readonly creator: string;
  /** An index into DEAL_FLOW. */
  readonly step: number;
  /** What the brand pays; null when not known or hidden. */
  readonly price: number | null;
  /** What the creator gets; null when not known or hidden. */
  readonly payout: number | null;
  readonly model: RelationshipModel | null;
  /** A member id; null for nobody. */
  readonly owner: string | null;
  /** One per item of the current step's checklist (`DEAL_FLOW[step].items`), in order. */
  readonly checks: readonly boolean[];
  readonly videoCount: number;
  readonly videosDelivered: number;
  readonly createdAt: number | null;
  /** When the creator's draft is due (five days before go-live). */
  readonly creatorDeadline: number | null;
  readonly goLiveAt: number | null;
  /** When the current step is due. */
  readonly dueAt: number | null;
  /** What the creator makes, in words, such as "60–90 s integration in the first third". */
  readonly deliverable: string | null;
  /** Payment terms, such as "Net 30". */
  readonly terms: string | null;
  /** Where in the video the integration sits, such as "First third (01:40–03:10)". */
  readonly placement: string | null;
  readonly invoice: DealInvoice;
  readonly report: DealReport | null;
  readonly paidCreatorAt: number | null;
  /** The payout's reference, such as a Wise transfer id. */
  readonly payRef: string | null;
  /** The public video, without the scheme. */
  readonly liveUrl: string | null;
  /** One per `contractClauses` entry: the contract has it. */
  readonly clauses: readonly boolean[];
  /** The dangerous clauses found in the brand's contract. */
  readonly redlines: readonly RedlineClause[];
  readonly shipping: DealShipping | null;
  readonly scriptApproved: boolean;
  /** One per `qcChecks` entry. */
  readonly qc: readonly boolean[];
  readonly hype: DealHype | null;
  /** When the brand's paid-ad rights end; null when it has none. */
  readonly whitelistingUntil: number | null;
  /** Null when not a CPM deal, or hidden. */
  readonly cpm: DealCpm | null;
  /** Null when there is no price talk, or hidden. */
  readonly negotiation: DealNegotiation | null;
  /**
   * Notes a person typed, at most `notesMax` (R7); "" for none. Local only: the local note, or
   * else the synced one.
   */
  readonly notes: string;
  /** The stored notes were longer than `notesMax`: `notes` holds the cut text, read only. */
  readonly notesCut: boolean;
}

/** What a creator's videos look like. */
export const creatorFormats = ["talking_head", "long_form", "shorts"] as const;

export type CreatorFormat = (typeof creatorFormats)[number];

/** How likely a channel's numbers are bought: clean, worth a look, or likely fake. */
export const botRiskLevels = ["clean", "watch", "high"] as const;

export type BotRiskLevel = (typeof botRiskLevels)[number];

export interface BotRisk {
  readonly level: BotRiskLevel;
  /** What was seen, in a sentence; null when nothing was noted. */
  readonly note: string | null;
}

/** A creator promised a brand not to promote a competitor in one category until a date. */
export interface ExclusivityLock {
  /** A brand category key, as `Brand.category`. */
  readonly category: string;
  /** The brand's name. */
  readonly brand: string;
  readonly until: number;
}

/** What a signed creator told us when they joined. */
export interface CreatorOnboarding {
  /** Brand names they would love to work with. */
  readonly dreamBrands: readonly string[];
  /** Categories they never promote, such as "Crypto". */
  readonly hardNos: readonly string[];
  /** How they are paid, such as "Wise" or "PayPal". */
  readonly paymentRail: string | null;
  /** Such as "W-9 on file". */
  readonly taxForm: string | null;
}

/**
 * What the app knows of a creator beyond the synced row (`creator_details`). Every field is null
 * or empty when not known.
 */
export interface CreatorDetails {
  /** A member id; null for nobody. */
  readonly owner: string | null;
  /** Signed creators only. */
  readonly relationship: RelationshipModel | null;
  /** When we last sent a signed creator news; "days since update" counts from it. */
  readonly lastUpdateAt: number | null;
  readonly locks: readonly ExclusivityLock[];
  /** The next upload a sponsor can take. */
  readonly nextOpenSlot: number | null;
  readonly onboarding: CreatorOnboarding | null;
  readonly format: CreatorFormat | null;
  readonly botRisk: BotRisk | null;
  /** By platform ("x", "instagram", "tiktok", "linkedin"): the handle with its "@". */
  readonly socials: Readonly<Record<string, string>>;
}

/** Details with nothing known. */
export const noDetails: CreatorDetails = {
  owner: null,
  relationship: null,
  lastUpdateAt: null,
  locks: [],
  nextOpenSlot: null,
  onboarding: null,
  format: null,
  botRisk: null,
  socials: {},
};

/**
 * The agency's own numbers the pricing and the checks use (Settings › Agency facts, P6). Stored in
 * `local_settings` under `agency.facts`; `defaultAgencyFacts` when not set.
 */
export interface AgencyFacts {
  /** Dollars per 1,000 views a brand pays for an integration. */
  readonly cpm: number;
  /** Our markup on a brokered creator's rate, in %. */
  readonly markupPct: number;
  /** The least margin a deal may have, in % of the price. */
  readonly marginFloorPct: number;
  /** Our share of the brand's price on exclusive management, in %. */
  readonly commissionPct: number;
}

export const defaultAgencyFacts: AgencyFacts = {
  cpm: 40,
  markupPct: 60,
  marginFloorPct: 25,
  commissionPct: 25,
};

/** A brand with only its first four fields known: everything else not known. */
export function bareBrand(base: Pick<Brand, "id" | "name" | "sells" | "status">): Brand {
  return {
    ...base,
    category: null,
    country: null,
    site: null,
    headcount: null,
    recommendedTitle: null,
    paidSpenderVerified: null,
    pastCampaignHook: null,
    budget: null,
    budgetKnown: false,
    contacts: [],
    seen: [],
    since: null,
    pitched: null,
    owner: null,
    notes: "",
    notesCut: false,
  };
}

/** A deal with only the fields the sync carries known: everything else not known or not done. */
export function bareDeal(base: Pick<Deal, "id" | "brand" | "creator" | "step" | "price">): Deal {
  return {
    ...base,
    payout: null,
    model: null,
    owner: null,
    checks: [],
    videoCount: 1,
    videosDelivered: 0,
    createdAt: null,
    creatorDeadline: null,
    goLiveAt: null,
    dueAt: null,
    deliverable: null,
    terms: null,
    placement: null,
    invoice: { number: null, sentAt: null, dueAt: null, paidAt: null },
    report: null,
    paidCreatorAt: null,
    payRef: null,
    liveUrl: null,
    clauses: contractClauses.map(() => false),
    redlines: [],
    shipping: null,
    scriptApproved: false,
    qc: qcChecks.map(() => false),
    hype: null,
    whitelistingUntil: null,
    cpm: null,
    negotiation: null,
    notes: "",
    notesCut: false,
  };
}
