import { seesMoney, sortRoles } from "./access";
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
export const exampleSeedVersion = 2;

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
  /** A teammate's search in progress, as seen at `now`. */
  mateRun(now: number): MateRun;
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
