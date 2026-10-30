import type {
  ArchiveFacts,
  BrandFact,
  ChannelFacts,
  DealFact,
  InsightsInputs,
  MessageFact,
  StageEvent,
} from "./inputs";

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
    goal: { signsPerMonth: 4, revenuePerMonth: null, overrides: {} },
    hidden: {},
    deals: [],
    brands: [],
    dealEvents: [],
    brandEvents: [],
    seesMoney: true,
    marginFloorPct: 25,
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

/** A deal with every date and amount unknown; set what a test needs. */
export function deal(id: string, over: Partial<DealFact> = {}): DealFact {
  return {
    id,
    brandId: "b1",
    creatorId: "c1",
    step: 0,
    price: null,
    payout: null,
    createdAt: null,
    goLiveAt: null,
    invoiceSentAt: null,
    invoiceDueAt: null,
    invoicePaidAt: null,
    paidCreatorAt: null,
    reportViews: null,
    usualViews: null,
    reportSentAt: null,
    ...over,
  };
}

export function brand(id: string, over: Partial<BrandFact> = {}): BrandFact {
  return { id, name: `Brand ${id}`, status: "found", since: null, ...over };
}

const ago = (days: number): number => NOW - days * DAY;

/** Five deals over the months, with one of every trouble. */
export function moneyWorld(over: Partial<InsightsInputs> = {}): InsightsInputs {
  return inputs({
    goal: { signsPerMonth: 4, revenuePerMonth: 5000, overrides: {} },
    channels: [
      ch("c1", { stage: "signed" }),
      ch("c2", { stage: "signed" }),
      ch("c4", { stage: "signed" }),
      ch("c5", { stage: "signed" }),
    ],
    events: [
      ev("c4", "signed", ago(90)),
      ev("c5", "signed", ago(10)),
      ev("c1", "signed", ago(120)),
    ],
    brands: [brand("b1"), brand("b2"), brand("b3")],
    deals: [
      // Paid by the brand, the creator not paid yet; its report went out and no next deal came.
      deal("d1", {
        brandId: "b1",
        creatorId: "c1",
        step: 8,
        price: 10000,
        payout: 6000,
        createdAt: ago(60),
        invoiceSentAt: ago(50),
        invoicePaidAt: ago(20),
        reportSentAt: ago(23),
        reportViews: 120,
        usualViews: 100,
      }),
      // Paid in September, the creator paid too.
      deal("d2", {
        brandId: "b1",
        creatorId: "c1",
        step: 9,
        price: 3000,
        payout: 2000,
        createdAt: ago(80),
        invoiceSentAt: ago(64),
        invoicePaidAt: ago(48),
        paidCreatorAt: ago(40),
        reportViews: 60,
        usualViews: 100,
      }),
      // Late 10 days, thin margin.
      deal("d3", {
        brandId: "b2",
        creatorId: "c2",
        step: 6,
        price: 4000,
        payout: 3500,
        createdAt: ago(30),
        invoiceSentAt: ago(40),
      }),
      // Late 70 days; this brand never paid.
      deal("d4", {
        brandId: "b3",
        creatorId: "c2",
        step: 6,
        price: 2000,
        payout: 1000,
        createdAt: ago(110),
        invoiceSentAt: ago(100),
      }),
      // Sent 5 days ago: not due yet.
      deal("d5", {
        brandId: "b2",
        creatorId: "c1",
        step: 7,
        price: 1000,
        createdAt: ago(5),
        invoiceSentAt: ago(5),
      }),
    ],
    ...over,
  });
}
