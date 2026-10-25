import type { DataWrite, MailboxView, OutreachDraft, ReachData } from "@gratovo/core/data";
import { emptyReach } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";

/** An AI creator's first-email draft, ready to send; `over` changes any field. */
export function aiDraft(
  id: string,
  creator: string,
  over: Partial<OutreachDraft> = {},
): OutreachDraft {
  return {
    id,
    creator,
    kind: "first",
    followUp: null,
    state: "ready",
    subject: "Your agents video",
    body: "Hi, I liked your video on building AI agents.",
    mailbox: "sam@gratovo.example",
    sendAt: null,
    proposal: {
      status: "ready",
      why: "They cover AI agents.",
      rules: [],
      findings: [],
      gates: [],
      situation: null,
      model: null,
    },
    gatesOk: [],
    edited: false,
    checked: true,
    rewriting: null,
    replyTo: null,
    problem: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** A mailbox that can send; `over` changes any field. */
export function goodMailbox(address: string, over: Partial<MailboxView> = {}): MailboxView {
  return {
    address,
    connected: true,
    signedOut: false,
    dailyCap: 30,
    effectiveCap: 30,
    sentToday: 2,
    leftToday: 28,
    warmup: null,
    paused: false,
    status: "good",
    bounceRate: null,
    replyRate: null,
    checkedAt: null,
    ...over,
  };
}

/** Reach with the given drafts and mailboxes. */
export function reachWith(over: Partial<ReachData>): ReachData {
  return { ...emptyReach, ...over };
}

/**
 * A `window.gratovo` for Reach tests: records every call, answers `data:write` with success and
 * every other channel with `answers[channel]` (or a plain success).
 */
export function stubReachBridge(answers: Record<string, unknown> = {}): {
  readonly calls: [string, unknown][];
  readonly writes: DataWrite[][];
} {
  const calls: [string, unknown][] = [];
  const writes: DataWrite[][] = [];
  const invoke = (channel: string, input: unknown): Promise<unknown> => {
    calls.push([channel, input]);
    if (channel === "data:write") {
      writes.push([...(input as { writes: DataWrite[] }).writes]);
      return Promise.resolve({ ok: true, value: {} });
    }
    return Promise.resolve({ ok: true, value: answers[channel] ?? { ok: true } });
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
  return { calls, writes };
}
