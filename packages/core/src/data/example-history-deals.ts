import { DEAL_FLOW } from "../deal-flow";
import { legacyDealStage } from "./legacy-mapping";
import { contractClauses, qcChecks } from "./work-types";
import type { BrandStatus } from "./work-types";

/**
 * The deal story of the example history (plan step P8b, decision B9): about 30 brands and 50 to
 * 60 deals over the six months, all about AI products, with the invoices, payouts and reports that
 * make Insights' Money and Brands tabs worth looking at. Pure and seeded, like the rest of the
 * history: the same inputs give the same rows.
 *
 * The story it tells (the mockup `design/insights/money.jpg`):
 * - what brands paid each month grows to about $25K, and the month in progress is on pace for a
 *   little under it;
 * - one brand pays slowly, so a few invoices are late, one of them over a month;
 * - two payouts are due, the margin is about 40% with one deal under the 25% floor;
 * - the average deal is up from about $2,600 to about $3,100;
 * - one brand makes up over 40% of the last 90 days' revenue;
 * - one signed creator has had no deal for over 60 days;
 * - two deals have sat in "Draft" far longer than usual;
 * - brands come back, but two finished reports have no next deal.
 *
 * Rows are named by the columns of their tables (`brands`, `brand_details`, `deals`,
 * `deal_details`, `deal_events`, `brand_events`) so main can insert them as they are. Times in the
 * synced tables are ISO text, in the detail and event tables ms, as those tables hold them.
 * Inserting `brands` and `deals` fires the event triggers (source `change`): the loader clears
 * those rows for these ids and inserts the events here.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A signed creator the deals can be with. */
export interface DealCreator {
  readonly id: string;
  /** When they signed, in ms; deals only start a day after. */
  readonly signedAt: number;
  /** Their usual views (the report's target). */
  readonly usualViews: number;
}

export interface DealsInput {
  readonly now: number;
  readonly creators: readonly DealCreator[];
  /** Member ids that own brands and deals. */
  readonly owners: readonly string[];
}

export interface HistoryBrandRow {
  id: string;
  name: string;
  sells: string;
  status: BrandStatus;
  category: string;
  country: string;
  website: string;
  /** JSON text. */
  contacts: string;
  budget: number;
  /** ISO text. */
  created_at: string;
  updated_at: string;
}

export interface HistoryBrandDetailRow {
  brand_id: string;
  headcount: number;
  recommended_title: string;
  paid_spender_verified: 0 | 1;
  past_campaign_hook: string;
  budget_high: number;
  /** JSON text: creator ids. */
  seen: string;
  /** In ms. */
  since: number;
  /** JSON text, or null before a pitch. */
  pitched: string | null;
  owner_id: string;
  status: BrandStatus;
}

