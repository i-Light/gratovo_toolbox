/**
 * Reach's part of the data contract (plan step 6, `.router/PLAN.md` D4, D9, D13 and D17): drafts,
 * the threads' summaries, sequences and mailboxes as the frame carries them. Message bodies are
 * not in the frame: `reach:thread` reads one creator's thread.
 */

/** What a draft is: a first email, a follow-up of a sequence, or an answer to a reply. */
export const draftKinds = ["first", "followUp", "reply"] as const;

export type DraftKind = (typeof draftKinds)[number];

/** What a draft is for beyond answering: turn a creator down kindly, or ask for their numbers. */
export const draftGoals = ["decline", "ask_kit"] as const;

export type DraftGoal = (typeof draftGoals)[number];

/**
 * Where a draft is. `drafting`: Gemini is (or will be) writing it. `ready`: it waits for a person.
 * `approved`: a person pressed Send and the 10 s hold runs. `scheduled`: a person chose Send later.
 * `sending`: main has started the send. `sent`, `skipped`: done. `failed`: drafting or sending
 * failed; `problem` says how.
 */
export const draftStates = [
  "drafting",
  "ready",
  "approved",
  "scheduled",
  "sending",
  "sent",
  "skipped",
  "failed",
] as const;

export type DraftState = (typeof draftStates)[number];

/** The states a person's write may set (D5); main sets the rest. */
export const personDraftStates = ["ready", "approved", "scheduled", "skipped"] as const;

export type PersonDraftState = (typeof personDraftStates)[number];

/** The four rewrites on the draft card: Shorter, Warmer, More direct, New angle (D8). */
export const rewriteHows = ["shorter", "warmer", "direct", "redo"] as const;

export type RewriteHow = (typeof rewriteHows)[number];

/** Why a draft is waiting, failed or came back (D6, D11, D12). */
export const draftProblems = [
  // Drafting
  "bridge_off",
  "paused",
  "no_sender",
  "engine_failed",
  "engine_blocked",
  // Sending
  "send_failed",
  "maybe_sent",
  "mailbox_full",
  "mailbox_signed_out",
  "not_sent_closed",
  "late",
  // A Send later put back (Redo, or Undo of a Cancel) whose time had already passed.
  "time_passed",
  "gates_changed",
  // An edited draft the checks had blocked can't go unchecked, and no check could run.
  "needs_check",
] as const;

export type DraftProblem = (typeof draftProblems)[number];

/** The kinds of gate the comms engine asks a person to confirm, plus `blocked` (D10). */
export const engineGateKinds = [
  "price",
  "terms",
  "claim",
  "ethics",
  "fact_missing",
  "other",
] as const;

export type EngineGateKind = (typeof engineGateKinds)[number];

/** A gate the engine set: a person confirms it before the draft can go (`gatesOk`). */
export interface EngineGate {
  /** Stable within the draft, so a confirm survives a re-read. */
  readonly key: string;
  readonly kind: EngineGateKind;
  /** The engine's words, in English. */
  readonly text: string;
}

/** One finding of the house-rule checks. */
export interface DraftFinding {
  readonly rule: string;
  readonly text: string;
  readonly blocking: boolean;
}

/** How the engine read the case (its `situation`). */
export interface DraftSituation {
  readonly side: string;
  readonly stage: string;
  /** An id of the situations map (`situations.json`), or null. */
  readonly replyType: string | null;
  readonly summary: string;
}

/** What the comms engine answered for a draft (D6). */
export interface DraftProposal {
  readonly status: "ready" | "needs_human" | "blocked" | "no_message";
  /** Why this email: the engine's `decision.why`. */
  readonly why: string;
  /** The house rules it followed: `decision.rules`, at most `draftRulesMax`. */
  readonly rules: readonly string[];
  readonly findings: readonly DraftFinding[];
  readonly gates: readonly EngineGate[];
  readonly situation: DraftSituation | null;
  readonly model: string | null;
}

export const draftRulesMax = 20;
export const draftFindingsMax = 30;
export const draftGatesMax = 10;
/** The longest subject: RFC 5322's line limit. */
export const draftSubjectMax = 998;
/** The longest draft body; a cold email is a few hundred characters. */
export const draftBodyMax = 20_000;

