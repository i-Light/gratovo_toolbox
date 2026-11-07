import type { RecordRef } from "../close/engine-types";
import type { Brand, Creator, Deal, ReachData } from "../data";

/** The buckets of Today, closest to money first. */
export const todayBuckets = [
  "money",
  "deals",
  "replies",
  "sends",
  "followups",
  "close",
  "contacts",
  "finds",
] as const;

export type TodayBucket = (typeof todayBuckets)[number];

export type TodayKind =
  | "invoice"
  | "collect"
  | "payout"
  | "deal"
  | "nextdeal"
  | "reply"
  | "send"
  | "followup"
  | "bnudge"
  | "audience"
  | "qualify"
  | "pitch"
  | "contact"
  | "finds";

/** One thing that needs the person today. Words come from the renderer. */
export interface TodayItem {
  /** "<kind>:<id>", or "finds". */
  readonly key: string;
  readonly bucket: TodayBucket;
  readonly kind: TodayKind;
  /** Null for finds. */
  readonly ref: RecordRef | null;
  /** The draft id the pane opens. */
  readonly draft: string | null;
  readonly due: number | null;
  /** `due` is when it arrived (replies), not a deadline. */
  readonly age: boolean;
  readonly minutes: number;
  readonly quick: boolean;
  readonly owner: string | null;
}

export interface TodayInput {
  readonly now: number;
  readonly seesMoney: boolean;
  readonly parts: { readonly deals: boolean };
  readonly creators: readonly Creator[];
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  readonly reach: Pick<ReachData, "drafts" | "threads" | "sequences">;
  readonly newFinds: number;
  /** Key to the time it comes back. */
  readonly snoozed: Readonly<Record<string, number>>;
}

export interface DoneEntry {
  readonly key: string;
  readonly title: string;
  readonly bucket: TodayBucket;
  readonly at: number;
  readonly minutes: number;
}

export const dayHours = [2, 3, 4, 5, 6, 8] as const;
export const morningHours = [7, 8, 9, 10] as const;

/** The person's day, kept on this computer only. */
export interface DayState {
  readonly hours: (typeof dayHours)[number];
  readonly morning: (typeof morningHours)[number];
  readonly snoozed: Readonly<Record<string, { readonly until: number; readonly title: string }>>;
  readonly done: readonly DoneEntry[];
  readonly note: string;
  readonly wrappedAt: number | null;
}

export const defaultDay: DayState = {
  hours: 4,
  morning: 9,
  snoozed: {},
  done: [],
  note: "",
  wrappedAt: null,
};

export const dayNoteMax = 500;
export const doneMax = 300;
export const snoozedMax = 500;
