import { kitView } from "../close/audience";
import { readReplyFacts } from "../reach/reply-facts";

import { seesMoney, sortRoles } from "./access";
import { brokeSeed, firstSeed } from "./example-scenarios";
import type { NewDraft, NewMessage } from "./outreach-store";
import { threadPreviewMax } from "./reach-types";
import { moreDrafts, moreMessages, moreSequences } from "./example-reach-more";
import { exampleChannelId, exampleRoster } from "./example-roster";
import type { ExampleChannel } from "./example-roster";
import { exampleBrands, exampleDeals } from "./example-work";
import type {
  DraftProposal,
  DraftState,
  OutreachDraft,
  ReachData,
  Sequence,
  ThreadSummary,
} from "./reach-types";
import type {
  AgencyRole,
  AppRole,
  Brand,
  Creator,
  Deal,
  Frame,
  FrameNotification,
  LogEntry,
  MateRun,
  RailCounts,
} from "./types";

/**
 * The example data the app runs on in builds without Supabase settings (dev and the tests): the
 * team with their agency roles, the rail counts, the notifications and a few records (creators, brands, deals), all about AI creators and the brands
 * that sponsor them. These words are data, not interface strings, so they live here and not in the
 * renderer's strings.ts.
 */

/** Bump it when the fixtures change: an older example database is then seeded again. */
export const exampleSeedVersion = 10;

/** The example copies prototype mode starts from (ADR 0004). The same list as the IPC's `scenarioKeys`. */
export const scenarios = ["normal", "first", "later", "broke"] as const;
export type Scenario = (typeof scenarios)[number];

/** What is broken in an example copy (the "Something broke" scenario). */
export interface ExampleHealth {
  /** Mailbox addresses shown as signed out of Gmail. */
  readonly signedOut: readonly string[];
  /** Drafting acts as if the Gemini bridge is off. */
  readonly geminiOffline: boolean;
}

/** One creator's stored audience numbers, in the shapes the columns hold. */
export interface ExampleKit {
  /** What a person typed: `{countries:[{code,pct}], ageBand, engagement, link, rates:[...]}`. */
  readonly mediaKit?: Readonly<Record<string, unknown>>;
  /** What replies gave: `{rate, countries:[{code,share}], age}`. */
  readonly provided?: Readonly<Record<string, unknown>>;
  /** `manual_engagement_rate`, in %. */
  readonly engagement?: number;
}

/** What the example database is seeded from, and the extras (presence, counts, a run) it serves. */
export interface ExampleSeed {
  /** A member id. */
  readonly me: string;
  readonly profiles: readonly {
    readonly id: string;
    /** `""` while the person hasn't set a name. */
    readonly displayName: string;
    readonly role: AppRole;
  }[];
  /** Each member's agency roles and "sees money" switch (Supabase's `member_access`). */
  readonly access: readonly {
    /** A member id. */
    readonly profileId: string;
    readonly roles: readonly AgencyRole[];
    readonly seesMoney: boolean;
  }[];
  /** By member id: what Supabase has no column for (presence is realtime). */
  readonly presence: Readonly<
    Record<string, { readonly status: "online" | "away"; readonly doing: string }>
  >;
  readonly counts: RailCounts;
  readonly creators: readonly Creator[];
  /**
   * Each creator's channel as the search found it (subscribers, uploads, sponsors seen, videos).
   * Prototype mode writes them into the example catalog (plan step P1, F6); the plain example
   * copy keeps no catalog rows.
   */
  readonly channels: readonly ExampleChannel[];
  /**
   * The log lines of the creators turned down (a reject or a never-contact line each), newest
   * first: the database reads a creator's reject reason, time and never reason back from them.
   */
  readonly log: readonly LogEntry[];
  /**
   * By creator id: the stored audience numbers (`channel_state.media_kit`, `provided_data` and
   * `manual_engagement_rate`) the audience check reads. Not part of the Creator row.
   */
  readonly kits: Readonly<Record<string, ExampleKit>>;
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  /** Newest first. */
  readonly notifications: readonly FrameNotification[];
  /** The `mail.settings` row of `local_settings`: the example mailboxes and the sender's name. */
  readonly mailSettings: ExampleMailSettings;
  /** The `reach.mailboxes` row of `local_settings` (D20): pause and slowdown, by address in lower case. */
  readonly reachMailboxes: Readonly<
    Record<string, { readonly paused: boolean; readonly slowed: boolean }>
  >;
  /** Reach's rows: the drafts waiting for a person and the emails already sent or received. */
  readonly outreach: {
    readonly drafts: readonly ExampleDraft[];
    readonly messages: readonly NewMessage[];
    /** The follow-up sequences of the emailed creators (D22). */
    readonly sequences: readonly Sequence[];
  };
  /** A teammate's search in progress, as seen at `now`. */
  mateRun(now: number): MateRun;
  /** What is broken in this copy; null when nothing is. */
  readonly health: ExampleHealth | null;
}