/** One draft, as the frame carries it. */
export interface OutreachDraft {
  readonly id: string;
  /** The creator's channel id. */
  readonly creator: string;
  readonly kind: DraftKind;
  /** 1 to 3 for a follow-up; null otherwise. */
  readonly followUp: number | null;
  readonly state: DraftState;
  readonly subject: string;
  readonly body: string;
  /** The address it goes from; null while none is picked. */
  readonly mailbox: string | null;
  /** In ms: when an approved draft leaves (the end of the 10 s hold), or a scheduled one's time. */
  readonly sendAt: number | null;
  /** Null while drafting. */
  readonly proposal: DraftProposal | null;
  /** The engine gates a person confirmed, by key. */
  readonly gatesOk: readonly string[];
  /** A person changed the subject or the body. */
  readonly edited: boolean;
  /** The last check ran on this exact text (the engine's own text counts as checked). */
  readonly checked: boolean;
  /** Main is rewriting it now. */
  readonly rewriting: RewriteHow | null;
  /** For an answer: the id of the message it answers. */
  readonly replyTo: string | null;
  /** Why the draft was made, when it is a decline or an ask for the kit; null otherwise. */
  readonly goal: DraftGoal | null;
  readonly problem: DraftProblem | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One saved fact a reply gave (D18). */
export type ReplyFact =
  | { readonly key: "rate"; readonly rate: number; readonly saved: boolean }
  | {
      readonly key: "countries";
      /** ISO 3166 alpha-2 codes with their share in percent, largest first, at most 5. */
      readonly countries: readonly { readonly code: string; readonly share: number | null }[];
      readonly saved: boolean;
    }
  | { readonly key: "age"; readonly band: string; readonly saved: boolean };

export const replyFactKeys = ["rate", "countries", "age"] as const;

export type ReplyFactKey = (typeof replyFactKeys)[number];

/** Gemini's reading of a reply (D17). */
export interface ReplyReading {
  readonly replyType: string | null;
  /** The situation's label, or the summary's first words when it has no type. */
  readonly label: string;
  readonly summary: string;
  readonly side: string;
  /** A person picked the situation ("That's not it"). */
  readonly corrected: boolean;
  readonly facts: readonly ReplyFact[];
}

/** The latest message in, as the board and the replies list show it. */
export interface ThreadLastIn {
  readonly id: string;
  readonly at: number;
  /** Null until Gemini has read it. */
  readonly reading: ReplyReading | null;
  /** The first line of the body, at most `threadPreviewMax` characters. */
  readonly preview: string;
  readonly bounce: boolean;
}

export const threadPreviewMax = 200;

/** One creator's thread, in short. */
export interface ThreadSummary {
  readonly creator: string;
  readonly count: number;
  /** In ms. */
  readonly lastOutAt: number | null;
  readonly lastIn: ThreadLastIn | null;
  /** True when our message is the newest: answered, waiting for them. */
  readonly answered: boolean;
}

/** One step of a sequence (D13). */
export interface SequenceStep {
  readonly n: number;
  /** In ms. */
  readonly dueAt: number;
  readonly state: "planned" | "drafted" | "sent" | "skipped";
  readonly sentAt: number | null;
}

export const sequenceStops = ["you", "replied", "bounced", "finished"] as const;

export type SequenceStop = (typeof sequenceStops)[number];

/** A creator's follow-up sequence, started by the first email (D13). */
export interface Sequence {
  readonly creator: string;
  readonly mailbox: string;
  /** In ms: when the first email went. */
  readonly startedAt: number;
  readonly steps: readonly SequenceStep[];
  readonly stopped: SequenceStop | null;
  /** In ms; set while the creator is parked. */
  readonly parkUntil: number | null;
}

export const mailboxStatuses = ["good", "warming", "slowed", "paused", "signed_out"] as const;

export type MailboxStatus = (typeof mailboxStatuses)[number];

/** A sending mailbox, as Reach sees it (D9). */
export interface MailboxView {
  readonly address: string;
  /** A refresh token is stored for it. */
  readonly connected: boolean;
  /** Gmail refused its token: it must be connected again. */
  readonly signedOut: boolean;
  /** The cap the owner set (10 to 50). */
  readonly dailyCap: number;
  /** The cap that applies today: lower while warming up or slowed. */
  readonly effectiveCap: number;
  readonly sentToday: number;
  readonly leftToday: number;
  /** Null once warm-up is over, or when no warm-up date is set. */
  readonly warmup: { readonly day: number; readonly of: number } | null;
  readonly paused: boolean;
  readonly status: MailboxStatus;
  /** Share of the last 7 days' sends that bounced, in %; null under 10 sends (D20). */
  readonly bounceRate: number | null;
  /** Share of the last 30 days' first emails that got a reply, in %; null under 10 (D20). */
  readonly replyRate: number | null;
  /** In ms: when Gmail's numbers were last read; null when never. */
  readonly checkedAt: number | null;
}

/** Whether drafts can be written now (D6). */
export const reachGeminiStates = ["ready", "off", "paused", "no_sender"] as const;

export type ReachGeminiState = (typeof reachGeminiStates)[number];

export const reachDraftsMax = 1000;
export const reachThreadsMax = 5000;
/** The sequences the frame carries: those running, parked or stopped by you, and recent ones. */
export const reachSequencesMax = 2000;
export const reachMailboxesMax = 20;

/** Reach in the frame (D4). */
export interface ReachData {
  /** Every draft not sent or skipped, and those sent or skipped in the last 24 h. */
  readonly drafts: readonly OutreachDraft[];
  readonly sequences: readonly Sequence[];
  /** One per creator with any message. */
  readonly threads: readonly ThreadSummary[];
  readonly mailboxes: readonly MailboxView[];
  readonly gemini: ReachGeminiState;
  /** In ms, while `gemini` is `paused`. */
  readonly geminiPausedUntil: number | null;
  /** The name drafts are signed with; null blocks drafting. */
  readonly sender: string | null;
  /**
   * The time zone of each creator with an open draft whose channel country is known, by creator
   * id: for Send later's "Their morning" (D21).
   */
  readonly zones: Readonly<Record<string, string>>;
}

/** One message of a thread (`reach:thread`). */
export interface ThreadMessage {
  readonly id: string;
  readonly direction: "in" | "out";
  /** For a message out: what it was. */
  readonly kind: DraftKind | null;
  readonly followUp: number | null;
  readonly subject: string;
  readonly body: string;
  readonly bodyCut: boolean;
  readonly at: number;
  /** Our address. */
  readonly mailbox: string | null;
  /** Their address. */
  readonly peer: string | null;
  readonly peerName: string | null;
  /** For a message out: the member who approved it. */
  readonly by: string | null;
  readonly source: "app" | "sweep" | "pasted" | "imported";
  readonly reading: ReplyReading | null;
}

/** The longest message body kept (the reply line's cut, ADR 0015 §3). */
export const messageBodyMax = 100_000;
/** The most messages `reach:thread` answers with: the newest. */
export const threadMessagesMax = 500;

/** Reach with nothing in it. */
export const emptyReach: ReachData = {
  drafts: [],
  sequences: [],
  threads: [],
  mailboxes: [],
  gemini: "off",
  geminiPausedUntil: null,
  sender: null,
  zones: {},
};
