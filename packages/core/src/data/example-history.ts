import { exampleSeed } from "./example";
import type { Scenario } from "./example";
import { exampleVideoId } from "./example-roster";
import { legacyCreatorFields } from "./legacy-mapping";
import type { RewriteHow } from "./reach-types";
import type { CreatorStage, RejectReason } from "./types";
import {
  answerLines,
  asks,
  countries,
  firstNames,
  followUpLines,
  keywordSpecs,
  likelyMistakes,
  mailLocals,
  mailTails,
  nameCores,
  namePrefixes,
  nameTails,
  neverReasons,
  openers,
  pitches,
  replyKinds,
  sponsorBrands,
  subjects,
  topics,
} from "./example-history-words";

/**
 * The example history (plan step P8a, decision A7): six months of believable past for the example
 * data, so Insights has something to look back on in prototype mode. It is one pure function of
 * the anchor time and the scenario, seeded (mulberry32) so the same inputs give the same output.
 *
 * It is a layer added on top of `exampleSeed`: it never reuses the seed's ids, and it uses the
 * seed's mailboxes and team members. The seed's creators are catalog channels too (plan P1, F6):
 * their channels and videos are in the `pipeline` part, so the catalog and the record see one
 * creator, and they count as live in the weekly totals. The
 * history's own numbers (its 16 signed creators and the rest) stand as planned; the seed's
 * creators come on top of them. Main writes the `gratovo` part into the prototype copy of
 * `gratovo.db`, and hands the `pipeline` part to the Python job `example.load`.
 *
 * Rows are named by the columns of their tables, so they can be inserted as they are. Times in
 * `gratovo` rows are in ms where the table holds an integer (`at`, `send_at`, ...) and ISO text
 * where it holds text (`activity_log.at`, `archive_due_at`, `updated_at`). Times in `pipeline`
 * rows are ISO text `YYYY-MM-DDTHH:MM:SSZ`, as the pipeline stores them, except the archive's
 * tuples, which are in ms.
 *
 * Notes for the loaders:
 * - Inserting `creators` into `channel_state` fires the `stage_events` triggers (source
 *   `change`): clear those rows for the history's channels, then insert `events`.
 * - The 1,200 "rejected before dates were kept" channels have `archive_due_at` null and no reject
 *   line in the log, so they never leave on their own.
 * - A channel rejected by a person and already archived has a reject line in `log` and a tuple in
 *   `pipeline.archive`, but no `creators` row.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const dayCount = 182;

/** Targets (plan P8a, "The example history"). Totals the generator hits exactly. */
const target = {
  /** Archived by the auto-clean gate, by kind (141,600 in all). */
  underFiveK: 98_000,
  fewViews: 37_400,
  overTwoM: 6_200,
  /** Archived after a person's reject and the archive days. */
  byPerson: 8_600,
  waitingDated: 9_000,
  waitingUndated: 1_200,
  notReviewed: 340,
  emailed: 1_150,
  contact: 266,
  unconfirmed: 24,
  parkedBeforeEmail: 64,
  never: 104,
  mistakes: 37,
  broughtBack: 40,
  bounces: 23,
  archiveDays: 90,
  brokeBacklog: 860,
} as const;

/** The archive tuple, one per tombstone (about 150,200). The Python loader (`example.load`) expands it. */
export type ArchiveTuple = [
  /** The 22 characters after `UC` in the channel id. */
  idSuffix: string,
  /** Index into `archive.names`; the handle is `@` + the name in lower case, letters and digits only. */
  nameIndex: number,
  /** In ms: when it was archived (`channel_archive.archived_at`). */
  archivedAt: number,
  /** Index into `archive.labels` (`channel_archive.label`). */
  labelIndex: number,
  /** Index into `archive.keywords`: the keyword that found it (its `found_via`). */
  keywordIndex: number,
  /** Frozen numbers; null = the tombstone never had them. */
  medianViews: number | null,
  subscribers: number | null,
  country: string | null,
  videos30: number | null,
  /** 1 when sponsors were seen, 0 when none, null when unknown. */
  sponsored: 0 | 1 | null,
  /** 1 when an address was found, 0 when none, null when unknown. */
  hasEmail: 0 | 1 | null,
  /** In ms: when it was found (`channel_archive.found_at`). */
  foundAt: number,
];

export interface HistoryCreatorRow {
  channel_id: string;
  handle: string;
  vetting_status: string;
  pipeline_stage: string;
  creator_stage: CreatorStage;
  /** ISO text: the reject time + 7 days, as the server's trigger sets it; null for undated rejects. */
  archive_due_at: string | null;
  channel_tags: string;
  /** JSON text, as `contactsWithPrimary` writes it. */
  contacts: string;
  updated_at: string;
}

export interface HistoryNameRow {
  channel_id: string;
  name: string;
}

export interface HistoryLogRow {
  id: string;
  /** ISO text. */
  at: string;
  at_ms: number;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action: "creator.shortlist" | "creator.reject" | "creator.restore" | "creator.never";
  entity_type: "channel";
  entity_id: string;
  entity_label: string;
  field: null;
  old_value: null;
  new_value: null;
  /** An object; the loader stringifies it. A reject's reason is `detail.reason`. */
  detail: { text: string; reason?: string };
}

export interface HistoryEventRow {
  channel_id: string;
  stage: CreatorStage;
  at: number;
  source: "example";
}

export interface HistoryMessageRow {
  id: string;
  channel_id: string;
  direction: "in" | "out";
  kind: "first" | "followUp" | "reply" | null;
  follow_up: number | null;
  subject: string;
  body: string;
  body_cut: 0;
  at: number;
  mailbox: string;
  peer: string;
  peer_name: string | null;
  conversation_key: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  draft_id: string | null;
  by: string | null;
  source: "app" | "sweep";
  /** JSON text of a `ReplyReading`, or null. */
  reading: string | null;
}

export interface HistoryDraftRow {
  id: string;
  channel_id: string;
  kind: "first" | "followUp" | "reply";
  follow_up: number | null;
  state: "sent";
  subject: string;
  body: string;
  mailbox: string;
  send_at: number;
  approved_by: string;
  proposal: null;
  gates_ok: "[]";
  edited: 0 | 1;
  checked_text: null;
  /** JSON text `{how, note}` when a rewrite was used, else null. */
  steer: string | null;
  /** The inbound message a reply answers. */
  reply_to: string | null;
  problem: null;
  goal: null;
  created_at: number;
  updated_at: number;
}

export interface HistorySequenceRow {
  channel_id: string;
  conversation_key: string;
  mailbox: string;
  started_at: number;
  /** JSON text of the steps `{n, dueAt, state, sentAt}`. */
  steps: string;
  stopped: "you" | "replied" | "bounced" | "finished" | null;
  park_until: number | null;
  updated_at: number;
}

export interface HistoryWeekRow {
  /** The local Monday, `YYYY-MM-DD`. */
  week: string;
  live: number;
  waiting: number;
  archive: number;
  written_at: number;
}

export interface HistoryChannelRow {
  channel_id: string;
  handle: string;
  name: string;
  country: string | null;
  /** Text, as the pipeline stores it. */
  subscribers: string;
  first_seen_at: string;
  /** Null: its uploads were never read ("not read yet"). */
  videos_fetched_at: string | null;
  videos_last_30: number;
  median_views_last_30: number | null;
  latest_upload_at: string | null;
  sponsored_ratio: number | null;
  seen_brands: string;
  found_emails: string;
  found_email_sources: string;
  read_failures: number;
  unreadable_until: string | null;
  median_known: number | null;
  videos_last_30_known: number | null;
}

/** A video of a catalog channel (the pipeline's `videos` table). */
export interface HistoryVideoRow {
  /** 11 characters of `[A-Za-z0-9_-]`. */
  video_id: string;
  channel_id: string;
  title: string;
  /** ISO text `YYYY-MM-DDTHH:MM:SSZ`. */
  published_at: string;
  /** Text, as the pipeline stores it. */
  view_count: string;
}

export interface HistoryKeywordRow {
  keyword: string;
  status: "done";
  channels_found: number;
  added_at: string;
  completed_at: string;
}

export interface HistoryLinkRow {
  channel_id: string;
  keyword: string;
  discovered_at: string;
  source: "local";
}

export interface HistoryRunRow {
  started_at: string;
  finished_at: string;
  status: "done";
  keywords_total: number;
  keywords_done: number;
  channels_upserted: number;
  videos_upserted: number;
  kind: "search";
}

export interface HistoryPendingRow {
  channel_id: string;
  keyword: string;
  handles_limit: 200;
  discovered_at: string;
}

export interface HistoryArchive {
  /** `channel_archive.label` values: the auto-clean gate's labels, and "rejected" for a person's reject. */
  labels: string[];
  keywords: string[];
  /** Channel names the tuples point at (not unique: many tombstones share a name). */
  names: string[];
  tuples: ArchiveTuple[];
}

export interface ExampleHistory {
  gratovo: {
    creators: HistoryCreatorRow[];
    names: HistoryNameRow[];
    log: HistoryLogRow[];
    events: HistoryEventRow[];
    messages: HistoryMessageRow[];
    drafts: HistoryDraftRow[];
    sequences: HistorySequenceRow[];
    weeks: HistoryWeekRow[];
    settings: { archiveDays: number };
  };
  pipeline: {
    channels: HistoryChannelRow[];
    /** The seed creators' videos; the history's other channels have none. */
    videos: HistoryVideoRow[];
    keywords: HistoryKeywordRow[];
    links: HistoryLinkRow[];
    runs: HistoryRunRow[];
    archive: HistoryArchive;
    pending: HistoryPendingRow[];
  };
}