/** The example mail settings, in the shape Settings › Connections stores them. */
export interface ExampleMailSettings {
  readonly label: string;
  readonly senderName: string;
  readonly mailboxes: readonly {
    readonly address: string;
    readonly dailyCap: number;
    /** A date, `YYYY-MM-DD`; null when the mailbox is warm already. */
    readonly warmupStartedOn: string | null;
  }[];
}

/** A draft in the example seed: a new draft already filled in. */
export interface ExampleDraft extends NewDraft {
  readonly state: DraftState;
  readonly subject: string;
  readonly body: string;
  readonly proposal: DraftProposal | null;
}

/**
 * The example fixtures, with times relative to `now`. A scenario is a variant (D9): `later` is the
 * same data a week older, `first` an empty account, `broke` the normal data with things failing.
 */
export function exampleSeed(now: number, scenario: Scenario = "normal"): ExampleSeed {
  if (scenario === "first") return firstSeed(normalSeed(now), now);
  if (scenario === "broke") return brokeSeed(normalSeed(now), now);
  return normalSeed(scenario === "later" ? now - 7 * 24 * 3600 * 1000 : now);
}

function normalSeed(now: number): ExampleSeed {
  const people = exampleRoster(now);
  return {
    me,
    profiles: team.map(({ id, displayName, role }) => ({ id, displayName, role })),
    access: team.map(({ id, roles, seesMoney: money }) => ({
      profileId: id,
      roles,
      seesMoney: money,
    })),
    presence: Object.fromEntries(team.map(({ id, status, doing }) => [id, { status, doing }])),
    counts: { today: 28, plannedMinutes: 90, find: 15, reach: 10, close: 6, deliver: 7 },
    creators: people.map(({ creator }) => ({
      ...creator,
      kit: kitView(
        kits[creator.id]?.mediaKit ?? null,
        kits[creator.id]?.provided ?? null,
        kits[creator.id]?.engagement ?? null,
      ),
    })),
    channels: people.map(({ channel }) => channel),
    log: turnedDownLog(people.map(({ creator }) => creator)),
    kits,
    brands: exampleBrands(now),
    deals: exampleDeals(now),
    notifications: notifications(now),
    mailSettings: mailSettings(now),
    reachMailboxes: { "outreach3@gratovo.example": { paused: false, slowed: true } },
    outreach: {
      drafts: [...drafts(now), ...moreDrafts(now)],
      messages: [...messages(now), ...moreMessages(now), ...history(now)],
      sequences: [...sequences(now), ...moreSequences(now)],
    },
    mateRun: (at) => mateRun(dayTime(at, 0, 9, 2)),
    health: null,
  };
}

/** A creator's id from its short key ("c1"). */
const id = exampleChannelId;

/** Who turned each rejected or never-contact creator down (v6), by roster key. */
const turnedDownBy: Readonly<Record<string, string>> = {
  [id("c42")]: "u3",
  [id("c43")]: "u1",
  [id("c44")]: "u2",
};