export interface HistoryDealRow {
  id: string;
  brand_id: string;
  channel_id: string;
  stage: string;
  brand_price: number;
  influencer_payout: number;
  deliverables: string;
  payment_terms: string;
  /** ISO text. */
  brand_invoice_sent_at: string | null;
  brand_invoice_paid_at: string | null;
  creator_payout_paid_at: string | null;
  payment_reference: string | null;
  owner_id: string;
  flow_step: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryDealDetailRow {
  deal_id: string;
  model: "brokered" | "exclusive_25";
  /** JSON text. */
  checks: string;
  video_count: number;
  videos_delivered: number;
  /** In ms from here down. */
  creator_deadline: number;
  go_live_at: number;
  due_at: number | null;
  placement: string;
  invoice_number: string | null;
  invoice_due_at: number | null;
  /** JSON text. */
  report: string;
  live_url: string | null;
  clauses: string;
  redlines: string;
  shipping: string | null;
  script_approved: 0 | 1;
  qc: string;
  hype: string | null;
  whitelisting_until: number | null;
  cpm: string | null;
  negotiation: string | null;
}

export interface HistoryDealEventRow {
  deal_id: string;
  step: number;
  at: number;
  source: "example";
}

export interface HistoryBrandEventRow {
  brand_id: string;
  status: BrandStatus;
  at: number;
  source: "example";
}

export interface ExampleDeals {
  brands: HistoryBrandRow[];
  brandDetails: HistoryBrandDetailRow[];
  deals: HistoryDealRow[];
  dealDetails: HistoryDealDetailRow[];
  dealEvents: HistoryDealEventRow[];
  brandEvents: HistoryBrandEventRow[];
}

// ---------------------------------------------------------------------------------------------
// The brands

type BrandSpec = readonly [
  name: string,
  sells: string,
  category: string,
  country: string,
  site: string,
  headcount: number,
  hook: string,
];

/**
 * 30 AI products. The first 17 have deals: 0 is the one big brand, 1 the slow payer. The last 13
 * are in the pipeline, with no deal yet. None shares a name with the seed's ten.
 */
const brandSpecs: readonly BrandSpec[] = [
  [
    "Neurolane AI",
    "AI research assistant",
    "agents",
    "US",
    "neurolane.ai",
    180,
    "your deep-dive on research agents",
  ],
  [
    "Cortexa",
    "AI data analyst",
    "data",
    "GB",
    "cortexa.io",
    95,
    "the spreadsheet-to-insight demo you ran in March",
  ],
  [
    "Glyphwork",
    "AI design tool for slides and posts",
    "design",
    "US",
    "glyphwork.com",
    60,
    "your logo-in-ten-minutes video",
  ],
  [
    "Brainstack",
    "AI notes that link themselves",
    "notes",
    "CA",
    "brainstack.app",
    45,
    "your second-brain workflow video",
  ],
  [
    "Tokenwise",
    "LLM cost tracking",
    "code",
    "US",
    "tokenwise.dev",
    38,
    "the API-bill teardown on your channel",
  ],
  [
    "Replyr",
    "AI customer support replies",
    "support",
    "DE",
    "replyr.ai",
    70,
    "your helpdesk-bot build",
  ],
  [
    "Haloscribe",
    "AI meeting notes",
    "transcription",
    "US",
    "haloscribe.com",
    110,
    "your meeting-notes tool shootout",
  ],
  [
    "Kernelkit",
    "Local model runner for developers",
    "code",
    "NL",
    "kernelkit.dev",
    30,
    "your local-LLM setup series",
  ],
  [
    "Ironvoice",
    "AI voice cloning",
    "voice",
    "US",
    "ironvoice.ai",
    52,
    "your audiobook narration test",
  ],
  [
    "Lexiforge",
    "AI writing for marketers",
    "writing",
    "US",
    "lexiforge.com",
    85,
    "your newsletter-in-an-hour video",
  ],
  [
    "Omnidraft",
    "AI drafting for contracts",
    "writing",
    "GB",
    "omnidraft.co",
    64,
    "your lawyer-vs-AI contract test",
  ],
  [
    "Quantaflow",
    "No-code AI workflows",
    "agents",
    "US",
    "quantaflow.io",
    120,
    "your automation-stack tour",
  ],
  [
    "Scriptlane",
    "AI video scripts",
    "video",
    "AU",
    "scriptlane.com",
    40,
    "your faceless-channel experiment",
  ],
  [
    "Mindmesh",
    "AI knowledge base for teams",
    "notes",
    "US",
    "mindmesh.ai",
    130,
    "your company-wiki video",
  ],
  [
    "Parsebot",
    "AI document parsing",
    "data",
    "CA",
    "parsebot.dev",
    35,
    "your invoice-extraction build",
  ],
  [
    "Weavemodel",
    "Fine-tuning in the browser",
    "code",
    "US",
    "weavemodel.ai",
    48,
    "your fine-tune-a-model-in-a-day video",
  ],
  [
    "Fluxnote",
    "AI podcast editor",
    "video",
    "US",
    "fluxnote.fm",
    42,
    "your podcast-workflow video",
  ],
  [
    "Agentloop",
    "AI agent testing",
    "agents",
    "US",
    "agentloop.dev",
    58,
    "your agents-that-break video",
  ],
  [
    "DeepDesk",
    "AI search for work docs",
    "search",
    "US",
    "deepdesk.ai",
    210,
    "your search-your-own-files demo",
  ],
  [
    "Embedly AI",
    "Vector search API",
    "code",
    "SE",
    "embedly.ai",
    33,
    "your RAG-in-an-afternoon video",
  ],
  ["Jotmind", "AI journaling app", "notes", "US", "jotmind.app", 25, "your daily-AI-habits video"],
  [
    "Nimbus Prompt",
    "Prompt library for teams",
    "writing",
    "US",
    "nimbusprompt.com",
    28,
    "your prompt-pack giveaway",
  ],
  [
    "Unscript",
    "AI subtitles and dubbing",
    "video",
    "ES",
    "unscript.ai",
    75,
    "your dubbing-in-ten-languages test",
  ],
  [
    "Vaultmind",
    "Private AI for legal teams",
    "agents",
    "GB",
    "vaultmind.co",
    90,
    "your privacy-first AI video",
  ],
  [
    "Xenotype",
    "AI image upscaling",
    "image",
    "US",
    "xenotype.io",
    36,
    "your photo-restoration series",
  ],
  [
    "Yieldwise",
    "AI sales outreach",
    "email",
    "US",
    "yieldwise.ai",
    150,
    "your cold-email-with-AI test",
  ],
  [
    "Cadenza AI",
    "AI music for video",
    "voice",
    "FR",
    "cadenza.ai",
    44,
    "your royalty-free-music video",
  ],
  [
    "Pixelhaven",
    "AI product photos",
    "image",
    "US",
    "pixelhaven.com",
    55,
    "your shop-photos-with-AI video",
  ],
  [
    "Tutorly AI",
    "AI study tutor",
    "education",
    "CA",
    "tutorly.ai",
    62,
    "your learn-a-language-with-AI video",
  ],
  [
    "Sparkscribe",
    "AI captions for Shorts",
    "video",
    "US",
    "sparkscribe.app",
    22,
    "your Shorts-workflow breakdown",
  ],
];

const dealBrandCount = 17;
const heavyBrand = 0;
const slowBrand = 1;

const firstNames = [
  "Maya",
  "Owen",
  "Ines",
  "Theo",
  "Ravi",
  "Zoe",
  "Luca",
  "Nora",
  "Eli",
  "Ada",
  "Kenji",
  "Sara",
  "Noel",
  "Iris",
  "Hugo",
  "Tess",
];
const lastNames = [
  "Hart",
  "Okafor",
  "Lind",
  "Moreau",
  "Patel",
  "Quinn",
  "Rossi",
  "Sato",
  "Vega",
  "Walsh",
  "Young",
  "Zhou",
];
const titles = ["Head of Partnerships", "Growth Marketing Lead", "Creator Partnerships Manager"];

const deliverables = [
  "60 to 90 s integration in the first third of one video",
  "Dedicated 8 minute review video",
  "30 s mid-roll plus a pinned comment",
  "Integration in one video and one Short",
  "Walkthrough of the product in a tutorial video",
];
const placements = [
  "First third (01:40 to 03:10)",
  "Mid-roll (about 40% in)",
  "Opening segment",
  "Dedicated video",
];

// ---------------------------------------------------------------------------------------------
// Tools

/** mulberry32, with a few helpers. */
class Rand {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(low: number, high: number): number {
    return low + (high - low) * this.next();
  }
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return get(items, Math.floor(this.next() * items.length));
  }
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = get(out, i);
      out[i] = get(out, j);
      out[j] = a;
    }
    return out;
  }
}