/**
 * The six-month history at `anchor`, or null for the "first" scenario (nothing has happened yet).
 * "later" is the same history at the seed's later anchor (a week earlier, as `exampleSeed` shifts
 * it); "broke" is the normal history plus a bouncing mailbox, almost no fuel and a review backlog.
 */
export function exampleHistory(anchor: number, scenario: Scenario): ExampleHistory | null {
  if (scenario === "first") return null;
  const now = scenario === "later" ? anchor - 7 * DAY : anchor;
  return build(now, scenario === "broke");
}

// ---------------------------------------------------------------------------------------------
// Small tools

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined)
    throw new Error(`The example history read past the end (${String(index)})`);
  return value;
}

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** mulberry32. */
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
  /** A whole number from `low` to `high`, both included. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return at(items, Math.floor(this.next() * items.length));
  }
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }
  /** An index drawn by weight. */
  weighted(weights: readonly number[]): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let x = this.next() * sum;
    for (let i = 0; i < weights.length; i += 1) {
      x -= at(weights, i);
      if (x < 0) return i;
    }
    return weights.length - 1;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = at(copy, i);
      copy[i] = at(copy, j);
      copy[j] = a;
    }
    return copy;
  }
}

const clamp = (x: number, low: number, high: number): number => Math.min(high, Math.max(low, x));

/** Splits `total` over `weights` in whole numbers that add up to `total` (largest remainder). */
function allocate(total: number, weights: readonly number[]): number[] {
  let sum = 0;
  for (const w of weights) sum += w;
  const out: number[] = [];
  const rest: { i: number; f: number }[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    const x = sum === 0 ? 0 : (total * w) / sum;
    const whole = Math.floor(x);
    out.push(whole);
    used += whole;
    rest.push({ i, f: x - whole });
  });
  rest.sort((a, b) => b.f - a.f || a.i - b.i);
  for (let j = 0; j < total - used; j += 1) {
    const item = rest[j % Math.max(1, rest.length)];
    if (item !== undefined) out[item.i] = at(out, item.i) + 1;
  }
  return out;
}

const iso = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const str = (n: number): string => String(n);

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The 22 characters after `UC` for channel number `n`: a marker, a scramble of `n`, and `n` itself. */
function channelSuffix(n: number): string {
  let h = (n * 0x9e3779b1 + 0x7f4a7c15) >>> 0;
  let out = "Zq";
  for (let i = 0; i < 3; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    for (let j = 0; j < 5; j += 1) out += b64.charAt((h >>> (j * 6)) & 63);
  }
  let x = n;
  for (let j = 0; j < 5; j += 1) {
    out += b64.charAt(x & 63);
    x = Math.floor(x / 64);
  }
  return out;
}

