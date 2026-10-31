/**
 * What a creator's record shows first (plan step P2, R3 and R4). Pure: no words here, only keys.
 */
import type { CreatorStage } from "./types";

/** The steps on the way to signing, in order (v6's `CREATOR_STEPS`). */
export const creatorSteps = [
  "new",
  "shortlisted",
  "contact",
  "emailed",
  "replied",
  "kit",
  "audience",
  "signed",
] as const;

export type CreatorStep = (typeof creatorSteps)[number];

/** Where a stage sits on the steps strip; null for rejected, parked and never: they show a tag. */
export function creatorStepIndex(stage: CreatorStage): number | null {
  const i = (creatorSteps as readonly string[]).indexOf(stage);
  return i < 0 ? null : i;
}

/** The blocks an Overview is made of. */
export const creatorOverviewBlockKeys = [
  "numbers",
  "videos",
  "fit",
  "warnings",
  "reason",
  "contact",
  "emails",
  "shortNumbers",
  "reply",
  "draft",
  "audienceCheck",
  "relationship",
  "update",
  "locks",
  "onboarding",
  "deals",
  "rate",
] as const;

export type CreatorOverviewBlock = (typeof creatorOverviewBlockKeys)[number];

/** What is known about the creator, so a block with nothing to show is left out. */
export interface OverviewFacts {
  /** A reject reason or a never reason is on record. */
  readonly hasReason: boolean;
  /** Bot risk worth a look, or a Shorts channel. */
  readonly hasWarnings: boolean;
  /** An address is confirmed, or a contact name is known. */
  readonly hasContact: boolean;
  /** Emails have been written or sent: there is a thread or a sequence. */
  readonly hasEmails: boolean;
  /** They wrote back. */
  readonly hasReply: boolean;
  /** A draft is waiting for a person. */
  readonly hasDraft: boolean;
  readonly hasRelationship: boolean;
  /** The last update or the next open slot is known. */
  readonly hasUpdate: boolean;
  readonly hasLocks: boolean;
  readonly hasOnboarding: boolean;
  readonly hasDeals: boolean;
  /** A rate is known (only a viewer who sees money has one). */
  readonly hasRate: boolean;
  readonly seesMoney: boolean;
}

/**
 * The Overview's blocks for a stage, in order (R3). Early stages show the numbers that decide;
 * contact and emailed show the contact and where the emails stand; replied to audience show the
 * reply and the next draft; signed shows the relationship and the short numbers. A block whose fact is missing is left
 * out, and the rate only for a viewer who sees money.
 */
export function creatorOverviewBlocks(
  stage: CreatorStage,
  facts: OverviewFacts,
): readonly CreatorOverviewBlock[] {
  const out: CreatorOverviewBlock[] = [];
  const when = (block: CreatorOverviewBlock, on: boolean): void => {
    if (on) out.push(block);
  };
  switch (stage) {
    case "new":
    case "shortlisted":
    case "rejected":
    case "parked":
    case "never":
      out.push("numbers", "videos", "fit");
      when("warnings", facts.hasWarnings);
      when("reason", facts.hasReason);
      break;
    case "contact":
    case "emailed":
      when("contact", facts.hasContact);
      when("emails", facts.hasEmails);
      out.push("shortNumbers");
      break;
    case "replied":
    case "kit":
    case "audience":
      when("reply", facts.hasReply);
      when("draft", facts.hasDraft);
      when("audienceCheck", stage === "kit");
      out.push("shortNumbers");
      break;
    case "signed":
      when("relationship", facts.hasRelationship);
      when("update", facts.hasUpdate);
      when("locks", facts.hasLocks);
      when("onboarding", facts.hasOnboarding);
      when("deals", facts.hasDeals);
      when("rate", facts.seesMoney && facts.hasRate);
      out.push("shortNumbers");
      break;
    default: {
      // A new stage must be placed in one of the cases above.
      const unplaced: never = stage;
      return unplaced;
    }
  }
  return out;
}