/** The reject or never line of every creator that was turned down, newest first. */
function turnedDownLog(list: readonly Creator[]): readonly LogEntry[] {
  const lines: LogEntry[] = [];
  list.forEach((c, i) => {
    if (c.rejectedAt === null) return;
    const never = c.stage === "never";
    lines.push({
      id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, "0")}`,
      at: c.rejectedAt,
      who: turnedDownBy[c.id] ?? me,
      // The words the app itself writes (strings.findActions).
      text: never ? `${c.name} will never be emailed` : `${c.name} rejected`,
      ref: c.id,
      action: never ? "creator.never" : "creator.reject",
      detail: never ? c.neverReason : c.rejectReason,
    });
  });
  return lines.sort((a, b) => b.at - a.at);
}

/** What a freshly seeded example source returns at `now`. */
export function exampleFrame(now: number): Frame {
  const seed = exampleSeed(now);
  // You are the Owner in the example, so you see money: nothing is hidden.
  const mine = team.find((member) => member.id === me);
  return {
    source: "example",
    me,
    // Your display name is `""` in the fixtures: unset.
    myName: null,
    team: team.map(({ id, displayName, role, roles, status, doing }) => ({
      id,
      name: displayName,
      role,
      roles: sortRoles(roles),
      status,
      doing,
    })),
    counts: seed.counts,
    notifications: [...seed.notifications].sort(newestFirst),
    log: seed.log,
    creators: seed.creators,
    brands: seed.brands,
    deals: seed.deals,
    mateRun: seed.mateRun(now),
    conflicts: [],
    notify: {},
    seesMoney: mine !== undefined && seesMoney(mine),
    reach: exampleReach(seed.outreach),
  };
}

/** The signed-in member in the example. */
const me = "u1";

/**
 * The team: who they are (`profiles`), their agency roles and money switch (`member_access`), and
 * what Supabase has no column for (presence). Omar is the owner's own example of a member: Scout and
 * Outreach, no money.
 */
const team: readonly {
  readonly id: string;
  readonly displayName: string;
  readonly role: AppRole;
  readonly roles: readonly AgencyRole[];
  readonly seesMoney: boolean;
  readonly status: "online" | "away";
  readonly doing: string;
}[] = [
  {
    id: "u1",
    displayName: "",
    role: "full",
    roles: ["owner"],
    seesMoney: true,
    status: "online",
    doing: "Today",
  },
  {
    id: "u2",
    displayName: "Sara",
    role: "basic",
    roles: ["deal_lead", "delivery"],
    seesMoney: true,
    status: "online",
    doing: "Reach · replies",
  },
  {
    id: "u3",
    displayName: "Omar",
    role: "basic",
    roles: ["scout", "outreach"],
    seesMoney: false,
    status: "online",
    doing: "Search · keyword 12 of 40",
  },
  {
    id: "u4",
    displayName: "Lina",
    role: "basic",
    roles: ["scout"],
    seesMoney: false,
    status: "away",
    doing: "Away until 13:00",
  },
];

/** Newest first; the same time falls back to the id, in order. */
function newestFirst(a: FrameNotification, b: FrameNotification): number {
  return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A time on the same calendar day as `now` plus `dayOffset` days, at that hour and minute (local time). */
function dayTime(now: number, dayOffset: number, hours: number, minutes: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** The tray's notifications, newest first. */
function notifications(now: number): readonly FrameNotification[] {
  const at = (dayOffset: number, hours: number, minutes: number): number =>
    dayTime(now, dayOffset, hours, minutes);
  return [
    {
      id: "n1",
      at: at(0, 8, 42),
      icon: "reply",
      text: "Copilot Corner replied with a rate and audience",
      sub: "Reach · Replies",
      go: { screen: "today", tab: null },
      read: false,
    },
    {
      id: "n2",
      at: at(0, 8, 31),
      icon: "pause",
      text: "Today's search paused after keyword 8",
      sub: "24 kept so far · everything is saved",
      go: { screen: "find", tab: "search" },
      read: false,
    },
    {
      id: "n4",
      at: at(0, 0, 5),
      icon: "wallet",
      text: "Pagewise invoice GR-2026-024 is 1 day overdue",
      sub: "$2,200 · due 18 Oct",
      go: { screen: "deliver", tab: "money" },
      read: true,
    },
    {
      id: "n3",
      at: at(-1, 17, 0),
      icon: "alert",
      text: "outreach3 slowed to 20 sends a day",
      sub: "Bounces reached 3.2% this week",
      go: { screen: "reach", tab: "mailboxes" },
      read: false,
    },
    {
      id: "n6",
      at: at(-1, 11, 0),
      icon: "forward",
      text: "Sara handed you Clipforge × Tensor Talk",
      sub: '"Brand countered at $4,500, your call on price"',
      go: { screen: "close", tab: "negotiate" },
      read: true,
    },
    {
      id: "n5",
      at: at(-4, 15, 10),
      icon: "unlock",
      text: "Lumen AI paid $2,600, so The AI Desk can be paid",
      sub: "Payout $1,500 unlocked",
      go: { screen: "deliver", tab: "money" },
      read: true,
    },
  ];
}

const typedKit = (
  countries: readonly (readonly [string, number])[],
  ageBand: string,
  engagement: number,
  price: number,
  link: string,
): ExampleKit => ({
  mediaKit: {
    countries: countries.map(([code, pct]) => ({ code, pct })),
    ageBand,
    engagement,
    link,
    rates: [{ format: "integration", price }],
  },
});

/** The stored audience numbers: typed kits for the signed and two kit-stage creators, a reply's for the third. */
const kits: Readonly<Record<string, ExampleKit>> = {
  [id("c1")]: typedKit(
    [
      ["US", 52],
      ["GB", 14],
      ["CA", 9],
    ],
    "25-34",
    4.6,
    3400,
    "https://promptlab.tv/kit",
  ),
  [id("c2")]: typedKit(
    [
      ["US", 47],
      ["CA", 12],
      ["AU", 8],
    ],
    "18-34",
    3.9,
    2600,
    "https://neuralnotes.tv/kit",
  ),
  [id("c3")]: typedKit(
    [
      ["US", 58],
      ["GB", 11],
      ["DE", 6],
    ],
    "25-34",
    5.1,
    4800,
    "https://codewithkai.dev/kit",
  ),
  [id("c4")]: typedKit(
    [
      ["US", 44],
      ["GB", 16],
      ["AU", 9],
    ],
    "18-34",
    4.2,
    5200,
    "https://tensortalk.tv/kit",
  ),
  [id("c5")]: typedKit(
    [
      ["US", 41],
      ["CA", 13],
      ["GB", 10],
    ],
    "25-44",
    3.4,
    2200,
    "https://theaidesk.tv/kit",
  ),
  [id("c17")]: typedKit(
    [
      ["US", 37],
      ["GB", 12],
      ["CA", 9],
    ],
    "18-34",
    5.4,
    1900,
    "https://agentarena.gg/kit",
  ),
  [id("c45")]: typedKit(
    [
      ["US", 49],
      ["GB", 13],
      ["CA", 9],
    ],
    "25-34",
    4.8,
    1700,
    "https://openweights.dev/kit",
  ),
  [id("c14")]: typedKit(
    [
      ["US", 55],
      ["GB", 12],
      ["CA", 8],
    ],
    "18-34",
    4.2,
    900,
    "https://agentworks.ai/kit",
  ),
  [id("c15")]: typedKit(
    [
      ["IN", 46],
      ["US", 17],
      ["PK", 9],
    ],
    "18-24",
    2.1,
    650,
    "https://siliconsage.io/kit",
  ),
  [id("c16")]: {
    provided: {
      rate: 900,
      countries: [
        { code: "US", share: 48 },
        { code: "CA", share: 14 },
      ],
      age: "25-34",
    },
  },
};

/** A teammate's search in progress (Omar, keyword 12 of 40), started at `at`. */
function mateRun(at: number): MateRun {
  return { by: "u3", at, current: 12, total: 40 };
}

const hour = 60 * 60 * 1000;
const dayMs = 24 * hour;

/** Three example mailboxes: two warm, and outreach2 on day 10 of its warm-up. */
function mailSettings(now: number): ExampleMailSettings {
  return {
    label: "Gratovo Outreach",
    senderName: "Moustafa",
    mailboxes: [
      { address: "outreach1@gratovo.example", dailyCap: 30, warmupStartedOn: null },
      {
        address: "outreach2@gratovo.example",
        dailyCap: 20,
        warmupStartedOn: new Date(now - 9 * dayMs).toISOString().slice(0, 10),
      },
      { address: "outreach3@gratovo.example", dailyCap: 30, warmupStartedOn: null },
    ],
  };
}

function firstProposal(why: string, summary: string): DraftProposal {
  return {
    status: "ready",
    why,
    rules: [],
    findings: [],
    gates: [],
    situation: { side: "creator", stage: "first", replyType: null, summary },
    model: "gemini",
  };
}

/** Three first emails waiting at the three contact creators (one asks a person to confirm a claim). */
function drafts(now: number): readonly ExampleDraft[] {
  const base = {
    kind: "first",
    followUp: null,
    state: "ready",
    mailbox: "outreach1@gratovo.example",
    replyTo: null,
  } as const;
  return [
    {
      ...base,
      id: "dr1",
      creator: id("c6"),
      at: now - 3 * hour,
      subject: "Your inbox agent video",
      body: 'Hi Jonas,\n\nI watched "I Let an AI Agent Run My Inbox for a Week" and the moment it booked its own meeting stuck with me. Your viewers clearly want tools tried on real work, not demos.\n\nWe work with AI tool brands that look for that kind of honest test. Would you be open to hearing about a paid sponsorship?\n\nMoustafa',
      proposal: firstProposal(
        "Opens on a specific video, asks one question, no price yet.",
        "Cold first email to an AI creator who tests agents",
      ),
    },
    {
      ...base,
      id: "dr2",
      creator: id("c13"),
      at: now - 2 * hour,
      subject: "Which model reviews code best?",
      body: 'Hi Dana,\n\nYour video "Which AI Model Reviews Code Best?" was the clearest comparison I have seen, and the test with the broken pull request was a smart choice.\n\nWe represent AI developer tools and think a few of them fit your channel. Can I send you a short note on one?\n\nMoustafa',
      proposal: firstProposal(
        "Names the video and the test, keeps it short, asks permission to send details.",
        "Cold first email to an AI creator who compares models",
      ),
    },
    {
      ...base,
      id: "dr3",
      creator: id("c7"),
      at: now - hour,
      subject: "Open models on a laptop",
      body: 'Hi Ravi,\n\n"Five Open Models You Can Run on a Laptop" is the video I send people when they ask where to start. The benchmark table at the end was useful.\n\nWe worked with Lumen AI before, and a similar brand is looking for channels like yours. Would you want to hear the details?\n\nMoustafa',
      proposal: {
        status: "needs_human",
        why: "Points at the video and asks one question; one claim needs a person to confirm it.",
        rules: [],
        findings: [],
        gates: [
          {
            key: "g-claim",
            kind: "claim",
            text: "It says we worked with Lumen AI before. Confirm that is true.",
          },
        ],
        situation: {
          side: "creator",
          stage: "first",
          replyType: null,
          summary: "Cold first email to an AI creator who covers open models",
        },
        model: "gemini",
      },
    },
  ];
}

/** Noor's answer: a question, a rate and a few audience numbers, so the reading has facts. */
const replyBody =
  "Hi Moustafa,\n\nThanks for the kind words! Which brand is this for? I only take sponsors I use myself.\n\nFor a dedicated video my rate is $1,200. My audience is mostly US and UK, ages 25-34.\n\nNoor";

/**
 * The kit-stage creators' threads: our first email, their answer with the numbers, and our thanks
 * (so no reply waits to be answered: the audience check is what waits).
 */
function kitMessages(now: number): readonly NewMessage[] {
  const pair = (
    n: number,
    creator: string,
    mailbox: string,
    peer: string,
    peerName: string,
    subject: string,
    sent: string,
    answer: string,
    thanks: string,
  ): readonly NewMessage[] => {
    const base = {
      creator,
      followUp: null,
      bodyCut: false,
      mailbox,
      peer,
      peerName,
      conversationKey: `c:${creator}`,
      gmailThreadId: `gt-${creator}`,
      draftId: null,
      reading: null,
    } as const;
    return [
      {
        ...base,
        id: `msg${String(n)}`,
        direction: "out",
        kind: "first",
        subject,
        body: sent,
        at: now - (4 + (n % 3)) * dayMs,
        gmailMessageId: `gm-msg${String(n)}`,
        by: me,
        source: "app",
      },
      {
        ...base,
        id: `msg${String(n + 1)}`,
        direction: "in",
        kind: null,
        subject: `Re: ${subject}`,
        body: answer,
        at: now - (2 + (n % 2)) * dayMs,
        gmailMessageId: `gm-msg${String(n + 1)}`,
        by: null,
        source: "sweep",
      },
      {
        ...base,
        id: `msg${String(n + 2)}`,
        direction: "out",
        kind: "reply",
        subject: `Re: ${subject}`,
        body: thanks,
        at: now - dayMs,
        gmailMessageId: `gm-msg${String(n + 2)}`,
        by: me,
        source: "app",
      },
    ];
  };
  return [
    ...pair(
      6,
      id("c14"),
      "outreach1@gratovo.example",
      "hello@agentworks.ai",
      "Elena",
      "Your AI agents series",
      "Hi Elena,\n\nYour series on building AI agents that actually finish a task was the clearest I have seen.\n\nWe work with AI tool brands and think one fits. Would you be open to a paid sponsorship?\n\nMoustafa",
      "Hi Moustafa,\n\nThanks, happy to hear about it. My media kit is here: https://agentworks.ai/kit\n\nElena",
      "Thanks Elena, that is everything I need. I will check it against what our brands are after and come back to you in a day or two.\n\nMoustafa",
    ),
    ...pair(
      9,
      id("c15"),
      "outreach2@gratovo.example",
      "team@siliconsage.io",
      "Arjun",
      "Your LLM explainers",
      "Hi Arjun,\n\nYour explainer on how large language models are trained was easy to follow.\n\nWe work with AI tool brands and would like to tell you about one. Open to a paid sponsorship?\n\nMoustafa",
      "Hi Moustafa,\n\nSounds interesting. Here is my media kit: https://siliconsage.io/kit\n\nArjun",
      "Thanks Arjun, got it. I will look through it and come back to you this week.\n\nMoustafa",
    ),
    ...pair(
      12,
      id("c16"),
      "outreach1@gratovo.example",
      "hi@contextwindow.dev",
      "Sam",
      "Your long-context video",
      "Hi Sam,\n\nYour test of what happens when you fill a model's whole context window was a good watch.\n\nWe work with AI tool brands. Would you be open to hearing about a sponsorship?\n\nMoustafa",
      "Hi Moustafa,\n\nOpen to it. A dedicated video is $900. Most of my viewers are in the US and Canada, ages 25-34.\n\nSam",
      "Thanks Sam, that helps. I will come back to you in a day or two.\n\nMoustafa",
    ),
    ...pair(
      15,
      id("c45"),
      "outreach2@gratovo.example",
      "hello@openweights.dev",
      "Kira",
      "Your open weights series",
      "Hi Kira,\n\nYour weekly walk through which open model to pick, with the same test run on each, was easy to trust.\n\nWe work with AI tool brands and think one fits your channel. Would you be open to a paid sponsorship?\n\nMoustafa",
      "Hi Moustafa,\n\nHappy to hear more. My media kit and the audience numbers are here: https://openweights.dev/kit\n\nKira",
      "Thanks Kira, the audience numbers look strong. I will match them against our open briefs and come back to you this week.\n\nMoustafa",
    ),
  ];
}

/** Three first emails sent, and one friendly answer. */
function messages(now: number): readonly NewMessage[] {
  const out = (
    id: string,
    creator: string,
    at: number,
    mailbox: string,
    peer: string,
    peerName: string,
    subject: string,
    body: string,
  ): NewMessage => ({
    id,
    creator,
    direction: "out",
    kind: "first",
    followUp: null,
    subject,
    body,
    bodyCut: false,
    at,
    mailbox,
    peer,
    peerName,
    conversationKey: `c:${creator}`,
    gmailMessageId: `gm-${id}`,
    gmailThreadId: `gt-${creator}`,
    draftId: null,
    by: me,
    source: "app",
    reading: null,
  });
  return [
    out(
      "msg1",
      id("c8"),
      now - 2 * dayMs,
      "outreach1@gratovo.example",
      "team@shipai.dev",
      "Mia",
      "Your video on shipping AI features",
      'Hi Mia,\n\nI watched "Shipping an AI Feature in a Weekend" and liked how honest you were about the parts that broke.\n\nWe work with AI tool brands looking for creators who test things for real. Would you be open to a paid sponsorship?\n\nMoustafa',
    ),
    out(
      "msg2",
      id("c9"),
      now - 5 * dayMs,
      "outreach3@gratovo.example",
      "biz@diffusiondiaries.com",
      "Theo",
      "Your image model comparison",
      'Hi Theo,\n\n"Four Image Models, One Prompt" was a fair test, and the section on hands made me laugh.\n\nWe work with AI tool brands that would suit your viewers. Can I tell you about one?\n\nMoustafa',
    ),
    out(
      "msg3",
      id("c10"),
      now - 6 * dayMs,
      "outreach1@gratovo.example",
      "hi@vectorvlog.io",
      "Noor",
      "Your vector database video",
      'Hi Noor,\n\nYour "Vector Databases in 10 Minutes" cleared up what three other videos had not.\n\nWe work with AI tool brands and think one fits your channel. Would you be open to hearing about a sponsorship?\n\nMoustafa',
    ),
    {
      id: "msg5",
      creator: id("c9"),
      direction: "out",
      kind: "followUp",
      followUp: 1,
      subject: "Your image model comparison",
      body: 'Hi Theo,\n\nA short follow-up on my note about "Four Image Models, One Prompt". Would you like to hear which AI tool brand I had in mind?\n\nMoustafa',
      bodyCut: false,
      at: now - 2 * dayMs,
      mailbox: "outreach3@gratovo.example",
      peer: "biz@diffusiondiaries.com",
      peerName: "Theo",
      conversationKey: `c:${id("c9")}`,
      gmailMessageId: "gm-msg5",
      gmailThreadId: `gt-${id("c9")}`,
      draftId: null,
      by: me,
      source: "app",
      reading: null,
    },
    ...kitMessages(now),
    {
      id: "msg4",
      creator: id("c10"),
      direction: "in",
      kind: null,
      followUp: null,
      subject: "Re: Your vector database video",
      body: replyBody,
      bodyCut: false,
      at: now - dayMs,
      mailbox: "outreach1@gratovo.example",
      peer: "hi@vectorvlog.io",
      peerName: "Noor",
      conversationKey: `c:${id("c10")}`,
      gmailMessageId: "gm-msg4",
      gmailThreadId: `gt-${id("c10")}`,
      draftId: null,
      by: null,
      source: "sweep",
      reading: {
        replyType: "inf.gives_rate",
        label: "Gives their rate or rate card",
        summary:
          "They asked which brand it is for, and gave a price for one video and their audience.",
        side: "influencer",
        corrected: false,
        facts: readReplyFacts(replyBody),
      },
    },
  ];
}

/**
 * The sequences of the two emailed creators (D22). No step is due at load, so the stand-in
 * drafter writes nothing by itself. Ship AI's first email went 2 days ago (step 1 is in a day);
 * Diffusion Diaries' went 5 days ago and its first follow-up went with it 3 days after (msg5).
 * Parked and stopped sequences are not seeded: every other creator's stage is pinned by a test.
 */
function sequences(now: number): readonly Sequence[] {
  const step = (n: number, dueAt: number, state: "planned" | "sent", sentAt: number | null) => ({
    n,
    dueAt,
    state,
    sentAt,
  });
  return [
    {
      creator: id("c8"),
      mailbox: "outreach1@gratovo.example",
      startedAt: now - 2 * dayMs,
      steps: [
        step(1, now + dayMs, "planned", null),
        step(2, now + 5 * dayMs, "planned", null),
        step(3, now + 12 * dayMs, "planned", null),
      ],
      stopped: null,
      parkUntil: null,
    },
    {
      creator: id("c9"),
      mailbox: "outreach3@gratovo.example",
      startedAt: now - 5 * dayMs,
      steps: [
        step(1, now - 2 * dayMs, "sent", now - 2 * dayMs),
        step(2, now + 2 * dayMs, "planned", null),
        step(3, now + 9 * dayMs, "planned", null),
      ],
      stopped: null,
      parkUntil: null,
    },
  ];
}

/**
 * outreach3's week, imported: 30 first emails to channels that belong to no creator in the
 * example, five of them answered, and one bounce. With the two real sends from outreach3 (a first
 * email and a follow-up) that is 32 sends and 1 bounce (3.1%), over the 3% line, so outreach3 is
 * slowed (D20). The sends sit on
 * the six days before today, so today's count is unchanged. No creator owns these channel ids, so
 * the board, the rail and the record never list them.
 */
function history(now: number): readonly NewMessage[] {
  const mailbox = "outreach3@gratovo.example";
  const base = {
    followUp: null,
    bodyCut: false,
    mailbox,
    conversationKey: null,
    gmailThreadId: null,
    draftId: null,
    source: "imported",
  } as const;
  const list: NewMessage[] = [];
  for (let i = 0; i < 30; i += 1) {
    const channel = `hist-ch-${String(i)}`;
    list.push({
      ...base,
      id: `hist-o3-${String(i)}`,
      creator: channel,
      direction: "out",
      kind: "first",
      subject: "Your latest video",
      body: "Imported from Gmail.",
      at: now - dayMs - i * 4 * hour,
      peer: `hello@${channel}.example`,
      peerName: null,
      gmailMessageId: `gm-hist-o3-${String(i)}`,
      by: me,
      reading: null,
    });
  }
  const reply = (i: number): NewMessage => ({
    ...base,
    id: `hist-in-${String(i)}`,
    creator: `hist-ch-${String(i)}`,
    direction: "in",
    kind: null,
    subject: "Re: Your latest video",
    body: "Imported from Gmail.",
    at: now - dayMs / 2 - i * hour,
    peer: `hello@hist-ch-${String(i)}.example`,
    peerName: null,
    gmailMessageId: `gm-hist-in-${String(i)}`,
    by: null,
    reading: null,
  });
  for (let i = 0; i < 5; i += 1) {
    list.push(reply(i));
  }
  list.push({
    ...reply(29),
    id: "hist-bounce",
    gmailMessageId: "gm-hist-bounce",
    subject: "Delivery Status Notification (Failure)",
    reading: {
      replyType: "any.bounce",
      label: "Bounce",
      summary: "The address does not exist.",
      side: "none",
      corrected: false,
      facts: [],
    },
  });
  return list;
}

/**
 * Reach in the frame, from the seed's rows by the same rules the database applies (drafts newest
 * first, one thread summary per creator, the newest thread first). Main overlays the mailboxes,
 * Gemini's state and the sender later, so a fresh source serves them empty.
 */
function exampleReach(outreach: ExampleSeed["outreach"]): ReachData {
  const drafts: OutreachDraft[] = outreach.drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => b.draft.at - a.draft.at || b.index - a.index)
    .map(({ draft }) => ({
      id: draft.id,
      creator: draft.creator,
      kind: draft.kind,
      followUp: draft.followUp,
      state: draft.state,
      subject: draft.subject,
      body: draft.body,
      mailbox: draft.mailbox,
      sendAt: null,
      proposal: draft.proposal,
      gatesOk: [],
      edited: false,
      checked: true,
      rewriting: null,
      replyTo: draft.replyTo,
      goal: null,
      problem: null,
      createdAt: draft.at,
      updatedAt: draft.at,
    }));
  const byCreator = new Map<string, NewMessage[]>();
  for (const message of outreach.messages) {
    byCreator.set(message.creator, [...(byCreator.get(message.creator) ?? []), message]);
  }
  const threads = [...byCreator.entries()]
    .map(([creator, list]) => {
      const sorted = [...list].sort((a, b) => a.at - b.at);
      const newest = sorted[sorted.length - 1];
      // As the store does: an imported reply (D19) never counts as one to answer.
      const lastIn = [...sorted]
        .reverse()
        .find((m) => m.direction === "in" && m.source !== "imported");
      const lastOut = [...sorted].reverse().find((m) => m.direction === "out");
      const summary: ThreadSummary = {
        creator,
        count: sorted.length,
        lastOutAt: lastOut?.at ?? null,
        lastIn:
          lastIn === undefined
            ? null
            : {
                id: lastIn.id,
                at: lastIn.at,
                reading: lastIn.reading,
                preview: previewOf(lastIn.body),
                bounce: lastIn.reading?.replyType === "any.bounce",
              },
        answered: newest?.direction === "out",
      };
      return { newest: newest?.at ?? 0, summary };
    })
    .sort((a, b) => b.newest - a.newest || (a.summary.creator < b.summary.creator ? -1 : 1))
    .map(({ summary }) => summary);
  return {
    drafts,
    // Newest first, as the database lists them.
    sequences: [...outreach.sequences].sort(
      (a, b) => b.startedAt - a.startedAt || (a.creator < b.creator ? -1 : 1),
    ),
    threads,
    mailboxes: [],
    gemini: "off",
    geminiPausedUntil: null,
    sender: null,
    zones: {},
  };
}

/** The first non-empty line of a body, cut to the preview length. */
function previewOf(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (text !== "") {
      return text.slice(0, threadPreviewMax);
    }
  }
  return "";
}

/**
 * The country of every example creator, by creator id, for Send later's "Their morning" (D21).
 * The plain example copy has no Find catalog to ask.
 */
export const exampleCountries: Readonly<Record<string, string>> = Object.fromEntries(
  exampleRoster(0).map(({ creator, channel }) => [creator.id, channel.country]),
);