const handleOf = (name: string): string => `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;

/** Local midnight `back` days before `now` (negative: after). */
function midnight(now: number, back: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

/** The next Monday to Friday day at or after `t`, at `minute` of the day (local time). */
function workdayAt(t: number, minute: number): number {
  const d = new Date(t);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + minute * MIN;
}

// ---------------------------------------------------------------------------------------------
// The generator

type Group = "notReviewed" | "unconfirmed" | "contact" | "parked" | "never" | "emailed" | "waiting";
type Brought = { at: number; restoredAt: number; reason: RejectReason | null };

interface Run {
  start: number;
  duration: number;
  keywords: number[];
  /** Cumulative weights over `keywords`, for each kind of pick. */
  cumSwept: number[];
  cumLive: number[];
  cumReject: number[];
  fresh: Int32Array;
  upserts: number;
  videos: number;
}

interface Replier {
  group:
    "signed" | "audience" | "kit" | "positive" | "parked" | "notNow" | "no" | "manager" | "auto";
  step: number;
  replyId: string;
  at: number;
  kitAt: number | null;
  audienceAt: number | null;
  signedAt: number | null;
  parkedAt: number | null;
}

interface Outreach {
  at: number;
  mailbox: string;
  by: string;
  edited: boolean;
  rewrite: RewriteHow | null;
  /** Follow-ups this person lets go out, 0 to 3. */
  allowed: number;
  bounce: boolean;
  bounceAt: number;
  reply: Replier | null;
  /** Send times of step 0 (first) to 3. */
  times: number[];
}

interface Cr {
  n: number;
  id: string;
  name: string;
  handle: string;
  kw: number;
  run: number;
  foundAt: number;
  group: Group;
  stage: CreatorStage | null;
  events: [CreatorStage, number][];
  subs: number | null;
  median: number | null;
  up30: number | null;
  country: string | null;
  brands: string[];
  ratio: number | null;
  /** 0 read, 1 not read yet, 2 retrying, 3 gave up. */
  read: 0 | 1 | 2 | 3;
  email: string | null;
  contactName: string | null;
  source: "about" | "video" | "typed" | null;
  confirmed: boolean;
  /** Any address found by the finder. */
  foundEmail: boolean;
  rejectAt: number | null;
  rejectReason: RejectReason | null;
  rejectLogged: boolean;
  neverReason: string | null;
  shortlistAt: number | null;
  mistake: boolean;
  brought: Brought | null;
  outreach: Outreach | null;
  latestUpload: number | null;
}

const homeCountries = new Set(["US", "GB", "CA", "AU"]);
const followUpDays = [0, 3, 7, 14] as const;

function build(now: number, broke: boolean): ExampleHistory {
  const seed = exampleSeed(now, "normal");
  const rng = new Rng(0x0a11ce5);
  const specs = keywordSpecs;
  const nk = specs.length;

  // ---- calendar --------------------------------------------------------------------------
  const dayStarts: number[] = [];
  for (let k = dayCount; k >= 1; k -= 1) dayStarts.push(midnight(now, k));
  const histStart = at(dayStarts, 0);
  const today0 = midnight(now, 0);
  /** Nothing in the history happens after this (yesterday evening). */
  const lastEnd = today0 - 30 * MIN;
  const workIdx: number[] = [];
  dayStarts.forEach((d, i) => {
    const dow = new Date(d).getDay();
    if (dow !== 0 && dow !== 6) workIdx.push(i);
  });

  const mailboxes = seed.mailSettings.mailboxes;
  const mailbox = (i: number): string => at(mailboxes, i).address;
  const warmup2 = (() => {
    const on = at(mailboxes, 1).warmupStartedOn;
    if (on === null) return histStart;
    const [y, m, d] = on.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
  })();
  const actors = seed.profiles.map((p) => ({ id: p.id, name: p.displayName, role: p.role }));
  const actorOf = (id: string): { id: string; name: string; role: string } =>
    actors.find((a) => a.id === id) ?? at(actors, 0);

  // ---- runs and keywords -----------------------------------------------------------------
  const kwIndex = (name: string): number => {
    const i = specs.findIndex((s) => s.keyword === name);
    if (i < 0) throw new Error(`Unknown example keyword ${name}`);
    return i;
  };
  const newsIdx = kwIndex("ai news weekly");
  const chatIdx = kwIndex("chatgpt tips");
  const videoToolsIdx = kwIndex("ai video tools");
  const sinceStart = specs.map((s) =>
    s.sinceDaysAgo === null ? histStart : Math.max(histStart, midnight(now, s.sinceDaysAgo)),
  );
  const sweptW = specs.map((s) => s.find);
  const liveW = specs.map((s) => s.find * s.keep);
  const rejectW = specs.map((s) => s.find * Math.max(0.3, 1.6 - 0.5 * s.keep));

  const runDays: number[] = [];
  const lastWork = at(workIdx, workIdx.length - 1);
  for (const i of workIdx) {
    if (i === lastWork || rng.chance(0.82)) runDays.push(i);
  }
  const runs: Run[] = runDays.map((i) => ({
    start: at(dayStarts, i) + (8 * 60 + rng.int(0, 150)) * MIN,
    duration: rng.int(40, 110) * MIN,
    keywords: [],
    cumSwept: [],
    cumLive: [],
    cumReject: [],
    fresh: new Int32Array(nk),
    upserts: 0,
    videos: 0,
  }));
  const runCount = runs.length;
  const lastRun = at(runs, runCount - 1);
  // Which keywords each run covers.
  const firstVideoRun = runs.findIndex((r) => r.start >= at(sinceStart, videoToolsIdx));
  runs.forEach((run, ri) => {
    const active: number[] = [];
    for (let k = 0; k < nk; k += 1) {
      if (at(sinceStart, k) <= run.start) active.push(k);
    }
    const keys = active.map((k) => ({
      k,
      key: Math.pow(rng.next(), 1 / Math.max(0.2, at(specs, k).find)),
    }));
    keys.sort((a, b) => b.key - a.key);
    const take = Math.min(active.length, rng.int(7, 13));
    const chosen = new Set(keys.slice(0, take).map((x) => x.k));
    if (ri >= firstVideoRun && firstVideoRun >= 0) {
      if (ri === firstVideoRun || rng.chance(0.6)) chosen.add(videoToolsIdx);
      else chosen.delete(videoToolsIdx);
    }
    if (ri === runCount - 1) chosen.add(chatIdx);
    run.keywords = [...chosen].sort((a, b) => a - b);
  });
  // Every keyword appears in at least one of the last eight runs.
  for (let k = 0; k < nk; k += 1) {
    if (at(sinceStart, k) > lastRun.start) continue;
    let last = -1;
    runs.forEach((run, ri) => {
      if (run.keywords.includes(k)) last = ri;
    });
    if (last < runCount - 8) {
      const target = at(runs, rng.int(runCount - 8, runCount - 2));
      target.keywords.push(k);
      target.keywords.sort((a, b) => a - b);
    }
  }
  const runsOf: number[][] = specs.map(() => []);
  runs.forEach((run, ri) => {
    for (const k of run.keywords) at(runsOf, k).push(ri);
  });
  const cumulative = (run: Run, ri: number, w: readonly number[]): number[] => {
    let sum = 0;
    return run.keywords.map((k) => {
      // A keyword that is worn out finds almost nothing new in its last run.
      const worn = ri === runCount - 1 && k === chatIdx ? 0.1 : 1;
      sum += at(w, k) * worn;
      return sum;
    });
  };
  runs.forEach((run, ri) => {
    run.cumSwept = cumulative(run, ri, sweptW);
    run.cumLive = cumulative(run, ri, liveW);
    run.cumReject = cumulative(run, ri, rejectW);
  });
  const pickKeyword = (run: Run, kind: "swept" | "live" | "reject"): number => {
    const cum = kind === "swept" ? run.cumSwept : kind === "live" ? run.cumLive : run.cumReject;
    const x = rng.next() * at(cum, cum.length - 1);
    for (let i = 0; i < cum.length; i += 1) {
      if (x < at(cum, i)) return at(run.keywords, i);
    }
    return at(run.keywords, run.keywords.length - 1);
  };
  const runStarts = runs.map((r) => r.start);
  /** The last run starting at or before `t` (the first run when none does). */
  const runAtOrBefore = (t: number): number => {
    let lo = 0;
    let hi = runCount - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (at(runStarts, mid) <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const runForKeyword = (k: number, t: number): number => {
    const list = at(runsOf, k);
    let found = at(list, 0);
    for (const ri of list) {
      if (at(runStarts, ri) <= t) found = ri;
      else break;
    }
    return found;
  };
  const foundTime = (ri: number): number => {
    const run = at(runs, ri);
    return run.start + Math.floor(rng.float(0.03, 0.95) * run.duration);
  };

  // ---- names -----------------------------------------------------------------------------
  const takenNames = new Set<string>();
  const takenHandles = new Set<string>();
  for (const c of seed.creators) {
    takenNames.add(c.name.toLowerCase());
    takenHandles.add(c.handle.toLowerCase());
  }
  const newName = (): string => {
    for (let tries = 0; tries < 40; tries += 1) {
      const parts = [rng.pick(namePrefixes), rng.pick(nameCores)];
      if (rng.chance(0.45)) parts.push(rng.pick(nameTails));
      const name = parts.join(" ");
      const handle = handleOf(name);
      if (!takenNames.has(name.toLowerCase()) && !takenHandles.has(handle)) {
        takenNames.add(name.toLowerCase());
        takenHandles.add(handle);
        return name;
      }
    }
    const name = `${rng.pick(namePrefixes)} ${rng.pick(nameCores)} ${str(takenNames.size)}`;
    takenNames.add(name.toLowerCase());
    takenHandles.add(handleOf(name));
    return name;
  };

  // ---- channels --------------------------------------------------------------------------
  let nextChannel = 0;
  const crs: Cr[] = [];
  const blank = (group: Group, name: string): Cr => {
    const n = nextChannel;
    nextChannel += 1;
    return {
      n,
      id: `UC${channelSuffix(n)}`,
      name,
      handle: handleOf(name),
      kw: 0,
      run: 0,
      foundAt: 0,
      group,
      stage: null,
      events: [],
      subs: null,
      median: null,
      up30: null,
      country: null,
      brands: [],
      ratio: null,
      read: 0,
      email: null,
      contactName: null,
      source: null,
      confirmed: false,
      foundEmail: false,
      rejectAt: null,
      rejectReason: null,
      rejectLogged: false,
      neverReason: null,
      shortlistAt: null,
      mistake: false,
      brought: null,
      outreach: null,
      latestUpload: null,
    };
  };
  const countryWeights = countries.map((c) => c[1]);
  const randomCountry = (home: boolean): string | null => {
    if (rng.chance(0.05)) return null;
    if (home && rng.chance(0.82)) return rng.pick(["US", "US", "US", "GB", "CA", "AU"]);
    return at(countries, rng.weighted(countryWeights))[0];
  };
  const pickBrands = (): string[] => {
    const count = rng.chance(0.2) ? 3 : rng.chance(0.5) ? 2 : 1;
    return rng.shuffle(sponsorBrands).slice(0, count);
  };
  const giveStats = (cr: Cr, quality: "reviewed" | "any" | "weak"): void => {
    if (quality === "weak") {
      cr.subs = Math.round(clamp(rng.logNormal(30_000, 1.1), 5_000, 900_000));
      cr.median = Math.round(clamp(cr.subs * rng.float(0.01, 0.1), 300, 8_000));
      cr.up30 = rng.chance(0.4) ? rng.int(0, 2) : rng.int(3, 18);
      cr.country = randomCountry(false);
    } else {
      const reviewed = quality === "reviewed";
      cr.subs = Math.round(
        clamp(rng.logNormal(reviewed ? 90_000 : 60_000, 0.95), 5_000, 1_900_000),
      );
      cr.median = Math.round(
        clamp(cr.subs * rng.float(0.03, 0.4), reviewed ? 7_000 : 1_500, 85_000),
      );
      cr.up30 = reviewed ? rng.int(4, 14) : rng.chance(0.15) ? rng.int(0, 3) : rng.int(3, 16);
      cr.country = randomCountry(reviewed);
    }
    cr.brands = rng.chance(quality === "reviewed" ? 0.85 : 0.5) ? pickBrands() : [];
    cr.ratio = cr.brands.length > 0 ? Math.round(rng.float(0.05, 0.6) * 100) / 100 : 0;
    cr.latestUpload = now - Math.floor(rng.float(0.3, quality === "weak" ? 60 : 16) * DAY);
    cr.foundEmail = rng.chance(quality === "reviewed" ? 0.9 : 0.42);
  };
  const reviewerOf = (): string => (rng.chance(0.5) ? "u1" : rng.chance(0.5) ? "u3" : "u4");
  const emailOf = (cr: Cr): string => {
    const tail = rng.pick(mailTails);
    return `${rng.pick(mailLocals)}@${cr.handle.slice(1)}.${tail}`;
  };
  const giveAddress = (cr: Cr, confirmed: boolean): void => {
    cr.email = emailOf(cr);
    cr.contactName = confirmed ? rng.pick(firstNames) : null;
    cr.source = rng.pick(["about", "about", "about", "video", "typed"] as const);
    cr.confirmed = confirmed;
    cr.foundEmail = true;
  };

  // ---- 1. emailed creators ---------------------------------------------------------------
  const firstSendIdx = 10;
  const sendDays = workIdx.slice(firstSendIdx);
  const ramp = Math.log(22 / 3);
  const perDay = allocate(
    target.emailed,
    sendDays.map((_, i) => Math.exp((ramp * i) / (sendDays.length - 1)) * rng.float(0.88, 1.12)),
  );
  const emailed: Cr[] = [];
  sendDays.forEach((di, i) => {
    const count = at(perDay, i);
    const dayStart = at(dayStarts, di);
    for (let j = 0; j < count; j += 1) {
      const cr = blank("emailed", newName());
      const e = dayStart + (9 * 60 + rng.int(0, 8 * 60 - 1)) * MIN;
      const mb =
        dayStart >= warmup2 ? rng.weighted([0.42, 0.14, 0.44]) : rng.weighted([0.49, 0, 0.51]);
      const rewrite = rng.chance(0.25)
        ? at(["shorter", "warmer", "direct", "redo"] as const, rng.weighted([0.3, 0.3, 0.25, 0.15]))
        : null;
      cr.outreach = {
        at: e,
        mailbox: mailbox(mb),
        by: rng.chance(0.62) ? "u1" : "u3",
        edited: rng.chance(0.35),
        rewrite,
        allowed: 0,
        bounce: false,
        bounceAt: 0,
        reply: null,
        times: [e],
      };
      emailed.push(cr);
    }
  });
  // Stage times and keyword for each: confirmed before emailed, shortlisted before that.
  for (const cr of emailed) {
    const o = cr.outreach;
    if (o === null) continue;
    const e = o.at;
    let c = e - clamp(rng.logNormal(30 * HOUR, 0.9), 0.4 * HOUR, 6 * DAY);
    let s = c - clamp(rng.logNormal(20 * HOUR, 1.0), HOUR, 5 * DAY);
    if (s < histStart + DAY) s = histStart + DAY + rng.int(0, 6) * HOUR;
    if (c <= s) c = s + HOUR + rng.int(0, 90) * MIN;
    if (c >= e) c = e - 10 * MIN;
    if (s >= c) s = c - 10 * MIN;
    cr.shortlistAt = s;
    cr.events.push(["shortlisted", s], ["contact", c], ["emailed", e]);
    const lag = clamp(rng.logNormal(4 * DAY, 0.9), 0.5 * DAY, 30 * DAY);
    const ok: number[] = [];
    const weights: number[] = [];
    for (let k = 0; k < nk; k += 1) {
      const list = at(runsOf, k);
      if (list.length > 0 && at(runStarts, at(list, 0)) <= s - 6 * HOUR) {
        ok.push(k);
        weights.push(at(liveW, k));
      }
    }
    cr.kw = at(ok, rng.weighted(weights));
    cr.run = runForKeyword(cr.kw, s - lag);
    cr.foundAt = foundTime(cr.run);
    cr.stage = "emailed";
    cr.confirmed = true;
    giveStats(cr, "reviewed");
    giveAddress(cr, true);
  }

  // ---- 2. bounces, replies and what follows ----------------------------------------------
  const sendTimes = (cr: Cr): void => {
    const o = cr.outreach;
    if (o === null) return;
    o.times = followUpDays.map((d, j) =>
      j === 0 ? o.at : workdayAt(o.at + d * DAY, 9 * 60 + rng.int(0, 8 * 60 - 1)),
    );
  };
  emailed.forEach(sendTimes);
  const bounceSet = new Set<number>();
  {
    const old = emailed.filter((cr) => (cr.outreach?.at ?? 0) <= now - 8 * DAY);
    const picks = rng.shuffle(old).slice(0, broke ? target.bounces - 5 : target.bounces);
    for (const cr of picks) {
      const o = cr.outreach;
      if (o === null) continue;
      o.bounce = true;
      o.bounceAt = o.at + rng.int(1, 8) * MIN;
      bounceSet.add(cr.n);
    }
    if (broke) {
      const mb3 = mailbox(2);
      const recent = emailed.filter(
        (cr) =>
          cr.outreach !== null &&
          cr.outreach.mailbox === mb3 &&
          cr.outreach.at >= now - 6 * DAY &&
          !bounceSet.has(cr.n),
      );
      for (const cr of rng.shuffle(recent).slice(0, 5)) {
        const o = cr.outreach;
        if (o === null) continue;
        o.bounce = true;
        o.bounceAt = o.at + rng.int(1, 8) * MIN;
        bounceSet.add(cr.n);
      }
    }
  }
  const replyWeight = (cr: Cr): number => {
    const o = cr.outreach;
    if (o === null || o.bounce || o.reply !== null) return 0;
    return at(specs, cr.kw).reply * (o.edited ? 2.2 : 1) * (o.rewrite === "warmer" ? 1.3 : 1);
  };
  const delayOf = (): number => clamp(rng.logNormal(18 * HOUR, 0.9), 0.4 * HOUR, 5 * DAY);
  type ReplierGroup = Replier["group"];
  const planReply = (cr: Cr, group: ReplierGroup, need: number): boolean => {
    const o = cr.outreach;
    if (o === null) return false;
    const maxEnd = lastEnd - need;
    let step = rng.weighted([0.52, 0.24, 0.19, 0.05]);
    for (; step >= 0; step -= 1) {
      const sent = at(o.times, step);
      if (sent + HOUR < maxEnd) break;
    }
    if (step < 0) return false;
    const sent = at(o.times, step);
    const nextSend = step < 3 ? at(o.times, step + 1) : Number.POSITIVE_INFINITY;
    let reply = sent + delayOf();
    reply = Math.min(reply, maxEnd, nextSend - 2 * HOUR);
    if (reply <= sent) reply = sent + 30 * MIN;
    const kinds: Record<ReplierGroup, readonly string[]> = {
      signed: ["inf.interested_vague", "inf.gives_rate", "inf.who_are_you", "inf.media_kit"],
      audience: ["inf.interested_vague", "inf.gives_rate", "inf.who_are_you", "inf.media_kit"],
      kit: ["inf.interested_vague", "inf.gives_rate", "inf.who_are_you", "inf.media_kit"],
      positive: ["inf.interested_vague", "inf.gives_rate", "inf.who_are_you", "inf.media_kit"],
      parked: ["inf.later"],
      notNow: ["inf.later"],
      no: ["inf.not_interested"],
      manager: ["inf.has_manager"],
      auto: ["any.out_of_office"],
    };
    const replyId = rng.pick(kinds[group]);
    const r: Replier = {
      group,
      step,
      replyId,
      at: Math.floor(reply),
      kitAt: null,
      audienceAt: null,
      signedAt: null,
      parkedAt: null,
    };
    if (group === "signed" || group === "audience" || group === "kit") {
      r.kitAt = Math.floor(r.at + rng.float(1, 4) * DAY);
    }
    if ((group === "signed" || group === "audience") && r.kitAt !== null) {
      r.audienceAt = Math.floor(r.kitAt + rng.float(2, 6) * DAY);
    }
    if (group === "signed" && r.audienceAt !== null) {
      r.signedAt = Math.floor(r.audienceAt + rng.float(2, 7) * DAY);
    }
    if (group === "parked") r.parkedAt = Math.floor(r.at + rng.float(1, 3) * DAY);
    o.reply = r;
    return true;
  };
  const takeRepliers = (
    count: number,
    group: ReplierGroup,
    need: number,
    wanted: ((cr: Cr) => boolean) | null = null,
  ): number => {
    let done = 0;
    for (let attempt = 0; attempt < count * 4 && done < count; attempt += 1) {
      const pool = emailed.filter(
        (cr) =>
          (wanted === null || wanted(cr)) &&
          (cr.outreach?.at ?? Number.POSITIVE_INFINITY) <= lastEnd - need - 3 * HOUR,
      );
      const weights = pool.map(replyWeight);
      if (!weights.some((w) => w > 0)) return done;
      const cr = at(pool, rng.weighted(weights));
      if (planReply(cr, group, need)) done += 1;
    }
    return done;
  };
  const signQuota: readonly (readonly [string, number])[] = [
    ["local llm setup", 5],
    ["ai agents tutorial", 4],
    ["cursor ai coding", 3],
    ["prompt engineering tutorial", 1],
    ["ollama tutorial", 1],
    ["mcp servers tutorial", 1],
    ["ai coding assistant", 1],
  ];
  const signNeed = 18 * DAY;
  let signed = 0;
  for (const [word, count] of signQuota) {
    const k = kwIndex(word);
    signed += takeRepliers(count, "signed", signNeed, (cr) => cr.kw === k);
  }
  if (signed < 16) takeRepliers(16 - signed, "signed", signNeed);
  takeRepliers(6, "audience", 11 * DAY);
  takeRepliers(16, "kit", 5 * DAY);
  takeRepliers(16, "positive", DAY);
  takeRepliers(6, "parked", 4 * DAY);
  takeRepliers(6, "notNow", DAY);
  takeRepliers(18, "no", DAY);
  takeRepliers(8, "manager", DAY);
  takeRepliers(4, "auto", DAY);

  // Follow-ups: what each person lets go out.
  for (const cr of emailed) {
    const o = cr.outreach;
    if (o === null) continue;
    let allowed = 0;
    if (rng.chance(0.75)) {
      allowed = 1;
      if (rng.chance(0.45)) {
        allowed = 2;
        if (rng.chance(0.45)) allowed = 3;
      }
    }
    o.allowed = o.reply === null ? allowed : Math.max(allowed, o.reply.step);
  }

  // Final stages of the emailed.
  for (const cr of emailed) {
    const r = cr.outreach?.reply;
    if (r === null || r === undefined) continue;
    cr.events.push(["replied", r.at]);
    cr.stage = "replied";
    if (r.kitAt !== null) {
      cr.events.push(["kit", r.kitAt]);
      cr.stage = "kit";
    }
    if (r.audienceAt !== null) {
      cr.events.push(["audience", r.audienceAt]);
      cr.stage = "audience";
    }
    if (r.signedAt !== null) {
      cr.events.push(["signed", r.signedAt]);
      cr.stage = "signed";
    }
    if (r.parkedAt !== null) {
      cr.events.push(["parked", r.parkedAt]);
      cr.stage = "parked";
      cr.group = "parked";
    }
  }

  // ---- 3. the rest of Live ---------------------------------------------------------------
  const lastWorkDays = (days: number): number[] =>
    workIdx.filter((i) => at(dayStarts, i) >= now - days * DAY);
  const reviewTime = (day: number): number =>
    at(dayStarts, day) + (9 * 60 + rng.int(0, 9 * 60 - 1)) * MIN;
  const reviewed = (cr: Cr, s: number): void => {
    cr.shortlistAt = s;
    cr.events.push(["shortlisted", s]);
    const lag = clamp(rng.logNormal(4 * DAY, 0.9), 0.5 * DAY, 25 * DAY);
    cr.run = runAtOrBefore(s - lag);
    cr.foundAt = foundTime(cr.run);
    if (cr.foundAt > s - HOUR) cr.foundAt = s - HOUR;
    cr.kw = pickKeyword(at(runs, cr.run), "live");
    giveStats(cr, "reviewed");
  };
  const contactCount = broke ? 8 : target.contact;
  const shortlistedGroup: Cr[] = [];
  {
    const days = lastWorkDays(14);
    for (let i = 0; i < target.contact + target.unconfirmed; i += 1) {
      const isContact = i < contactCount;
      const unconfirmed = i >= target.contact;
      const cr = blank(isContact ? "contact" : "unconfirmed", newName());
      const s = reviewTime(at(days, rng.int(0, days.length - 1)));
      const sCapped = unconfirmed
        ? lastEnd - rng.int(1, 90) * HOUR
        : Math.min(s, lastEnd - 3 * HOUR);
      reviewed(cr, sCapped);
      if (isContact) {
        const c = Math.min(sCapped + Math.floor(rng.float(0.05, 2) * DAY), lastEnd - 5 * MIN);
        cr.events.push(["contact", Math.max(c, sCapped + 5 * MIN)]);
        cr.stage = "contact";
        giveAddress(cr, true);
      } else {
        cr.stage = "shortlisted";
        giveAddress(cr, false);
      }
      shortlistedGroup.push(cr);
    }
  }
  const parked: Cr[] = [];
  for (let i = 0; i < target.parkedBeforeEmail; i += 1) {
    const cr = blank("parked", newName());
    const days = lastWorkDays(150);
    const s = Math.min(reviewTime(at(days, rng.int(0, days.length - 1))), lastEnd - 3 * DAY);
    reviewed(cr, s);
    cr.events.push(["parked", Math.min(s + Math.floor(rng.float(1, 45) * DAY), lastEnd - HOUR)]);
    cr.stage = "parked";
    cr.foundEmail = rng.chance(0.5);
    parked.push(cr);
  }
  const never: Cr[] = [];
  for (let i = 0; i < target.never; i += 1) {
    const cr = blank("never", newName());
    const days = lastWorkDays(160);
    const s = Math.min(reviewTime(at(days, rng.int(0, days.length - 1))), lastEnd - 3 * DAY);
    reviewed(cr, s);
    const t = Math.min(s + Math.floor(rng.float(0.5, 20) * DAY), lastEnd - HOUR);
    cr.events.push(["never", t]);
    cr.stage = "never";
    cr.rejectAt = t;
    cr.neverReason = rng.pick(neverReasons);
    never.push(cr);
  }
  // Found, nobody reviewed yet.
  const notReviewed: Cr[] = [];
  {
    const near = runs.map((r, ri) => ({ r, ri })).filter((x) => x.r.start >= now - 9 * DAY);
    const counts = allocate(
      target.notReviewed,
      near.map((x) => 1 + (0.6 * (x.r.start - (now - 9 * DAY))) / (9 * DAY) + rng.float(0, 0.3)),
    );
    near.forEach((x, i) => {
      for (let j = 0; j < at(counts, i); j += 1) notReviewed.push(placeFound(x.ri, false));
    });
    if (broke) {
      const older = runs
        .map((r, ri) => ({ r, ri }))
        .filter((x) => x.r.start >= now - 21 * DAY && x.r.start < now - 9 * DAY);
      const extra = allocate(
        target.brokeBacklog,
        older.map(() => 1 + rng.float(0, 0.4)),
      );
      older.forEach((x, i) => {
        for (let j = 0; j < at(extra, i); j += 1) notReviewed.push(placeFound(x.ri, false));
      });
    }
  }
  function placeFound(ri: number, rejected: boolean): Cr {
    const cr = blank(rejected ? "waiting" : "notReviewed", newName());
    cr.run = ri;
    cr.foundAt = foundTime(ri);
    cr.kw = pickKeyword(at(runs, ri), rejected ? "reject" : "live");
    giveStats(cr, "any");
    return cr;
  }
  // Reading trouble among the live: not read yet, retrying, gave up.
  {
    const newest = [...notReviewed].sort((a, b) => b.foundAt - a.foundAt);
    for (const cr of newest.slice(0, 40)) {
      cr.read = 1;
      cr.median = null;
      cr.up30 = null;
    }
    const older = rng.shuffle(newest.slice(60));
    older.slice(0, 14).forEach((cr) => {
      cr.read = 2;
      cr.median = null;
      cr.up30 = null;
    });
    older.slice(14, 23).forEach((cr) => {
      cr.read = 3;
      cr.median = null;
      cr.up30 = null;
    });
  }

  // Brought back from a reject (about 40, in the last 90 days).
  {
    const fresh = (group: (cr: Cr) => boolean, count: number): Cr[] =>
      rng
        .shuffle(
          [...emailed, ...shortlistedGroup].filter(
            (cr) =>
              group(cr) &&
              (cr.shortlistAt ?? 0) >= now - 85 * DAY &&
              cr.brought === null &&
              !cr.outreach?.bounce,
          ),
        )
        .slice(0, count);
    const chosen = [
      ...fresh((cr) => cr.group === "contact" || cr.group === "unconfirmed", 20),
      ...fresh((cr) => cr.stage === "emailed", 14),
      ...fresh((cr) => cr.stage === "replied", 4),
      ...fresh((cr) => cr.stage === "kit", 2),
    ];
    const reasons = rng.shuffle<RejectReason | null>([
      ...Array<RejectReason>(9).fill("ai"),
      ...Array<RejectReason>(9).fill("views"),
      ...Array<RejectReason>(8).fill("posting"),
      ...Array<RejectReason>(7).fill("audience"),
      ...Array<null>(7).fill(null),
    ]);
    chosen.forEach((cr, i) => {
      const s = cr.shortlistAt ?? 0;
      const restoredAt = s - 2 * MIN;
      const found = cr.foundAt;
      const rejectAt = Math.floor(found + (restoredAt - found) * rng.float(0.2, 0.9));
      cr.brought = { at: rejectAt, restoredAt, reason: reasons[i] ?? null };
      cr.events.unshift(["rejected", rejectAt], ["new", restoredAt]);
    });
  }

  // ---- 4. waiting to be archived ---------------------------------------------------------
  const waiting: Cr[] = [];
  {
    const reasonKeys: readonly RejectReason[] = ["ai", "views", "posting", "audience"];
    const reasonW = [0.38, 0.27, 0.18, 0.17];
    const days = workIdx.filter(
      (i) =>
        at(dayStarts, i) + 18 * HOUR > now - target.archiveDays * DAY && at(dayStarts, i) < lastEnd,
    );
    const special = 9;
    const counts = allocate(
      target.waitingDated - special,
      days.map((_, i) => (1 + (0.6 * i) / (days.length - 1)) * rng.float(0.9, 1.1)),
    );
    const rejectTimes: number[] = [];
    days.forEach((di, i) => {
      for (let j = 0; j < at(counts, i); j += 1) {
        rejectTimes.push(
          Math.max(
            at(dayStarts, di) + (9 * 60 + rng.int(0, 9 * 60 - 1)) * MIN,
            now - target.archiveDays * DAY + 2 * HOUR,
          ),
        );
      }
    });
    for (let j = 0; j < special; j += 1) {
      rejectTimes.push(Math.floor(now - target.archiveDays * DAY + rng.float(1, 22) * HOUR));
    }
    // The order of the list is the order channels are made; mistakes are picked from it.
    const mistakeAt = new Set(
      rng.shuffle(rejectTimes.map((_, i) => i)).slice(0, target.mistakes - 9),
    );
    for (let j = 0; j < special; j += 1) mistakeAt.add(rejectTimes.length - 1 - j);
    let handWritten = 0;
    rejectTimes.forEach((r, idx) => {
      const mistake = mistakeAt.has(idx);
      const spec =
        mistake && handWritten < likelyMistakes.length ? at(likelyMistakes, handWritten) : null;
      if (spec !== null) handWritten += 1;
      const cr = blank("waiting", spec === null ? newName() : spec.name);
      if (spec !== null) {
        takenNames.add(spec.name.toLowerCase());
        takenHandles.add(cr.handle);
      }
      const gap = rng.float(1, 25) * DAY;
      cr.run = runAtOrBefore(r - gap);
      cr.foundAt = Math.min(foundTime(cr.run), r - HOUR);
      cr.kw = pickKeyword(at(runs, cr.run), "reject");
      cr.rejectAt = r;
      cr.rejectLogged = true;
      cr.rejectReason = reasonKeys[rng.weighted(reasonW)] ?? "ai";
      cr.mistake = mistake;
      cr.stage = "rejected";
      cr.events.push(["rejected", r]);
      cr.shortlistAt = null;
      if (mistake) {
        cr.subs = spec?.subscribers ?? Math.round(rng.float(90_000, 1_200_000));
        cr.median = spec?.median ?? Math.round(rng.float(92_000, 380_000));
        cr.up30 = spec?.uploads ?? rng.int(4, 16);
        cr.country = spec?.country ?? rng.pick(["US", "GB", "CA", "AU"]);
        cr.brands = spec === null ? pickBrands() : [...spec.brands];
        cr.ratio = 0.3;
        cr.latestUpload = now - Math.floor(rng.float(0.5, 9) * DAY);
        cr.foundEmail = rng.chance(0.7);
      } else {
        const weak = cr.rejectReason === "views" || cr.rejectReason === "posting";
        giveStats(cr, weak ? "weak" : "any");
        if (cr.rejectReason === "audience") {
          while (cr.country !== null && homeCountries.has(cr.country))
            cr.country = randomCountry(false);
        }
        if (cr.rejectReason === "posting")
          cr.up30 = rng.chance(0.5) ? rng.int(0, 2) : rng.int(21, 40);
        // Nothing but a mistake may score 85.
        if (
          (cr.median ?? 0) >= 90_000 &&
          (cr.up30 ?? 0) >= 4 &&
          (cr.up30 ?? 0) <= 20 &&
          cr.country !== null &&
          homeCountries.has(cr.country) &&
          cr.brands.length > 0
        ) {
          cr.brands = [];
          cr.ratio = 0;
        }
      }
      waiting.push(cr);
    });
    // Rejected before dates were kept: no reject line, no due date.
    const old = runs.filter((r) => r.start < now - 30 * DAY);
    for (let i = 0; i < target.waitingUndated; i += 1) {
      const cr = blank("waiting", newName());
      cr.run = rng.int(0, Math.max(0, old.length - 1));
      cr.foundAt = foundTime(cr.run);
      cr.kw = pickKeyword(at(runs, cr.run), "reject");
      cr.rejectReason = null;
      cr.rejectAt = Math.min(cr.foundAt + Math.floor(rng.float(2, 20) * DAY), lastEnd);
      cr.stage = "rejected";
      giveStats(cr, rng.chance(0.4) ? "weak" : "any");
      waiting.push(cr);
    }
  }

  // Every live and waiting channel, in the order they were made.
  crs.push(...emailed, ...shortlistedGroup, ...parked, ...never, ...notReviewed, ...waiting);
  crs.sort((a, b) => a.n - b.n);

  // ---- 5. the archive --------------------------------------------------------------------
  const labels = ["irrelevant", "inactive", "haramStuff", "rejected"];
  const archiveNames: string[] = [];
  for (let i = 0; i < 36_000; i += 1) archiveNames.push(newName());
  const tuples: ArchiveTuple[] = [];
  let tombstone = 0;
  const idOfTomb = (): string => {
    const n = nextChannel + tombstone;
    tombstone += 1;
    return channelSuffix(n);
  };
  {
    const weights = runs.map(
      (r, ri) =>
        (1 + (1.8 * ri) / (runCount - 1)) * rng.float(0.75, 1.25) * (r.duration / (75 * MIN)),
    );
    const kinds: readonly (readonly ["under" | "few" | "over", number])[] = [
      ["under", target.underFiveK],
      ["few", target.fewViews],
      ["over", target.overTwoM],
    ];
    for (const [kind, total] of kinds) {
      const counts = allocate(total, weights);
      runs.forEach((run, ri) => {
        const count = at(counts, ri);
        for (let j = 0; j < count; j += 1) {
          const k = pickKeyword(run, "swept");
          run.fresh[k] = (run.fresh[k] ?? 0) + 1;
          const found = run.start + Math.floor(rng.float(0.02, 1) * run.duration);
          let label = 0;
          let median: number | null = null;
          let subs: number;
          let country: string | null = null;
          let videos: number | null = null;
          let sponsored: 0 | 1 | null = null;
          let hasEmail: 0 | 1 | null = null;
          let archivedAt = found;
          if (kind === "under") {
            subs = 150 + Math.floor(Math.pow(rng.next(), 1.4) * 4_849);
            if (rng.chance(0.015)) label = 2;
          } else if (kind === "over") {
            subs = Math.round(2_000_001 + Math.pow(rng.next(), 3) * 24_000_000);
          } else {
            label = 1;
            subs = Math.round(clamp(rng.logNormal(40_000, 1.1), 5_000, 1_900_000));
            median = Math.floor(Math.pow(rng.next(), 1.6) * 2_000);
            videos = rng.chance(0.5) ? rng.int(0, 2) : rng.int(3, 12);
            country = rng.chance(0.8) ? at(countries, rng.weighted(countryWeights))[0] : null;
            sponsored = rng.chance(0.18) ? 1 : 0;
            hasEmail = rng.chance(0.35) ? 1 : 0;
            archivedAt = found + rng.int(1, 25) * MIN;
          }
          tuples.push([
            idOfTomb(),
            rng.int(0, archiveNames.length - 1),
            archivedAt,
            label,
            k,
            median,
            subs,
            country,
            videos,
            sponsored,
            hasEmail,
            found,
          ]);
        }
      });
    }
  }
  const personTuples: { index: number; rejectAt: number; reason: RejectReason | null }[] = [];
  {
    const reasonKeys: readonly (RejectReason | null)[] = [
      "ai",
      "views",
      "posting",
      "audience",
      null,
    ];
    const reasonW = [0.36, 0.28, 0.18, 0.16, 0.02];
    const latest = lastEnd - target.archiveDays * DAY - 7 * HOUR;
    const days = workIdx.filter((i) => i >= 3 && at(dayStarts, i) + 18 * HOUR <= latest);
    const counts = allocate(
      target.byPerson,
      days.map(() => rng.float(0.85, 1.15)),
    );
    days.forEach((di, i) => {
      for (let j = 0; j < at(counts, i); j += 1) {
        const r = at(dayStarts, di) + (9 * 60 + rng.int(0, 9 * 60 - 1)) * MIN;
        const ri = runAtOrBefore(r - rng.float(1, 25) * DAY);
        const run = at(runs, ri);
        const k = pickKeyword(run, "reject");
        run.fresh[k] = (run.fresh[k] ?? 0) + 1;
        const reason = reasonKeys[rng.weighted(reasonW)] ?? null;
        const found = Math.min(foundTime(ri), r - HOUR);
        const weak = reason === "views" || reason === "posting";
        const subs = Math.round(
          clamp(rng.logNormal(weak ? 25_000 : 60_000, 1.0), 5_000, 1_900_000),
        );
        const median = Math.round(
          clamp(subs * rng.float(0.02, weak ? 0.1 : 0.35), 400, weak ? 6_000 : 70_000),
        );
        personTuples.push({ index: tuples.length, rejectAt: r, reason });
        tuples.push([
          idOfTomb(),
          rng.int(0, archiveNames.length - 1),
          r + target.archiveDays * DAY + rng.int(0, 5 * 60) * MIN,
          3,
          k,
          median,
          subs,
          reason === "audience"
            ? at(countries, 4 + rng.int(0, countries.length - 5))[0]
            : rng.chance(0.93)
              ? at(countries, rng.weighted(countryWeights))[0]
              : null,
          reason === "posting"
            ? rng.chance(0.5)
              ? rng.int(0, 2)
              : rng.int(21, 40)
            : rng.int(2, 16),
          rng.chance(reason === "ai" ? 0.25 : 0.4) ? 1 : 0,
          rng.chance(0.55) ? 1 : 0,
          found,
        ]);
      }
    });
  }

  // ---- 6. rows: gratovo ------------------------------------------------------------------
  const creators: HistoryCreatorRow[] = [];
  const names: HistoryNameRow[] = [];
  const events: HistoryEventRow[] = [];
  const log: HistoryLogRow[] = [];
  let logN = 0;
  const logLine = (
    action: HistoryLogRow["action"],
    channelId: string,
    label: string,
    t: number,
    reasonText: string | null,
    by: string,
  ): void => {
    const actor = actorOf(by);
    const text =
      action === "creator.shortlist"
        ? `Shortlisted ${label}`
        : action === "creator.reject"
          ? `Rejected ${label}`
          : action === "creator.restore"
            ? `Brought back ${label}`
            : `Marked ${label} as never contact`;
    logN += 1;
    log.push({
      id: `hl-${str(logN)}`,
      at: new Date(t).toISOString(),
      at_ms: Math.round(t),
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      action,
      entity_type: "channel",
      entity_id: channelId,
      entity_label: label,
      field: null,
      old_value: null,
      new_value: null,
      detail: reasonText === null ? { text } : { text, reason: reasonText },
    });
  };
  const contactsJson = (cr: Cr): string =>
    cr.email === null
      ? "[]"
      : JSON.stringify([
          {
            method: "email",
            value: cr.email,
            label: cr.confirmed ? cr.contactName : null,
            primary: true,
            confirmed: cr.confirmed,
            source: cr.source,
            confidence: cr.confirmed ? 0.9 : 0.6,
          },
        ]);
  for (const cr of crs) {
    if (cr.stage === null) continue;
    const legacy = legacyCreatorFields(cr.stage);
    const last = cr.events.length > 0 ? at(cr.events, cr.events.length - 1)[1] : now;
    creators.push({
      channel_id: cr.id,
      handle: cr.handle,
      vetting_status: legacy.vettingStatus,
      pipeline_stage: legacy.pipelineStage,
      creator_stage: cr.stage,
      archive_due_at:
        cr.stage === "rejected" && cr.rejectLogged && cr.rejectAt !== null
          ? new Date(cr.rejectAt + 7 * DAY).toISOString()
          : null,
      channel_tags:
        cr.stage === "rejected"
          ? cr.rejectReason === "posting"
            ? '["inactive"]'
            : '["irrelevant"]'
          : "[]",
      contacts: contactsJson(cr),
      updated_at: new Date(last).toISOString(),
    });
    names.push({ channel_id: cr.id, name: cr.name });
    for (const [stage, t] of cr.events) {
      events.push({ channel_id: cr.id, stage, at: Math.floor(t), source: "example" });
    }
    if (cr.shortlistAt !== null && cr.group !== "waiting") {
      logLine("creator.shortlist", cr.id, cr.name, cr.shortlistAt, null, reviewerOf());
    }
    if (cr.brought !== null) {
      logLine("creator.reject", cr.id, cr.name, cr.brought.at, cr.brought.reason, reviewerOf());
      logLine("creator.restore", cr.id, cr.name, cr.brought.restoredAt, null, reviewerOf());
    }
    if (cr.group === "waiting" && cr.rejectLogged && cr.rejectAt !== null) {
      logLine("creator.reject", cr.id, cr.name, cr.rejectAt, cr.rejectReason, reviewerOf());
    }
    if (cr.group === "never" && cr.rejectAt !== null) {
      logLine("creator.never", cr.id, cr.name, cr.rejectAt, cr.neverReason, reviewerOf());
    }
  }
  for (const p of personTuples) {
    const tuple = at(tuples, p.index);
    logLine(
      "creator.reject",
      `UC${tuple[0]}`,
      at(archiveNames, tuple[1]),
      p.rejectAt,
      p.reason,
      reviewerOf(),
    );
  }

  // Messages, drafts and sequences.
  const messages: HistoryMessageRow[] = [];
  const drafts: HistoryDraftRow[] = [];
  const sequences: HistorySequenceRow[] = [];
  let msgN = 0;
  let draftN = 0;
  const fill = (text: string, topic: string): string => text.replace("{topic}", topic);
  const answerDelay = (): number => clamp(rng.logNormal(5 * HOUR, 1.15), 0.3 * HOUR, 4 * DAY);
  for (const cr of emailed) {
    const o = cr.outreach;
    if (o === null || cr.email === null) continue;
    const topic = rng.pick(topics);
    const first = cr.contactName ?? rng.pick(firstNames);
    const thread = `gt-${cr.id}`;
    const key = `c:${cr.id}`;
    const addOut = (
      kind: "first" | "followUp" | "reply",
      followUp: number | null,
      t: number,
      subject: string,
      body: string,
      by: string,
      replyTo: string | null,
      edited: boolean,
      steer: string | null,
    ): string => {
      msgN += 1;
      draftN += 1;
      const id = `hm-${str(msgN)}`;
      const draftId = `hd-${str(draftN)}`;
      const sentAt = Math.floor(t);
      messages.push({
        id,
        channel_id: cr.id,
        direction: "out",
        kind,
        follow_up: followUp,
        subject,
        body,
        body_cut: 0,
        at: sentAt,
        mailbox: o.mailbox,
        peer: cr.email ?? "",
        peer_name: first,
        conversation_key: key,
        gmail_message_id: `gm-h-${str(msgN)}`,
        gmail_thread_id: thread,
        draft_id: draftId,
        by,
        source: "app",
        reading: null,
      });
      drafts.push({
        id: draftId,
        channel_id: cr.id,
        kind,
        follow_up: followUp,
        state: "sent",
        subject,
        body,
        mailbox: o.mailbox,
        send_at: sentAt,
        approved_by: by,
        proposal: null,
        gates_ok: "[]",
        edited: edited ? 1 : 0,
        checked_text: null,
        steer,
        reply_to: replyTo,
        problem: null,
        goal: null,
        created_at: sentAt - rng.int(10, 180) * MIN,
        updated_at: sentAt,
      });
      return id;
    };
    const addIn = (t: number, replyType: string, subject: string): string => {
      msgN += 1;
      const id = `hm-${str(msgN)}`;
      const kind = replyKinds[replyType];
      if (kind === undefined) throw new Error(`Unknown example reply ${replyType}`);
      messages.push({
        id,
        channel_id: cr.id,
        direction: "in",
        kind: null,
        follow_up: null,
        subject,
        body: rng.pick(kind.bodies),
        body_cut: 0,
        at: Math.floor(t),
        mailbox: o.mailbox,
        peer: cr.email ?? "",
        peer_name: first,
        conversation_key: key,
        gmail_message_id: `gm-h-${str(msgN)}`,
        gmail_thread_id: thread,
        draft_id: null,
        by: null,
        source: "sweep",
        reading: JSON.stringify({
          replyType,
          label: kind.label,
          summary: kind.summary,
          side: kind.side,
          corrected: false,
          facts: [],
        }),
      });
      return id;
    };
    const subject = fill(rng.pick(subjects), topic);
    const steer =
      o.rewrite === null ? null : JSON.stringify({ how: o.rewrite, note: null, rewriting: null });
    addOut(
      "first",
      null,
      o.at,
      subject,
      `${fill(rng.pick(openers), topic)} ${rng.pick(pitches)} ${rng.pick(asks)}`,
      o.by,
      null,
      o.edited,
      steer,
    );
    const reply = o.reply;
    const stepsSent = reply !== null ? reply.step : o.allowed;
    const steps: { n: number; dueAt: number; state: string; sentAt: number | null }[] = [];
    let stopped: HistorySequenceRow["stopped"] = null;
    for (let j = 1; j <= 3; j += 1) {
      const due = Math.floor(at(o.times, j));
      if (o.bounce || (reply !== null && j > reply.step)) {
        steps.push({ n: j, dueAt: due, state: "skipped", sentAt: null });
      } else if (j <= stepsSent) {
        if (due <= lastEnd) {
          steps.push({ n: j, dueAt: due, state: "sent", sentAt: due });
          addOut(
            "followUp",
            j,
            due,
            `Re: ${subject}`,
            rng.pick(followUpLines),
            o.by,
            null,
            rng.chance(0.1),
            null,
          );
        } else steps.push({ n: j, dueAt: due, state: "planned", sentAt: null });
      } else if (stopped === null && due <= lastEnd) {
        stopped = "you";
        steps.push({ n: j, dueAt: due, state: "skipped", sentAt: null });
      } else {
        steps.push({
          n: j,
          dueAt: due,
          state: stopped === "you" ? "skipped" : "planned",
          sentAt: null,
        });
      }
    }
    if (o.bounce) {
      stopped = "bounced";
      addIn(o.bounceAt, "any.bounce", "Delivery Status Notification (Failure)");
    } else if (reply !== null) {
      stopped = "replied";
      const inboundId = addIn(reply.at, reply.replyId, `Re: ${subject}`);
      const answers: Record<string, number> = {
        positive: 1,
        signed: 1,
        audience: 1,
        kit: 1,
        parked: 0.5,
        notNow: 0.5,
        manager: 0.75,
        no: 0.15,
        auto: 0,
      };
      const nextEvent = reply.kitAt ?? Number.POSITIVE_INFINITY;
      if (rng.chance(answers[reply.group] ?? 0)) {
        const t = Math.min(reply.at + answerDelay(), nextEvent - 20 * MIN);
        if (t <= lastEnd && t > reply.at) {
          addOut(
            "reply",
            null,
            t,
            `Re: ${subject}`,
            rng.pick(answerLines),
            rng.chance(0.7) ? "u1" : "u2",
            inboundId,
            rng.chance(0.4),
            null,
          );
        }
      }
      if (reply.kitAt !== null) {
        const kitIn = addIn(reply.kitAt, "inf.media_kit", `Re: ${subject}`);
        const t = Math.min(reply.kitAt + answerDelay(), (reply.audienceAt ?? lastEnd) - 20 * MIN);
        if (t <= lastEnd && t > reply.kitAt) {
          addOut(
            "reply",
            null,
            t,
            `Re: ${subject}`,
            rng.pick(answerLines),
            "u1",
            kitIn,
            rng.chance(0.4),
            null,
          );
        }
      }
      if (reply.signedAt !== null) {
        const yes = addIn(reply.signedAt - 5 * HOUR, "inf.agrees", `Re: ${subject}`);
        addOut(
          "reply",
          null,
          reply.signedAt - HOUR,
          `Re: ${subject}`,
          "Wonderful, the contract is on its way.",
          "u2",
          yes,
          false,
          null,
        );
      }
    } else if (stopped === null && stepsSent >= 3 && at(o.times, 3) <= lastEnd) {
      stopped = "finished";
    }
    sequences.push({
      channel_id: cr.id,
      conversation_key: key,
      mailbox: o.mailbox,
      started_at: o.at,
      steps: JSON.stringify(steps),
      stopped,
      park_until: reply?.parkedAt != null ? reply.parkedAt + 45 * DAY : null,
      updated_at: Math.floor(Math.min(lastEnd, reply?.at ?? at(o.times, Math.min(3, stepsSent)))),
    });
  }
  messages.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  events.sort((a, b) => a.at - b.at);
  log.sort((a, b) => a.at_ms - b.at_ms);

  // ---- 7. rows: pipeline -----------------------------------------------------------------
  const channels: HistoryChannelRow[] = [];
  const links: HistoryLinkRow[] = [];
  const keywordNames = specs.map((s) => s.keyword);
  const extraCount = new Int32Array(nk);
  const linked = new Set<string>();
  for (const cr of crs) {
    const foundIso = iso(cr.foundAt);
    const kwName = at(keywordNames, cr.kw);
    at(runs, cr.run).fresh[cr.kw] = (at(runs, cr.run).fresh[cr.kw] ?? 0) + 1;
    links.push({ channel_id: cr.id, keyword: kwName, discovered_at: foundIso, source: "local" });
    linked.add(`${cr.id}|${kwName}`);
    if (cr.run < runCount - 1 && rng.chance(0.18)) {
      const later = Math.min(
        runCount - 1,
        cr.run + 1 + Math.floor(Math.pow(rng.next(), 0.6) * (runCount - 1 - cr.run)),
      );
      const run = at(runs, later);
      const k = pickKeyword(run, "live");
      const name = at(keywordNames, k);
      if (!linked.has(`${cr.id}|${name}`)) {
        linked.add(`${cr.id}|${name}`);
        extraCount[k] = (extraCount[k] ?? 0) + 1;
        run.upserts += 1;
        links.push({
          channel_id: cr.id,
          keyword: name,
          discovered_at: iso(run.start + Math.floor(rng.float(0.05, 0.95) * run.duration)),
          source: "local",
        });
      }
    }
    const read = cr.read === 0;
    const emailsFound =
      cr.email !== null ? [cr.email] : cr.foundEmail ? [`hello@${cr.handle.slice(1)}.com`] : [];
    channels.push({
      channel_id: cr.id,
      handle: cr.handle,
      name: cr.name,
      country: cr.country,
      subscribers: cr.subs === null ? "Hidden" : str(cr.subs),
      first_seen_at: foundIso,
      videos_fetched_at: read ? iso(Math.min(lastEnd, cr.foundAt + 20 * MIN)) : null,
      videos_last_30: read ? (cr.up30 ?? 0) : 0,
      median_views_last_30: read ? cr.median : null,
      latest_upload_at: read && cr.latestUpload !== null ? iso(cr.latestUpload) : null,
      sponsored_ratio: read ? cr.ratio : null,
      seen_brands: JSON.stringify(read ? cr.brands : []),
      found_emails: JSON.stringify(emailsFound),
      found_email_sources: JSON.stringify(
        emailsFound.map((email) => ({
          email,
          source: cr.source === "video" ? "video" : "about",
          videos: cr.source === "video" ? rng.int(1, 4) : 0,
          business: true,
        })),
      ),
      read_failures: cr.read === 2 ? rng.int(1, 2) : cr.read === 3 ? 3 : 0,
      unreadable_until: cr.read === 2 ? iso(now + rng.int(1, 3) * DAY) : null,
      median_known: cr.read >= 2 ? Math.round(rng.float(3_000, 60_000)) : null,
      videos_last_30_known: cr.read >= 2 ? rng.int(2, 12) : null,
    });
  }

  // The seed's creators: catalog channels with their videos, found by the two best keywords.
  const videos: HistoryVideoRow[] = [];
  const seedKeywords = [kwIndex("local llm setup"), kwIndex("ai agents tutorial")];
  seed.channels.forEach((channel, index) => {
    const creator = seed.creators[index];
    if (creator === undefined) return;
    const kw = at(seedKeywords, index % seedKeywords.length);
    const name = at(keywordNames, kw);
    links.push({
      channel_id: channel.id,
      keyword: name,
      discovered_at: iso(channel.foundAt),
      source: "local",
    });
    extraCount[kw] = (extraCount[kw] ?? 0) + 1;
    const sponsored = channel.sponsors.length > 0;
    channels.push({
      channel_id: channel.id,
      handle: creator.handle,
      name: creator.name,
      country: channel.country,
      subscribers: str(channel.subscribers),
      first_seen_at: iso(channel.foundAt),
      videos_fetched_at: iso(Math.min(now, channel.foundAt + 20 * MIN)),
      videos_last_30: channel.uploads30,
      median_views_last_30: channel.medianViews,
      latest_upload_at: iso(channel.latestUploadAt),
      sponsored_ratio: sponsored ? Math.round((0.15 + (index % 5) * 0.08) * 100) / 100 : 0,
      seen_brands: JSON.stringify(channel.sponsors),
      found_emails: JSON.stringify(channel.emails),
      found_email_sources: JSON.stringify(
        channel.emails.map((email) => ({ email, source: "about", videos: 0, business: true })),
      ),
      read_failures: 0,
      unreadable_until: null,
      median_known: null,
      videos_last_30_known: null,
    });
    channel.videos.forEach((video, n) => {
      videos.push({
        video_id: exampleVideoId(channel.id, n),
        channel_id: channel.id,
        title: video.title,
        published_at: iso(video.publishedAt),
        view_count: str(video.views),
      });
    });
  });

  // Archived channels a search found again this week.
  const pending: HistoryPendingRow[] = [];
  {
    const byKeyword: number[][] = specs.map(() => []);
    tuples.forEach((t, i) => {
      at(byKeyword, t[4]).push(i);
    });
    const seen = new Set<string>();
    const weekAgo = now - 7 * DAY;
    runs.forEach((run, ri) => {
      if (run.start < weekAgo) return;
      for (const k of run.keywords) {
        const fresh = run.fresh[k] ?? 0;
        const share =
          k === chatIdx && ri === runCount - 1 ? 9 : rng.float(0.06, k === newsIdx ? 0.27 : 0.2);
        const worn = k === chatIdx && ri === runCount - 1;
        const want = Math.max(Math.round(fresh * share), worn ? 100 : 0);
        const pool = at(byKeyword, k);
        for (let j = 0, tried = 0; j < want && tried < want * 3 && pool.length > 0; tried += 1) {
          const tuple = at(tuples, at(pool, rng.int(0, pool.length - 1)));
          const key = `${tuple[0]}|${str(k)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          j += 1;
          pending.push({
            channel_id: `UC${tuple[0]}`,
            keyword: at(keywordNames, k),
            handles_limit: 200,
            discovered_at: iso(run.start + Math.floor(rng.float(0.05, 0.95) * run.duration)),
          });
        }
      }
    });
  }

  // Keywords and runs.
  const found = new Int32Array(nk);
  runs.forEach((run) => {
    run.keywords.forEach((k) => {
      found[k] = (found[k] ?? 0) + (run.fresh[k] ?? 0);
    });
  });
  const keywordRows: HistoryKeywordRow[] = specs.map((s, k) => {
    const list = at(runsOf, k);
    const first = at(runs, at(list, 0));
    const lastOne = at(runs, at(list, list.length - 1));
    return {
      keyword: s.keyword,
      status: "done",
      channels_found: (found[k] ?? 0) + (extraCount[k] ?? 0),
      added_at: iso(first.start - HOUR),
      completed_at: iso(lastOne.start + lastOne.duration),
    };
  });
  const runRows: HistoryRunRow[] = runs.map((run) => {
    let fresh = 0;
    for (const k of run.keywords) fresh += run.fresh[k] ?? 0;
    return {
      started_at: iso(run.start),
      finished_at: iso(run.start + run.duration),
      status: "done",
      keywords_total: run.keywords.length,
      keywords_done: run.keywords.length,
      channels_upserted: fresh + run.upserts,
      videos_upserted: Math.round(fresh * 0.012 * 14) + run.upserts * 3,
      kind: "search",
    };
  });

  // ---- 8. the weekly catalog totals ------------------------------------------------------
  const weekStart = (t: number): number => {
    const d = new Date(t);
    const back = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
  };
  const lastMonday = weekStart(now);
  const mondays: number[] = [];
  for (let w = 25; w >= 0; w -= 1) {
    const d = new Date(lastMonday);
    mondays.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * w).getTime());
  }
  const monday0 = at(mondays, 0);
  const weekOf = (t: number): number =>
    clamp(Math.floor((t - monday0) / (7 * DAY)), 0, mondays.length - 1);
  const liveDelta = new Int32Array(mondays.length + 1);
  const waitDelta = new Int32Array(mondays.length + 1);
  const archDelta = new Int32Array(mondays.length + 1);
  const bump = (arr: Int32Array, t: number, by: number): void => {
    const w = weekOf(t);
    arr[w] = (arr[w] ?? 0) + by;
  };
  let liveNow = 0;
  let waitingNow = 0;
  // The seed's channels all count as live (the two it has rejected stay in Live with no date).
  for (const channel of seed.channels) {
    bump(liveDelta, channel.foundAt, 1);
    liveNow += 1;
  }
  for (const cr of crs) {
    if (cr.group === "waiting") {
      waitingNow += 1;
      bump(liveDelta, cr.foundAt, 1);
      bump(liveDelta, cr.rejectAt ?? cr.foundAt, -1);
      bump(waitDelta, cr.rejectAt ?? cr.foundAt, 1);
    } else {
      liveNow += 1;
      bump(liveDelta, cr.foundAt, 1);
    }
  }
  for (const t of tuples) {
    bump(archDelta, t[2], 1);
    if (t[3] === 3) {
      bump(liveDelta, t[11], 1);
      bump(liveDelta, t[2] - target.archiveDays * DAY, -1);
      bump(waitDelta, t[2] - target.archiveDays * DAY, 1);
      bump(waitDelta, t[2], -1);
    }
  }
  const weeks: HistoryWeekRow[] = [];
  {
    let l = 0;
    let w = 0;
    let a = 0;
    mondays.forEach((monday, i) => {
      l += liveDelta[i] ?? 0;
      w += waitDelta[i] ?? 0;
      a += archDelta[i] ?? 0;
      const last = i === mondays.length - 1;
      weeks.push({
        week: `${new Date(monday).getFullYear().toString()}-${String(new Date(monday).getMonth() + 1).padStart(2, "0")}-${String(new Date(monday).getDate()).padStart(2, "0")}`,
        live: last ? liveNow : Math.max(0, l),
        waiting: last ? waitingNow : Math.max(0, w),
        archive: last ? tuples.length : a,
        written_at: last ? now : at(mondays, i + 1) - 1,
      });
    });
  }

  return {
    gratovo: {
      creators,
      names,
      log,
      events,
      messages,
      drafts,
      sequences,
      weeks,
      settings: { archiveDays: target.archiveDays },
    },
    pipeline: {
      channels,
      videos,
      keywords: keywordRows,
      links,
      runs: runRows,
      archive: { labels, keywords: keywordNames, names: archiveNames, tuples },
      pending,
    },
  };
}
