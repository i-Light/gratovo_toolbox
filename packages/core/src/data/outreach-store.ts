/**
 * What main's Reach services read and write in the open source's outreach tables (plan step 6,
 * D2): the drafter, the sender and the reply sweep. The page never sees this: it reads the frame's
 * `reach` and writes `DataWrite`s. Every method is synchronous (node:sqlite), as the source's own.
 */

import type {
  DraftKind,
  DraftProblem,
  DraftProposal,
  DraftState,
  OutreachDraft,
  ReachData,
  ReplyReading,
  RewriteHow,
  Sequence,
  ThreadMessage,
} from "./reach-types";
import type { DataWrite } from "./types";

/** A draft with what only main needs. */
export interface StoredDraft extends OutreachDraft {
  /** The member who pressed Send; null until approved or scheduled. */
  readonly approvedBy: string | null;
  /** The hash of subject and body the last check ran on; null when none ran. */
  readonly checkedHash: string | null;
  /** The last rewrite asked for. */
  readonly steer: { readonly how: RewriteHow | null; readonly note: string | null } | null;
}

export interface NewDraft {
  readonly id: string;
  readonly creator: string;
  readonly kind: DraftKind;
  readonly followUp: number | null;
  readonly mailbox: string | null;
  readonly replyTo: string | null;
  readonly at: number;
}

/** The fields main changes on a draft; absent ones stay. */
export interface DraftPatch {
  readonly state?: DraftState;
  readonly subject?: string;
  readonly body?: string;
  readonly mailbox?: string | null;
  readonly sendAt?: number | null;
  readonly proposal?: DraftProposal | null;
  readonly gatesOk?: readonly string[];
  readonly checkedHash?: string | null;
  readonly steer?: StoredDraft["steer"];
  readonly rewriting?: RewriteHow | null;
  readonly problem?: DraftProblem | null;
  /** Clears `edited`: the engine's own new text (a rewrite) counts as unedited. */
  readonly edited?: boolean;
}

export interface NewMessage {
  readonly id: string;
  readonly creator: string;
  readonly direction: "in" | "out";
  readonly kind: DraftKind | null;
  readonly followUp: number | null;
  readonly subject: string;
  readonly body: string;
  readonly bodyCut: boolean;
  readonly at: number;
  readonly mailbox: string | null;
  readonly peer: string | null;
  readonly peerName: string | null;
  readonly conversationKey: string | null;
  readonly gmailMessageId: string | null;
  readonly gmailThreadId: string | null;
  readonly draftId: string | null;
  readonly by: string | null;
  readonly source: ThreadMessage["source"];
  readonly reading: ReplyReading | null;
}

export interface OutreachStore {
  /** The stored parts of the frame's `reach` (D4), read at `now`. */
  reachParts(now: number): Pick<ReachData, "drafts" | "sequences" | "threads">;
  draft(id: string): StoredDraft | null;
  /** Every draft in one of `states`, oldest first. */
  draftsIn(states: readonly DraftState[]): StoredDraft[];
  /** The creator's draft that is neither sent nor skipped, newest first; null when none. */
  openDraft(creator: string): StoredDraft | null;
  insertDraft(draft: NewDraft): void;
  /** Changes a draft and its `updated_at`; false when there is no such draft. */
  updateDraft(id: string, patch: DraftPatch, at: number): boolean;
  /** The creator's newest messages, oldest first, at most `limit`. */
  thread(creator: string, limit: number): ThreadMessage[];
  /** Whether any message went out to the creator. */
  hasOutbound(creator: string): boolean;
  /** Our newest bodies out, newest first, each with its creator (the templated check, D7). */
  recentOutbound(limit: number): { readonly creator: string; readonly body: string }[];
  /** How many messages each mailbox sent at or after `since` (ms). */
  sentSince(since: number): { readonly mailbox: string; readonly count: number }[];
  sequence(creator: string): Sequence | null;
  /**
   * In one transaction: the drafts' patches, the new messages (one whose Gmail id is already
   * stored is skipped), the sequences, then `writes` applied as the person's own would be (so a
   * stage change syncs and its log line is the person's).
   */
  commit(change: {
    readonly at: number;
    readonly drafts?: readonly { readonly id: string; readonly patch: DraftPatch }[];
    readonly messages?: readonly NewMessage[];
    readonly sequences?: readonly Sequence[];
    readonly writes?: readonly DataWrite[];
  }): void;
}
