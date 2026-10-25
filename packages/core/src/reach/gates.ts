import type { Creator, EngineGate, MailboxView, OutreachDraft } from "../data";

/**
 * What stands between a draft and Send (plan step 6, D10). The same function runs in the page,
 * to show the gates, and in main right before a send; main's answer wins. Gates come in a fixed
 * order: never contact, an unconfirmed address, the mailbox, the checks, then each engine gate a
 * person has not confirmed.
 */

export const gateKeys = [
  "never",
  "unconfirmed",
  "no_mailbox",
  "mailbox_signed_out",
  "mailbox_paused",
  "mailbox_full",
  "blocked",
  "engine",
] as const;

export type GateKey = (typeof gateKeys)[number];

export interface Gate {
  readonly key: GateKey;
  /** For `engine`: the gate the engine set. */
  readonly engine: EngineGate | null;
  /** Send now is held while it is open. */
  readonly holdsSend: boolean;
  /** Send later is held too: a full or paused mailbox can still take a later send. */
  readonly holdsSchedule: boolean;
}

export interface GateInput {
  readonly draft: Pick<OutreachDraft, "kind" | "proposal" | "gatesOk" | "mailbox">;
  readonly creator: Pick<Creator, "stage" | "emailConfirmed" | "email"> | null;
  /** The draft's mailbox, or null when none is picked or it is not known. */
  readonly mailbox: MailboxView | null;
}

const hard = (key: GateKey): Gate => ({ key, engine: null, holdsSend: true, holdsSchedule: true });
const soft = (key: GateKey): Gate => ({ key, engine: null, holdsSend: true, holdsSchedule: false });

/** Why a mailbox can't send now, as a gate key; null when it can. */
export function mailboxGate(mailbox: MailboxView | null): GateKey | null {
  if (mailbox === null || !mailbox.connected) {
    return "no_mailbox";
  }
  if (mailbox.signedOut) {
    return "mailbox_signed_out";
  }
  if (mailbox.paused) {
    return "mailbox_paused";
  }
  return mailbox.leftToday <= 0 ? "mailbox_full" : null;
}

/** The open gates of a draft, in order. */
export function draftGates(input: GateInput): Gate[] {
  const { draft, creator, mailbox } = input;
  const gates: Gate[] = [];
  if (creator === null || creator.stage === "never") {
    gates.push(hard("never"));
  }
  if (creator !== null && (!creator.emailConfirmed || creator.email === null)) {
    gates.push(hard("unconfirmed"));
  }
  const box = mailboxGate(mailbox);
  if (box === "no_mailbox" || box === "mailbox_signed_out") {
    gates.push(hard(box));
  } else if (box !== null) {
    gates.push(soft(box));
  }
  const proposal = draft.proposal;
  if (
    proposal === null ||
    proposal.status === "blocked" ||
    proposal.findings.some((f) => f.blocking)
  ) {
    gates.push(hard("blocked"));
  }
  for (const engine of proposal?.gates ?? []) {
    if (!draft.gatesOk.includes(engine.key)) {
      gates.push({ key: "engine", engine, holdsSend: true, holdsSchedule: true });
    }
  }
  return gates;
}

/** Whether Send may go now. */
export function canSend(gates: readonly Gate[]): boolean {
  return !gates.some((g) => g.holdsSend);
}

/** Whether Send later may be chosen. */
export function canSchedule(gates: readonly Gate[]): boolean {
  return !gates.some((g) => g.holdsSchedule);
}

/**
 * The mailbox a new first email goes from: of those that can send, the one with the most sends
 * left today (ties by address); else the first connected one; else null.
 */
export function pickMailbox(mailboxes: readonly MailboxView[]): string | null {
  const able = mailboxes
    .filter((m) => mailboxGate(m) === null)
    .sort((a, b) => b.leftToday - a.leftToday || a.address.localeCompare(b.address));
  return able[0]?.address ?? mailboxes.find((m) => m.connected)?.address ?? null;
}
