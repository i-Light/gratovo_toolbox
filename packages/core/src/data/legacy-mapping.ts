import { DEAL_FLOW } from "../deal-flow";
import { creatorStages } from "./types";
import type { CreatorStage } from "./types";

/**
 * How the app's fields map to the columns Supabase (and the old app) already have. Read rules turn
 * a row into the app's value; write rules give the legacy columns for an app value, so the old app
 * keeps working. Where the app has its own column (`creator_stage`, `flow_step`), that column
 * always holds the exact value and wins on read.
 */

/** The legacy fields (`vetting_status`, `pipeline_stage`) a creator stage is written as. */
export interface LegacyCreatorFields {
  readonly vettingStatus: string;
  readonly pipelineStage: string;
}

/**
 * A creator's stage: the app column when it holds a known stage, else derived from the legacy
 * fields. An unknown `pipeline_stage` reads as `new`.
 */
export function creatorStageFrom(row: {
  readonly creatorStage: string | null;
  readonly vettingStatus: string;
  readonly pipelineStage: string;
}): CreatorStage {
  if (row.creatorStage !== null && isCreatorStage(row.creatorStage)) {
    return row.creatorStage;
  }
  if (row.vettingStatus === "rejected") {
    return "rejected";
  }
  switch (row.pipelineStage) {
    case "contacted":
      return "emailed";
    case "interested":
      return "replied";
    case "roster":
    case "negotiating":
    case "contract":
    case "awaitingDelivery":
    case "paid":
      return "signed";
    case "lost":
      return "parked";
    default:
      return row.vettingStatus === "shortlisted" ? "shortlisted" : "new";
  }
}

/**
 * The legacy fields for a creator stage. Stages past shortlisting keep `shortlisted` vetting: a
 * creator the agency contacted was shortlisted first.
 */
export function legacyCreatorFields(stage: CreatorStage): LegacyCreatorFields {
  switch (stage) {
    case "new":
      return { vettingStatus: "newlyFound", pipelineStage: "new" };
    case "shortlisted":
    case "contact":
      return { vettingStatus: "shortlisted", pipelineStage: "new" };
    case "emailed":
      return { vettingStatus: "shortlisted", pipelineStage: "contacted" };
    case "replied":
    case "kit":
    case "audience":
      return { vettingStatus: "shortlisted", pipelineStage: "interested" };
    case "signed":
      return { vettingStatus: "shortlisted", pipelineStage: "roster" };
    case "rejected":
      return { vettingStatus: "rejected", pipelineStage: "new" };
    case "parked":
    case "never":
      return { vettingStatus: "newlyFound", pipelineStage: "lost" };
  }
}

/**
 * A deal's step (an index into DEAL_FLOW): the app column when it holds a valid index, else
 * derived from the legacy `stage`. An unknown stage reads as the first step.
 */
export function dealStepFrom(row: {
  readonly flowStep: number | null;
  readonly stage: string;
}): number {
  if (row.flowStep !== null && isDealStep(row.flowStep)) {
    return row.flowStep;
  }
  switch (row.stage) {
    case "agreed":
    case "contractSent":
      return 1;
    case "signed":
      return 2;
    case "live":
      return 5;
    case "closed":
      return 9;
    default:
      // proposed, negotiating and lost all sit on the first step.
      return 0;
  }
}

/** The legacy `stage` for a deal step; a step past the last reads as `closed`, below 1 as `negotiating`. */
export function legacyDealStage(step: number): string {
  if (step >= 9) {
    return "closed";
  }
  if (step >= 5) {
    return "live";
  }
  if (step >= 2) {
    return "signed";
  }
  if (step >= 1) {
    return "contractSent";
  }
  return "negotiating";
}

/**
 * The email to use from a `contacts` JSON column: the email contact marked primary, else the first
 * email contact, else null. A bare string with an "@" counts as an email contact that isn't
 * primary (the old app reads those too). Bad JSON, a non-list, blank values and other entries are
 * skipped rather than failing the read.
 */
export function primaryEmail(contactsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contactsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const emails: { readonly value: string; readonly primary: boolean }[] = [];
  for (const item of parsed as readonly unknown[]) {
    if (typeof item === "string") {
      const bare = item.trim();
      if (bare.includes("@")) {
        emails.push({ value: bare, primary: false });
      }
      continue;
    }
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const contact = item as Readonly<Record<string, unknown>>;
    const value = typeof contact["value"] === "string" ? contact["value"].trim() : "";
    if (contact["method"] === "email" && value !== "") {
      emails.push({ value, primary: contact["primary"] === true });
    }
  }
  return (emails.find((e) => e.primary) ?? emails[0])?.value ?? null;
}

function isCreatorStage(value: string): value is CreatorStage {
  return (creatorStages as readonly string[]).includes(value);
}

function isDealStep(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < DEAL_FLOW.length;
}
