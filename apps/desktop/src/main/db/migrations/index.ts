import type { Migration } from "../migrate";
import { initial } from "./0001-initial";
import { memberAccess } from "./0002-member-access";
import { sync } from "./0003-sync";
import { outreach } from "./0004-outreach";
import { comments } from "./0005-comments";
import { draftGoal } from "./0006-draft-goal";
import { insights } from "./0007-insights";
import { details } from "./0008-details";
import { dealEvents } from "./0009-deal-events";
import { recordNotes } from "./0010-record-notes";

/** Every migration, numbered 1..n with no gap. Add new ones at the end. */
export const migrations: readonly Migration[] = [
  initial,
  memberAccess,
  sync,
  outreach,
  comments,
  draftGoal,
  insights,
  details,
  dealEvents,
  recordNotes,
];