function get<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined)
    throw new Error(`The example deals read past the end (${String(index)})`);
  return value;
}

const iso = (t: number): string => new Date(t).toISOString();
const monthStart = (t: number, offset: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
};
const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

/** A weekday at or before `t` if it is one, else the nearest one inside `[lo, hi]`, at `hour`. */
function weekdayAt(t: number, lo: number, hi: number, hour: number, minute: number): number {
  const d = new Date(t);
  const set = (x: Date): number => {
    x.setHours(hour, minute, 0, 0);
    return x.getTime();
  };
  let back = new Date(d);
  while (back.getDay() === 0 || back.getDay() === 6) back.setDate(back.getDate() - 1);
  if (set(back) >= lo && set(back) <= hi) return set(back);
  back = new Date(d);
  while (back.getDay() === 0 || back.getDay() === 6) back.setDate(back.getDate() + 1);
  return Math.min(hi, Math.max(lo, set(back)));
}

// ---------------------------------------------------------------------------------------------
// The slots: one per deal, before its brand, creator and price are known

type Kind = "paid" | "unpaid" | "follower";

interface Slot {
  kind: Kind;
  /** Index into `brandSpecs`; -1 until assigned. */
  brand: number;
  slow: boolean;
  heavy: boolean;
  /** Paid, the report is out, and the creator's payout has not gone yet. */
  pending: boolean;
  /** The month the brand paid in, as an offset from the current one (0 to -5); paid slots only. */
  month: number;
  created: number;
  /** Days spent at steps 0 to 4. */
  durs: number[];
  goLive: number;
  paidAt: number | null;
  /** Days from the report to the payout. */
  payGap: number;
  weight: number;
  price: number;
  margin: number;
  creator: string;
  usual: number;
}

const paidTargets = [8500, 12500, 16500, 21000, 25000];
const paidCounts = [4, 6, 7, 8, 8];
/** The month in progress is on pace for this. */
const currentMonthPace = 21500;
const netDays = 30;

