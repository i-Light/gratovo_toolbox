import { seesMoney, sortRoles } from "./access";
import type { NewDraft, NewMessage } from "./outreach-store";
import { threadPreviewMax } from "./reach-types";
import type {
  DraftProposal,
  DraftState,
  OutreachDraft,
  ReachData,
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
export const exampleSeedVersion = 4;

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
  readonly brands: readonly Brand[];
  readonly deals: readonly Deal[];
  /** Newest first. */
  readonly notifications: readonly FrameNotification[];
  /** The `mail.settings` row of `local_settings`: the example mailboxes and the sender's name. */
  readonly mailSettings: ExampleMailSettings;
  /** Reach's rows: the drafts waiting for a person and the emails already sent or received. */
  readonly outreach: {
    readonly drafts: readonly ExampleDraft[];
    readonly messages: readonly NewMessage[];
  };
  /** A teammate's search in progress, as seen at `now`. */
  mateRun(now: number): MateRun;
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

/** The example fixtures, with times relative to `now`. */
export function exampleSeed(now: number): ExampleSeed {
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
    creators,
    brands,
    deals,
    notifications: notifications(now),
    mailSettings: mailSettings(now),
    outreach: { drafts: drafts(now), messages: messages(now) },
    mateRun: (at) => mateRun(dayTime(at, 0, 9, 2)),
  };
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
    log: [],
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

/** Five signed creators and two new finds, as in the prototype's data.js. */
const creators: readonly Creator[] = [
  {
    id: "c1",
    name: "Prompt Lab",
    handle: "@promptlab",
    stage: "signed",
    email: "hello@promptlab.tv",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c2",
    name: "Neural Notes",
    handle: "@neuralnotes",
    stage: "signed",
    email: "team@neuralnotes.io",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c3",
    name: "Code with Kai",
    handle: "@codewithkai",
    stage: "signed",
    email: "kai@codewithkai.dev",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c4",
    name: "Tensor Talk",
    handle: "@tensortalk",
    stage: "signed",
    email: "biz@tensortalk.com",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c5",
    name: "The AI Desk",
    handle: "@theaidesk",
    stage: "signed",
    email: "desk@theaidesk.news",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c11",
    name: "Model Matters",
    handle: "@modelmatters",
    stage: "new",
    email: "modelmatters.yt@gmail.com",
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  {
    id: "c12",
    name: "Prompt Daily",
    handle: "@promptdaily",
    stage: "new",
    email: null,
    emailConfirmed: false,
    contactName: null,
    contactSource: null,
    contactConfidence: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  },
  confirmed("c6", "Agent Weekly", "@agentweekly", "contact", "hello@agentweekly.ai", "Jonas"),
  confirmed("c7", "LLM Lowdown", "@llmlowdown", "contact", "partners@llmlowdown.com", "Ravi"),
  confirmed("c13", "Token Tuesday", "@tokentuesday", "contact", "hi@tokentuesday.ai", "Dana"),
  confirmed("c8", "Ship AI", "@shipai", "emailed", "team@shipai.dev", "Mia"),
  confirmed(
    "c9",
    "Diffusion Diaries",
    "@diffusiondiaries",
    "emailed",
    "biz@diffusiondiaries.com",
    "Theo",
  ),
  confirmed("c10", "Vector Vlog", "@vectorvlog", "replied", "hi@vectorvlog.io", "Noor"),
];

const brands: readonly Brand[] = [
  { id: "b1", name: "Codewell", sells: "AI code review", status: "won" },
  { id: "b2", name: "Lumen AI", sells: "AI writing assistant", status: "won" },
  { id: "b3", name: "VoxCraft", sells: "AI voice-over", status: "won" },
  { id: "b4", name: "Pagewise", sells: "AI notes and docs", status: "won" },
  { id: "b5", name: "Clipforge", sells: "AI video editor", status: "negotiating" },
];

const deals: readonly Deal[] = [
  { id: "d1", brand: "b1", creator: "c3", step: 1, price: 4800 },
  { id: "d2", brand: "b2", creator: "c2", step: 3, price: 2600 },
  { id: "d3", brand: "b3", creator: "c1", step: 6, price: 3400 },
  { id: "d4", brand: "b4", creator: "c5", step: 7, price: 2200 },
  { id: "d5", brand: "b5", creator: "c4", step: 0, price: 5200 },
];

/** A teammate's search in progress (Omar, keyword 12 of 40), started at `at`. */
function mateRun(at: number): MateRun {
  return { by: "u3", at, current: 12, total: 40 };
}

/** A creator whose address a person confirmed (read off the About page). */
function confirmed(
  id: string,
  name: string,
  handle: string,
  stage: Creator["stage"],
  email: string,
  contactName: string,
): Creator {
  return {
    id,
    name,
    handle,
    stage,
    email,
    emailConfirmed: true,
    contactName,
    contactSource: "about",
    contactConfidence: 0.9,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
  };
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
    rules: ["INF-FIRST-02", "FND-WRITE-11"],
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
      creator: "c6",
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
      creator: "c13",
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
      creator: "c7",
      at: now - hour,
      subject: "Open models on a laptop",
      body: 'Hi Ravi,\n\n"Five Open Models You Can Run on a Laptop" is the video I send people when they ask where to start. The benchmark table at the end was useful.\n\nWe worked with Lumen AI before, and a similar brand is looking for channels like yours. Would you want to hear the details?\n\nMoustafa',
      proposal: {
        status: "needs_human",
        why: "Points at the video and asks one question; one claim needs a person to confirm it.",
        rules: ["INF-FIRST-02", "FND-WRITE-11"],
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
      "c8",
      now - 2 * dayMs,
      "outreach1@gratovo.example",
      "team@shipai.dev",
      "Mia",
      "Your video on shipping AI features",
      'Hi Mia,\n\nI watched "Shipping an AI Feature in a Weekend" and liked how honest you were about the parts that broke.\n\nWe work with AI tool brands looking for creators who test things for real. Would you be open to a paid sponsorship?\n\nMoustafa',
    ),
    out(
      "msg2",
      "c9",
      now - 5 * dayMs,
      "outreach3@gratovo.example",
      "biz@diffusiondiaries.com",
      "Theo",
      "Your image model comparison",
      'Hi Theo,\n\n"Four Image Models, One Prompt" was a fair test, and the section on hands made me laugh.\n\nWe work with AI tool brands that would suit your viewers. Can I tell you about one?\n\nMoustafa',
    ),
    out(
      "msg3",
      "c10",
      now - 6 * dayMs,
      "outreach1@gratovo.example",
      "hi@vectorvlog.io",
      "Noor",
      "Your vector database video",
      'Hi Noor,\n\nYour "Vector Databases in 10 Minutes" cleared up what three other videos had not.\n\nWe work with AI tool brands and think one fits your channel. Would you be open to hearing about a sponsorship?\n\nMoustafa',
    ),
    {
      id: "msg4",
      creator: "c10",
      direction: "in",
      kind: null,
      followUp: null,
      subject: "Re: Your vector database video",
      body: "Hi Moustafa,\n\nThanks for the kind words! Which brand is this for? I only take sponsors I use myself.\n\nNoor",
      bodyCut: false,
      at: now - dayMs,
      mailbox: "outreach1@gratovo.example",
      peer: "hi@vectorvlog.io",
      peerName: "Noor",
      conversationKey: "c:c10",
      gmailMessageId: "gm-msg4",
      gmailThreadId: "gt-c10",
      draftId: null,
      by: null,
      source: "sweep",
      reading: null,
    },
  ];
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
      const lastIn = [...sorted].reverse().find((m) => m.direction === "in");
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
    sequences: [],
    threads,
    mailboxes: [],
    gemini: "off",
    geminiPausedUntil: null,
    sender: null,
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
