import type { ArchiveFacts, ChannelFacts, InsightsInputs, MessageFact, StageEvent } from "./inputs";

/** Small builders shared by the Insights tests (not part of the package's API). */
export const L = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
/** Wednesday 28 Oct 2026, noon. */
export const NOW = L(2026, 10, 28, 12);
export const DAY = 86_400_000;

const profile = {
  medianViews: null,
  uploads30: null,
  subscribers: null,
  sponsored: null,
  inMarkets: null,
  addressFound: null,
};

export const emptyArchive: ArchiveFacts = {
  total: 0,
  byRules: 0,
  byPerson: 0,
  ruleLabels: [],
  personReasons: [],
  weekly: [],
  refoundThisWeek: 0,
  person: profile,
  rules: profile,
};

export function ch(id: string, over: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    id,
    name: `Name ${id}`,
    handle: `@${id}`,
    stage: null,
    inCatalog: true,
    foundAt: null,
    keywords: [],
    medianViews: null,
    uploads30: null,
    subscribers: null,
    country: null,
    sponsored: null,
    fit: 50,
    read: "ok",
    hasAddress: false,
    confirmedAt: null,
    addressSource: null,
    rejectReason: null,
    rejectedAt: null,
    leavesAt: null,
    audit: null,
    ...over,
  };
}

export function inputs(over: Partial<InsightsInputs> = {}): InsightsInputs {
  return {
    now: NOW,
    archiveDays: 7,
    channels: [],
    events: [],
    log: [],
    messages: [],
    inSequence: [],
    mailboxes: [],
    keywords: [],
    archive: emptyArchive,
    weeks: [],
    runs: [],
    goal: { signsPerMonth: 4, overrides: {} },
    hidden: {},
    ...over,
  };
}

let seq = 0;
export function out(channelId: string, at: number, over: Partial<MessageFact> = {}): MessageFact {
  seq += 1;
  return {
    id: `t${String(seq)}`,
    channelId,
    direction: "out",
    at,
    kind: "first",
    followUp: null,
    mailbox: "a@x.test",
    reading: null,
    bounce: false,
    edited: null,
    rewrite: null,
    ...over,
  };
}

export function incoming(
  channelId: string,
  at: number,
  over: Partial<MessageFact> = {},
): MessageFact {
  seq += 1;
  return {
    id: `t${String(seq)}`,
    channelId,
    direction: "in",
    at,
    kind: null,
    followUp: null,
    mailbox: "a@x.test",
    reading: null,
    bounce: false,
    edited: null,
    rewrite: null,
    ...over,
  };
}

export const ev = (channelId: string, stage: StageEvent["stage"], at: number): StageEvent => ({
  channelId,
  stage,
  at,
});