function newSlot(kind: Kind, goLive: number, r: Rand): Slot {
  const durs = [r.float(3, 5), r.float(5, 8), r.float(4, 7), r.float(5, 8), r.float(3, 5)];
  const total = durs.reduce((a, b) => a + b, 0);
  return {
    kind,
    brand: -1,
    slow: false,
    heavy: false,
    pending: false,
    month: 0,
    created: Math.round(goLive - total * DAY),
    durs,
    goLive: Math.round(goLive),
    paidAt: null,
    payGap: r.float(1, 3),
    weight: Math.exp(0.22 * r.normal()),
    price: 0,
    margin: 0,
    creator: "",
    usual: 0,
  };
}

/** The time each step was reached (index 0 to 9; null: not planned). Report and payout included. */
interface Times {
  at: (number | null)[];
  reportDue: number;
  sentAt: number;
  payoutAt: number | null;
}

function timesOf(s: Slot): Times {
  const at: (number | null)[] = [];
  let t = s.created;
  for (let i = 0; i < 5; i += 1) {
    at.push(Math.round(t));
    t += get(s.durs, i) * DAY;
  }
  at.push(s.goLive);
  const sentAt = s.goLive + 3 * HOUR;
  at.push(sentAt);
  at.push(s.goLive + 9 * DAY);
  const reportDue = s.goLive + netDays * DAY;
  let payoutAt: number | null = null;
  if (s.paidAt === null) {
    at.push(null, null);
  } else {
    const t8 = Math.round(Math.max(s.paidAt, reportDue) + DAY);
    at.push(t8);
    if (s.pending) {
      at.push(null);
    } else {
      payoutAt = Math.round(t8 + s.payGap * DAY);
      at.push(payoutAt + 2 * HOUR);
    }
  }
  return { at, reportDue, sentAt, payoutAt };
}

/** The deal's step at `now`: the last one reached. */
function stepAt(times: Times, now: number): number {
  let step = 0;
  times.at.forEach((t, i) => {
    if (t !== null && t <= now) step = i;
  });
  return step;
}

// ---------------------------------------------------------------------------------------------
// The generator

