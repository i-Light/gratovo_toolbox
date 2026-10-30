import type { DataSource, InsightsLocalCreator } from "@gratovo/core/data";
import { archiveDate, fitScore, type CatalogItem } from "@gratovo/core/find";
import type {
  ArchiveFacts,
  ChannelFacts,
  InsightsInputs,
  KeywordFacts,
  LogFact,
} from "@gratovo/core/insights";

import {
  readPipelineFacts,
  weeklyArchive,
  type KeywordBase,
  type PipelineFacts,
} from "./pipeline-facts";

/**
 * The reader (plan step P8a, A8): `gratovo.db` through the data source, `pipeline.db` read-only,
 * and the Find catalog's rows, put together as the `InsightsInputs` the pure reports are worked
 * out from. One pass per report; the archive is SQL totals (kept by the file's size and time), the
 * catalog's live and waiting channels come as rows.
 */

const hourMs = 3_600_000;
const dayMs = 86_400_000;
/** The weeks the archive's weekly series covers. */
const archiveWeeks = 13;

export interface ReadInputsOptions {
  readonly source: DataSource;
  /** `pipeline.db`; a missing file gives an empty catalog and archive. */
  readonly pipelineDbPath: string;
  /** The catalog snapshot (`FindCatalog.snapshot().rows`). */
  readonly catalog: readonly CatalogItem[];
  readonly archiveDays: number;
  readonly now: number;
  /**
   * Whether deals and money may be read. False on live data until step 9 (B8): the deals, brands
   * and their events come as nothing, so no deal or money reading has anything to count. Default true.
   */
  readonly deals?: boolean;
}

/** What a channel's uploads say, or why they don't (`ChannelFacts.read`). */
function readState(item: CatalogItem, pipe: PipelineFacts): ChannelFacts["read"] {
  if (item.uploadsRead || !item.hasNumbers) {
    return "ok";
  }
  if (item.readFailed) {
    return "gaveUp";
  }
  return pipe.retrying.has(item.id) ? "retrying" : "notRead";
}

function channelOf(
  item: CatalogItem,
  local: InsightsLocalCreator | undefined,
  pipe: PipelineFacts,
  archiveDays: number,
): ChannelFacts {
  const read = item.hasNumbers && item.uploadsRead;
  const keywords = pipe.links.get(item.id) ?? (item.keyword === null ? [] : [item.keyword]);
  return {
    id: item.id,
    name: item.name,
    handle: item.handle === "" ? null : item.handle,
    stage: item.stage === "new" ? null : item.stage,
    // A tombstoned channel is gone from the catalog, whatever state row is left.
    inCatalog: item.hasNumbers && item.archivedAt === null,
    foundAt: item.foundAt,
    keywords,
    medianViews: read ? item.medianViews : null,
    uploads30: read ? item.uploads30 : null,
    subscribers: item.subscribers,
    country: item.country,
    sponsored: read ? item.sponsors.length > 0 : null,
    fit: fitScore(item),
    read: readState(item, pipe),
    hasAddress: (local?.hasAddress ?? false) || item.email !== null || item.emails.length > 0,
    confirmedAt: local?.confirmedAt ?? null,
    addressSource: local?.addressSource ?? item.emails[0]?.source ?? null,
    rejectReason: item.rejectReason,
    rejectedAt: item.rejectedAt,
    leavesAt: item.stage === "rejected" ? archiveDate(item, archiveDays) : null,
    audit: local?.audit ?? null,
  };
}

/** A creator with a stage but no catalog row at all (never in a snapshot): known by its state. */
function stateOnly(local: InsightsLocalCreator): ChannelFacts {
  return {
    id: local.id,
    name: local.name ?? local.handle,
    handle: local.handle === "" ? null : local.handle,
    stage: local.stage === "new" ? null : local.stage,
    inCatalog: false,
    foundAt: null,
    keywords: [],
    medianViews: null,
    uploads30: null,
    subscribers: null,
    country: null,
    sponsored: null,
    fit: 0,
    read: "ok",
    hasAddress: local.hasAddress,
    confirmedAt: local.confirmedAt,
    addressSource: local.addressSource,
    rejectReason: null,
    rejectedAt: null,
    leavesAt: null,
    audit: local.audit,
  };
}

/**
 * The last run of a keyword: when it finished, the channels new to us (its links found in the run,
 * and the archived ones the gate swept at once), and the archived ones a search found again (the
 * pending rows). The pipeline does not record how many channels a run met that were already live,
 * so that is 0 here. The run's window starts at the keyword's `started_at`, else at the newest
 * search run that began before it finished; the tombstones' entries are counted by the hour.
 */
