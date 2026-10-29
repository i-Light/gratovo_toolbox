import type { AudienceKey } from "../close/audience";
import type {
  CatalogWeek,
  LogFact,
  MailboxFacts,
  MessageFact,
  StageEvent,
} from "../insights/inputs";
import type { GoalSettings, HiddenAlerts } from "../insights/types";

import type { CreatorStage } from "./types";

/**
 * What main's Insights services read and write in the open source's local tables (plan step P8a,
 * decisions A5 and A6). The page never sees this: it reads `insights:read`. Every method is
 * synchronous (node:sqlite), as the source's own.
 */

/** What `channel_state` (with the media kit) says about one creator. */
export interface InsightsLocalCreator {
  readonly id: string;
  /** From `channels`; null when none is stored. */
  readonly name: string | null;
  readonly handle: string;
  /** The app's stage (the legacy fields only when it has none). */
  readonly stage: CreatorStage;
  /** Any email in the contacts. */
  readonly hasAddress: boolean;
  /**
   * When the primary address was confirmed; null when it is not. A confirm stores no time of its
   * own, so it is the earliest `contact` stage event, else the row's last update.
   */
  readonly confirmedAt: number | null;
  /** Where the primary address came from; null with no address. */
  readonly addressSource: "about" | "video" | "typed" | "other" | null;
  /** `checkAudience` rows of the kit; null before any kit is in. */
  readonly audit: Readonly<Record<AudienceKey, boolean | null>> | null;
}

/** The local half of the Insights inputs (`gratovo.db`), read in one pass. */
export interface InsightsLocal {
  readonly creators: readonly InsightsLocalCreator[];
  readonly events: readonly StageEvent[];
  readonly log: readonly LogFact[];
  readonly messages: readonly MessageFact[];
  /** Creators whose sequence has no stop. */
  readonly inSequence: readonly string[];
  readonly mailboxes: readonly MailboxFacts[];
  readonly weeks: readonly CatalogWeek[];
  readonly goal: GoalSettings;
  readonly hidden: HiddenAlerts;
}

export interface InsightsStore {
  /**
   * Upserts this week's live, waiting and archive totals (`catalog_weeks`), counted from
   * `pipeline.db` at `pipelineDbPath` and the creator stages. False when `pipeline.db` can't be
   * read: a week is never recorded as zero for want of data.
   */
  recordCatalogWeek(pipelineDbPath: string, now: number): boolean;
  /** Everything Insights reads from `gratovo.db`. A damaged setting reads as its default. */
  readLocal(): InsightsLocal;
}