export function exampleDeals(input: DealsInput): ExampleDeals {
  const { now } = input;
  const r = new Rand(0xdea15);
  const pool = input.creators;
  const monthFrom = (k: number): number => monthStart(now, -k);

  // ---- slots paid in a month ------------------------------------------------------------
  const slots: Slot[] = [];
  const delayOf = (slow: boolean): number => (slow ? r.float(48, 56) : r.float(27, 37));
  const paidSlot = (paidAt: number, month: number, slow: boolean): Slot => {
    const goLive = paidAt - delayOf(slow) * DAY - 3 * HOUR;
    const s = newSlot("paid", goLive, r);
    s.paidAt = paidAt;
    s.month = month;
    s.slow = slow;
    return s;
  };
  for (let k = 5; k >= 1; k -= 1) {
    const n = get(paidCounts, 5 - k);
    const from = monthFrom(k);
    const to = monthFrom(k - 1);
    for (let i = 0; i < n; i += 1) {
      const at = from + ((i + 0.5 + r.float(-0.25, 0.25)) / n) * (to - from);
      const slow = k <= 3 && i === 1;
      slots.push(paidSlot(weekdayAt(at, from, to - DAY, r.int(9, 16), r.int(0, 59)), -k, slow));
    }
  }
  // The month in progress: so far, at the pace that ends under the goal.
  const month0 = monthFrom(0);
  const nextMonth = monthFrom(-1);
  const elapsed = Math.max(0, Math.floor((now - month0) / DAY));
  const month0Target = roundTo(
    (currentMonthPace * elapsed) / Math.round((nextMonth - month0) / DAY),
    50,
  );
  const count0 = Math.round(month0Target / 3300);
  const month0Slots: Slot[] = [];
  for (let i = 0; i < count0; i += 1) {
    const span = now - HOUR - (month0 + DAY);
    const at = month0 + DAY + ((i + 0.5) / count0) * span;
    month0Slots.push(
      paidSlot(weekdayAt(at, month0, now - HOUR, r.int(9, 16), r.int(0, 59)), 0, false),
    );
  }
  // The last two paid this month have had their report but not their payout yet (step "Pay creator").
  if (elapsed >= 7) {
    month0Slots.slice(-2).forEach((s, i) => {
      const x = i === 0 ? 1.5 : 2.6;
      const goLive = now - (31 + x) * DAY;
      const fresh = newSlot("paid", goLive, r);
      fresh.paidAt = Math.round(goLive + r.float(27, 29) * DAY);
      fresh.month = 0;
      fresh.pending = true;
      Object.assign(s, fresh);
    });
  }
  slots.push(...month0Slots);

  // ---- invoices still open ----------------------------------------------------------------
  // Sent this many days ago; the last two belong to the slow payer, the first three are not due.
  const open: [number, boolean][] = [
    [6, false],
    [14, false],
    [24, false],
    [36, false],
    [44, true],
    [78, true],
  ];
  for (const [ago, slow] of open) {
    const sent = now - ago * DAY - r.float(0, 0.4) * DAY;
    const s = newSlot("unpaid", sent - 3 * HOUR, r);
    s.slow = slow;
    slots.push(s);
  }

  // ---- brands ------------------------------------------------------------------------------
  const paidSlots = slots.filter((s) => s.kind === "paid");
  // The big brand: every third deal paid in the last 90 days, up to six.
  const recentPaid = paidSlots
    .filter((s) => (s.paidAt ?? 0) >= now - 88 * DAY && !s.slow && !s.pending)
    .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0));
  recentPaid
    .filter((_, i) => i % 3 === 1)
    .slice(0, 6)
    .forEach((s) => {
      s.heavy = true;
    });
  const others = r.shuffle(slots.filter((s) => !s.heavy && !s.slow));
  const rest = Array.from({ length: dealBrandCount - 2 }, (_, i) => i + 2);
  others.forEach((s, i) => {
    s.brand = i < rest.length ? get(rest, i) : get(rest, r.int(0, rest.length - 1));
  });
  slots.forEach((s) => {
    if (s.heavy) s.brand = heavyBrand;
    if (s.slow) s.brand = slowBrand;
  });

  // ---- coming back ----------------------------------------------------------------------------
  // A brand whose last report has no newer deal needs one, but two such deals stay as they are.
  const reportOf = (s: Slot): number | null => {
    const due = s.goLive + netDays * DAY;
    return due <= now - 2 * DAY ? due : null;
  };
  interface Gap {
    brand: number;
    lastReport: number;
    violators: number;
  }
  const gaps: Gap[] = [];
  for (let b = 0; b < dealBrandCount; b += 1) {
    const mine = slots.filter((s) => s.brand === b);
    const lastCreated = Math.max(...mine.map((s) => s.created));
    let lastReport = -Infinity;
    let violators = 0;
    for (const s of mine) {
      const rep = reportOf(s);
      if (rep === null) continue;
      lastReport = Math.max(lastReport, rep);
      if (rep >= lastCreated) violators += 1;
    }
    if (lastReport > lastCreated) gaps.push({ brand: b, lastReport, violators });
  }
  // Two brands, with one such deal each and the oldest reports, are left alone.
  const left = gaps
    .filter((g) => g.violators === 1 && g.brand !== heavyBrand && g.brand !== slowBrand)
    .sort((a, b) => a.lastReport - b.lastReport)
    .slice(0, 2)
    .map((g) => g.brand);
  const needing = gaps.filter((g) => !left.includes(g.brand));
  // Two follow-ups are stuck in "Draft": the brands with the oldest reports.
  const byOld = [...needing].sort((a, b) => a.lastReport - b.lastReport);
  const stuck = byOld.slice(0, 2);
  const stuckDays = [15.5, 19.5];
  const plan: { gap: Gap; step: number; inStep: number }[] = [];
  stuck.forEach((g, i) => plan.push({ gap: g, step: 3, inStep: get(stuckDays, i) }));
  const younger = needing
    .filter((g) => !stuck.includes(g))
    .sort((a, b) => b.lastReport - a.lastReport);
  const steps = [0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 3, 0, 1, 2];
  younger.forEach((g, i) => {
    const step = get(steps, i % steps.length);
    const length = step >= 5 ? 1 : get(newSlot("follower", now, r).durs, step);
    plan.push({ gap: g, step, inStep: step === 5 ? 0 : r.float(0.6, Math.max(0.8, length - 1)) });
  });
  for (const p of plan) {
    const s = newSlot("follower", now, r);
    // Time already spent at its step is part of the step's length.
    if (p.step < 5) s.durs[p.step] = Math.max(get(s.durs, p.step), p.inStep + 1.5);
    const before = s.durs.slice(0, p.step).reduce((a, b) => a + b, 0);
    if (p.step === 5) {
      s.goLive = now - HOUR;
      s.created = Math.round(s.goLive - s.durs.reduce((a, b) => a + b, 0) * DAY);
    } else {
      s.created = Math.round(now - (before + p.inStep) * DAY);
      s.goLive = Math.round(s.created + s.durs.reduce((a, b) => a + b, 0) * DAY);
    }
    // After the brand's last report, whatever the step asked for.
    if (s.created <= p.gap.lastReport + DAY) {
      s.created = Math.round(p.gap.lastReport + DAY + r.float(0, 1.5) * DAY);
      s.goLive = Math.round(s.created + s.durs.reduce((a, b) => a + b, 0) * DAY);
    }
    s.brand = p.gap.brand;
    slots.push(s);
  }

  // ---- prices -----------------------------------------------------------------------------
  // What each month paid is fixed; inside it deals differ, and the big brand's are bigger.
  const priceAll = (heavyWeight: number): void => {
    const groups = new Map<number, Slot[]>();
    for (const s of paidSlots) {
      const list = groups.get(s.month);
      if (list) list.push(s);
      else groups.set(s.month, [s]);
    }
    for (const [month, list] of groups) {
      const weights = list.map((s) => s.weight * (s.heavy ? heavyWeight : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      const target = month === 0 ? month0Target : get(paidTargets, 5 + month);
      list.forEach((s, i) => {
        s.price = Math.max(900, roundTo((get(weights, i) / total) * target, 50));
      });
    }
  };
  const share = (): number => {
    const from = now - 90 * DAY;
    const inWindow = paidSlots.filter((s) => (s.paidAt ?? 0) >= from);
    const all = inWindow.reduce((a, s) => a + s.price, 0);
    const big = inWindow.filter((s) => s.heavy).reduce((a, s) => a + s.price, 0);
    return all > 0 ? big / all : 0;
  };
  let low = 1;
  let high = 5;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    priceAll(mid);
    if (share() < 0.435) low = mid;
    else high = mid;
  }
  priceAll(high);
  const typical = (created: number): number =>
    2400 + Math.max(0, Math.min(1, (created - (now - 210 * DAY)) / (210 * DAY))) * 1000;
  for (const s of slots) {
    if (s.kind !== "paid") s.price = Math.max(900, roundTo(typical(s.created) * s.weight, 50));
  }

  // ---- margins ----------------------------------------------------------------------------------
  for (const s of slots) s.margin = r.float(0.36, 0.445);
  // One deal made two months ago went through under the floor.
  const underFloor = paidSlots
    .filter((s) => !s.heavy && !s.slow)
    .sort(
      (a, b) => Math.abs(a.created - (now - 55 * DAY)) - Math.abs(b.created - (now - 55 * DAY)),
    )[0];
  if (underFloor) underFloor.margin = 0.21;

  // ---- creators --------------------------------------------------------------------------------
  const sorted = [...slots].sort((a, b) => a.created - b.created);
  const eligible = (s: Slot): DealCreator[] => {
    const list = pool.filter((c) => c.signedAt <= s.created - DAY);
    return list.length > 0 ? list : pool.slice(0, 1);
  };
  // One signed creator has had no deal for over 60 days: the earliest history signing.
  const idle = [...pool]
    .filter((c) => c.signedAt <= now - 90 * DAY)
    .sort((a, b) => b.signedAt - a.signedAt)[0];
  const required = pool.filter((c) => c.signedAt <= now - 62 * DAY && c !== idle);
  const recent = sorted.filter((s) => s.created >= now - 58 * DAY);
  const used = new Map<string, number>();
  const give = (s: Slot, c: DealCreator): void => {
    s.creator = c.id;
    s.usual = c.usualViews;
    used.set(c.id, (used.get(c.id) ?? 0) + 1);
  };
  const queue = r.shuffle(required);
  recent.forEach((s, i) => {
    const c = i < queue.length ? get(queue, i) : undefined;
    if (c !== undefined && c.signedAt <= s.created - DAY) give(s, c);
  });
  for (const s of sorted) {
    if (s.creator !== "") continue;
    const list = eligible(s).filter((c) => c !== idle || s.created < now - 65 * DAY);
    const least = Math.min(...list.map((c) => used.get(c.id) ?? 0));
    const choice = list.filter((c) => (used.get(c.id) ?? 0) <= least + 1);
    give(s, r.pick(choice.length > 0 ? choice : list));
  }
  // The idle one has a deal long ago.
  if (idle !== undefined && (used.get(idle.id) ?? 0) === 0) {
    const old = sorted.find((s) => s.created < now - 90 * DAY && s.created > idle.signedAt + DAY);
    if (old) give(old, idle);
  }

  // ---- rows -------------------------------------------------------------------------------------
  const owners = input.owners.length > 0 ? input.owners : ["u1"];
  const brandId = (i: number): string => `hb-${String(i + 1).padStart(2, "0")}`;
  const dealId = (i: number): string => `hd-${String(i + 1).padStart(2, "0")}`;
  const out: ExampleDeals = {
    brands: [],
    brandDetails: [],
    deals: [],
    dealDetails: [],
    dealEvents: [],
    brandEvents: [],
  };

  const firstCreated = new Map<number, number>();
  const brandDeals = new Map<number, number>();
  sorted.forEach((s) => {
    const seen = firstCreated.get(s.brand);
    if (seen === undefined || s.created < seen) firstCreated.set(s.brand, s.created);
    brandDeals.set(s.brand, (brandDeals.get(s.brand) ?? 0) + 1);
  });

  // Invoices are numbered in the order they went out.
  const sentOrder = sorted
    .filter((s) => timesOf(s).sentAt <= now)
    .sort((a, b) => timesOf(a).sentAt - timesOf(b).sentAt);
  const invoiceNumber = new Map<Slot, string>();
  sentOrder.forEach((s, i) => {
    const year = new Date(timesOf(s).sentAt).getFullYear();
    invoiceNumber.set(s, `GR-${String(year)}-${String(20 + i).padStart(3, "0")}`);
  });

  sorted.forEach((s, index) => {
    const id = dealId(index);
    const times = timesOf(s);
    const step = stepAt(times, now);
    const payout = roundTo(s.price * (1 - s.margin), 10);
    const sent = step >= 6 ? times.sentAt : null;
    const paidAt = s.paidAt !== null && s.paidAt <= now ? s.paidAt : null;
    const t9 = times.at[9] ?? null;
    const payoutPaid = times.payoutAt !== null && t9 !== null && t9 <= now ? times.payoutAt : null;
    const reported = reportOf(s) !== null;
    const reachedAt = times.at
      .filter((t): t is number => t !== null && t <= now)
      .reduce((a, b) => Math.max(a, b), s.created);
    const owner = get(owners, Math.floor(r.next() * owners.length));
    const views = reported
      ? Math.round(s.usual * Math.min(1.9, Math.max(0.55, Math.exp(0.05 + 0.22 * r.normal()))))
      : null;
    const clicks = views === null ? null : Math.round(views * r.float(0.008, 0.016));
    const report = {
      dueAt: times.reportDue,
      sentAt: reported ? times.reportDue : null,
      views,
      targetViews: s.usual,
      clicks,
      ctr: views === null || clicks === null ? null : Math.round((clicks / views) * 10_000) / 100,
      retention: views === null ? null : r.int(55, 80),
      verdict: views === null ? null : views >= s.usual ? "over" : "under",
      makeGood:
        views !== null && views < s.usual ? "A second integration on the next upload" : null,
    };
    const items = get(DEAL_FLOW, step).items.length;
    const checked = step >= 9 ? items : Math.floor(r.float(0, 0.75) * items);
    const live = step >= 5;
    out.deals.push({
      id,
      brand_id: brandId(s.brand),
      channel_id: s.creator,
      stage: legacyDealStage(step),
      brand_price: s.price,
      influencer_payout: payout,
      deliverables: r.pick(deliverables),
      payment_terms: "Net 30",
      brand_invoice_sent_at: sent === null ? null : iso(sent),
      brand_invoice_paid_at: paidAt === null ? null : iso(paidAt),
      creator_payout_paid_at: payoutPaid === null ? null : iso(payoutPaid),
      payment_reference:
        payoutPaid === null ? null : `WISE-${String(r.int(10_000_000, 99_999_999))}`,
      owner_id: owner,
      flow_step: step,
      created_at: iso(s.created),
      updated_at: iso(reachedAt),
    });
    out.dealDetails.push({
      deal_id: id,
      model: "brokered",
      checks: JSON.stringify(Array.from({ length: items }, (_, i) => i < checked)),
      video_count: 1,
      videos_delivered: live ? 1 : 0,
      creator_deadline: Math.round(s.goLive - 5 * DAY),
      go_live_at: s.goLive,
      due_at: step >= 9 ? null : Math.round(reachedAt + 5 * DAY),
      placement: r.pick(placements),
      invoice_number: invoiceNumber.get(s) ?? null,
      invoice_due_at: sent === null ? null : Math.round(sent + netDays * DAY),
      report: JSON.stringify(report),
      live_url: live ? `youtu.be/${videoCode(r)}` : null,
      clauses: JSON.stringify(contractClauses.map(() => step >= 2)),
      redlines: "[]",
      shipping: null,
      script_approved: step >= 4 ? 1 : 0,
      qc: JSON.stringify(qcChecks.map(() => step >= 5)),
      hype: live
        ? JSON.stringify({
            h24: now - s.goLive >= DAY,
            d7: now - s.goLive >= 7 * DAY,
            d14: now - s.goLive >= 14 * DAY,
            d30: now - s.goLive >= 30 * DAY,
          })
        : null,
      whitelisting_until: null,
      cpm: null,
      negotiation:
        step === 0
          ? JSON.stringify({
              ask: s.price,
              offer: Math.round(s.price * 0.9),
              creatorRate: payout,
              floorPct: 25,
              history: [
                { who: "us", amount: s.price, at: s.created + HOUR, note: null },
                {
                  who: "brand",
                  amount: Math.round(s.price * 0.9),
                  at: s.created + DAY,
                  note: null,
                },
              ],
            })
          : null,
    });
    times.at.forEach((t, i) => {
      if (t !== null && t <= now) {
        out.dealEvents.push({ deal_id: id, step: i, at: t, source: "example" });
      }
    });
  });

  // ---- brands ---------------------------------------------------------------------------------
  const signedIds = pool.map((c) => c.id);
  const walk: BrandStatus[] = ["found", "qualified", "pitched", "negotiating", "won"];
  const pipelineStatus = (i: number): BrandStatus => {
    const k = i - dealBrandCount;
    if (k < 3) return "found";
    if (k < 6) return "qualified";
    if (k < 9) return "pitched";
    if (k < 11) return "negotiating";
    return "lost";
  };
  brandSpecs.forEach((spec, i) => {
    const [name, sells, category, country, site, headcount, hook] = spec;
    const id = brandId(i);
    const has = i < dealBrandCount;
    const status: BrandStatus = has ? "won" : pipelineStatus(i);
    // The times it reached each status, ending at the last.
    const path: BrandStatus[] =
      status === "lost"
        ? ["found", "qualified", "pitched", "lost"]
        : walk.slice(0, walk.indexOf(status) + 1);
    let last = has
      ? (firstCreated.get(i) ?? now) - r.float(0.3, 1) * DAY
      : now - r.float(3, 110) * DAY;
    const times: number[] = [];
    for (let k = path.length - 1; k >= 0; k -= 1) {
      times[k] = Math.round(last);
      last -= r.float(3, 9) * DAY;
    }
    path.forEach((st, k) => {
      out.brandEvents.push({ brand_id: id, status: st, at: get(times, k), source: "example" });
    });
    const since = get(times, 0);
    const contacts = Array.from({ length: r.int(1, 2) }, () => {
      const first = r.pick(firstNames);
      return {
        name: `${first} ${r.pick(lastNames)}`,
        role: r.pick(titles),
        email: `${first.toLowerCase()}@${site}`,
      };
    });
    const budgetLow = roundTo(r.float(1800, 3200), 100);
    const pitchedAt = path.indexOf("pitched") >= 0 ? get(times, path.indexOf("pitched")) : null;
    const owner = get(owners, i % owners.length);
    out.brands.push({
      id,
      name,
      sells,
      status,
      category,
      country,
      website: site,
      contacts: JSON.stringify(contacts),
      budget: budgetLow,
      created_at: iso(since),
      updated_at: iso(get(times, times.length - 1)),
    });
    out.brandDetails.push({
      brand_id: id,
      headcount,
      recommended_title: r.pick(titles),
      paid_spender_verified: has || r.chance(0.6) ? 1 : 0,
      past_campaign_hook: hook,
      budget_high: budgetLow + roundTo(r.float(1500, 3500), 100),
      seen: JSON.stringify(r.shuffle(signedIds).slice(0, r.int(1, 3))),
      since,
      pitched:
        pitchedAt === null
          ? null
          : JSON.stringify({
              at: pitchedAt,
              creators: r.shuffle(signedIds).slice(0, r.int(1, 2)),
              mode: has && (brandDeals.get(i) ?? 0) > 1 ? "warm" : "cold",
            }),
      owner_id: owner,
      status,
    });
  });

  out.dealEvents.sort((a, b) => a.at - b.at);
  out.brandEvents.sort((a, b) => a.at - b.at);
  return out;
}

const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function videoCode(r: Rand): string {
  let out = "";
  for (let i = 0; i < 11; i += 1) out += idChars.charAt(r.int(0, idChars.length - 1));
  return out;
}