function lastRunOf(kb: KeywordBase, pipe: PipelineFacts): KeywordFacts["lastRun"] {
  const end = kb.completedAt;
  if (end === null) {
    return null;
  }
  const start = kb.startedAt ?? pipe.runs.find((run) => run <= end) ?? end - 6 * hourMs;
  let fresh = (pipe.linkTimes.get(kb.keyword) ?? []).filter(
    (at) => at >= start && at <= end,
  ).length;
  for (const hour of pipe.keywordHours) {
    if (
      hour.keyword === kb.keyword &&
      hour.original &&
      hour.at !== null &&
      hour.at + hourMs > start &&
      hour.at <= end
    ) {
      fresh += hour.n;
    }
  }
  const archived = new Set(
    pipe.pending
      .filter((p) => p.keyword === kb.keyword && p.at >= start && p.at <= end)
      .map((p) => p.channelId),
  ).size;
  return { at: end, fresh, live: 0, archived };
}

function keywordFacts(pipe: PipelineFacts): KeywordFacts[] {
  const found = new Map<string, { n: number; rules: number }>();
  const entry = (keyword: string): { n: number; rules: number } => {
    let kept = found.get(keyword);
    if (kept === undefined) {
      kept = { n: 0, rules: 0 };
      found.set(keyword, kept);
    }
    return kept;
  };
  for (const [keyword, times] of pipe.linkTimes) {
    entry(keyword).n += times.length;
  }
  for (const hour of pipe.keywordHours) {
    const kept = entry(hour.keyword);
    kept.n += hour.n;
    if (hour.rules) {
      kept.rules += hour.n;
    }
  }
  return pipe.keywords.map((kb) => ({
    keyword: kb.keyword,
    found: found.get(kb.keyword)?.n ?? 0,
    sweptByRules: found.get(kb.keyword)?.rules ?? 0,
    lastRun: lastRunOf(kb, pipe),
  }));
}

/** People's rejects by the reason on the creator's latest reject line (none: "unknown"). */
function personReasons(
  ids: readonly string[],
  log: readonly LogFact[],
): ArchiveFacts["personReasons"] {
  const latest = new Map<string, LogFact["reason"]>();
  for (const line of log) {
    if (line.action === "reject") {
      latest.set(line.channelId, line.reason);
    }
  }
  const counts = new Map<string, number>();
  for (const id of ids) {
    const reason = latest.get(id) ?? "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, n]) => ({
      reason: reason as ArchiveFacts["personReasons"][number]["reason"],
      count: n,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function archiveFacts(pipe: PipelineFacts, log: readonly LogFact[], now: number): ArchiveFacts {
  const a = pipe.archive;
  const since = now - 7 * dayMs;
  return {
    total: a.total,
    byRules: a.byRules,
    byPerson: a.total - a.byRules,
    ruleLabels: a.ruleLabels,
    personReasons: personReasons(a.personIds, log),
    weekly: weeklyArchive(a.hours, now, archiveWeeks),
    refoundThisWeek: new Set(
      pipe.pending.filter((p) => p.at >= since && p.at <= now).map((p) => p.channelId),
    ).size,
    person: a.person,
    rules: a.rules,
  };
}

/** Reads both databases and the catalog into the inputs of one report. */
export function readInputs(o: ReadInputsOptions): InsightsInputs {
  const local = o.source.insights.readLocal();
  const pipe = readPipelineFacts(o.pipelineDbPath);
  const states = new Map(local.creators.map((c) => [c.id, c]));
  const channels: ChannelFacts[] = [];
  const seen = new Set<string>();
  for (const item of o.catalog) {
    seen.add(item.id);
    channels.push(channelOf(item, states.get(item.id), pipe, o.archiveDays));
  }
  for (const creator of local.creators) {
    if (!seen.has(creator.id) && creator.stage !== "new") {
      channels.push(stateOnly(creator));
    }
  }
  const withDeals = o.deals !== false;
  return {
    now: o.now,
    archiveDays: o.archiveDays,
    channels,
    events: local.events,
    log: local.log,
    messages: local.messages,
    inSequence: local.inSequence,
    mailboxes: local.mailboxes,
    keywords: keywordFacts(pipe),
    archive: archiveFacts(pipe, local.log, o.now),
    weeks: local.weeks,
    runs: pipe.runs,
    goal: local.goal,
    hidden: local.hidden,
    deals: withDeals ? local.deals : [],
    brands: withDeals ? local.brands : [],
    dealEvents: withDeals ? local.dealEvents : [],
    brandEvents: withDeals ? local.brandEvents : [],
    seesMoney: local.seesMoney,
    marginFloorPct: local.marginFloorPct,
  };
}
