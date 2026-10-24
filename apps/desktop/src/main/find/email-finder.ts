import { emptyFindFilter } from "@gratovo/core/find";
import type { FindEmailsEvent } from "@gratovo/ipc";

import type { PipelineExit, PipelineSupervisor } from "../pipeline/supervisor";
import type { Start } from "../pipeline/protocol";
import { strings } from "../strings";

import type { FindCatalog } from "./catalog-types";
import { searchSettings } from "./find-service";

/**
 * The email finder after a shortlist (plan step 5c, D30). Live data only: each shortlist hands
 * its creators here, and after a quiet spell of `debounceMs` the ones still shortlisted with no
 * confirmed address are refetched on the store lane, at most `batchMax` handles a job. A refetch
 * reads the About text and the latest videos again, so the addresses and their sources refresh.
 * The example data never refetches: refetch has no offline source, so the addresses the search
 * read stand as they are.
 *
 * The lane runs one job at a time. A refetch waits while a search (or the import) holds it,
 * trying again every `laneRetryMs`; and it gives way when Start is pressed (`yieldLane`): it stops
 * between two channels, and the channels it hadn't reached wait for the search to end.
 *
 * The jobs tray learns of it through `emit` (`find:emails`): "Finding emails for n channels" while
 * it runs, then "k emails found", k being the addresses that weren't on those channels before.
 */

/** What the finder needs to know about one creator. */
export interface FinderChannel {
  readonly id: string;
  readonly handle: string;
  readonly stage: string;
  readonly confirmed: boolean;
  /** The addresses the pipeline has found on the channel. */
  readonly emails: readonly string[];
}

export interface EmailFinderDeps {
  /** The store lane. */
  supervisor: Pick<PipelineSupervisor, "running" | "start" | "stop">;
  /** The live job's folder and worker; null on the example data or with nothing open. */
  liveContext(): { dataDir: string; worker: string } | null;
  /** The team's YouTube key, as a search gets it. */
  youtubeKey(): Promise<string | null>;
  /** The proxies and gateways, as a search gets them (`searchRouting`). */
  routing(): Promise<{ proxyUrls: string[]; gatewayUrls: string[] }>;
  /** The start message's settings; any mail part is dropped, as for a search. */
  settings?: () => Start["settings"];
  /** The named creators as the catalog has them now; one it doesn't have is left out. */
  channels(ids: readonly string[]): Promise<readonly FinderChannel[]>;
  /** Called after each job: `pipeline.db` changed, so the catalog rebuilds. */
  onPipelineChanged?: () => void;
  emit(event: FindEmailsEvent): void;
  /** Default 2000. */
  debounceMs?: number;
  /** How long to wait before trying a busy lane again. Default 5000. */
  laneRetryMs?: number;
}

export interface EmailFinder {
  /** Creators just moved to shortlisted. Ignored on the example data. */
  shortlisted(ids: readonly string[]): void;
  /** Stops a running refetch to free the lane for a search; resolves once it has ended. */
  yieldLane(): Promise<void>;
  dispose(): void;
}

/** The most handles one refetch job carries (D30). */
export const batchMax = 50;
const defaultDebounceMs = 2000;
const defaultLaneRetryMs = 5000;
/** As refetch's `handles` in `protocol.ts`. */
const handleShape = /^@[A-Za-z0-9._-]{1,100}$/;

/** The handle as refetch takes it (`@name`), or null when it can't take this one. */
function refetchHandle(handle: string): string | null {
  const trimmed = handle.trim();
  const at = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return handleShape.test(at) ? at : null;
}

const lower = (emails: readonly string[]): Set<string> =>
  new Set(emails.map((email) => email.toLowerCase()));

/** The addresses in `after` that no channel had in `before`, counted per channel. */
function newAddresses(
  before: ReadonlyMap<string, ReadonlySet<string>>,
  after: readonly FinderChannel[],
): number {
  let count = 0;
  for (const channel of after) {
    const had = before.get(channel.id) ?? new Set<string>();
    for (const email of lower(channel.emails)) {
      if (!had.has(email)) {
        count += 1;
      }
    }
  }
  return count;
}

/** How many catalog pages `catalogChannels` reads at most (120 a page). */
const pagesMax = 200;

/**
 * `channels` from the Find catalog: its shortlisted creators, paged, kept to the named ones. A
 * creator no longer shortlisted is left out, which the finder reads as "skip it". Waits for a
 * pending rebuild, so a shortlist or a confirm just written is seen.
 */
export function catalogChannels(
  catalog: Pick<FindCatalog, "query">,
): (ids: readonly string[]) => Promise<readonly FinderChannel[]> {
  return async (ids) => {
    const wanted = new Set(ids);
    const found: FinderChannel[] = [];
    for (let page = 0; page < pagesMax && found.length < wanted.size; page += 1) {
      const answer = await catalog.query({
        filter: { ...emptyFindFilter, stages: ["shortlisted"] },
        sort: "found",
        offset: page * 120,
        limit: 120,
        facets: false,
      });
      for (const item of answer.items) {
        if (wanted.has(item.id)) {
          found.push({
            id: item.id,
            handle: item.handle,
            stage: item.stage,
            confirmed: item.emailConfirmed,
            emails: item.emails.map((email) => email.email),
          });
        }
      }
      if ((page + 1) * 120 >= answer.total) {
        break;
      }
    }
    return found;
  };
}

interface Job {
  readonly ids: readonly string[];
  /** The channels the job has reached (its `channel` lines). */
  readonly reached: Set<string>;
  readonly before: ReadonlyMap<string, ReadonlySet<string>>;
}

export function createEmailFinder(deps: EmailFinderDeps): EmailFinder {
  const { supervisor } = deps;
  const debounceMs = deps.debounceMs ?? defaultDebounceMs;
  const laneRetryMs = deps.laneRetryMs ?? defaultLaneRetryMs;

  /** Whose data the waiting ids belong to (folder and worker); a change drops them. */
  let owner: string | null = null;
  const collected = new Set<string>();
  let debounce: ReturnType<typeof setTimeout> | null = null;
  /** Ids waiting for a job, oldest first. */
  let pending: string[] = [];
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** True from a batch's preparation to its job's end. */
  let working = false;
  let job: Job | null = null;
  /** Searches waiting for the running job to give way. */
  let yielders: (() => void)[] | null = null;
  /** The lookup the tray shows: every channel since it began, and the new addresses so far. */
  let round: { ids: Set<string>; found: number } | null = null;
  let disposed = false;

  /** Read through a function so a check made before an await is not assumed to still hold. */
  function laneBusy(): boolean {
    return supervisor.running;
  }

  const ownerOf = (context: { dataDir: string; worker: string }): string =>
    `${context.worker}\n${context.dataDir}`;

  function emit(state: FindEmailsEvent["state"], problem: string | null = null): void {
    // While it runs, the channels still waiting count too (one that gave way is in both).
    const channels =
      state === "running"
        ? new Set([...(round?.ids ?? []), ...pending]).size
        : (round?.ids.size ?? 0);
    const found = round?.found ?? 0;
    const words = strings.emailFinder;
    deps.emit({
      state,
      channels,
      found,
      label:
        state === "running"
          ? words.running(channels)
          : state === "done"
            ? words.found(found)
            : words.failed,
      detail:
        problem === null ? null : (words.problems[problem] ?? words.problems["crash"] ?? null),
    });
  }

  /** Forgets everything waiting: the data closed or changed hands. Nothing is shown. */
  function drop(): void {
    pending = [];
    collected.clear();
    round = null;
  }

  function finish(): void {
    if (round !== null) {
      emit("done");
      round = null;
    }
  }

  /** Ends the lookup on a failure: the tray says so, and the channels waiting are let go. */
  function fail(code: string): void {
    // The kind only: no handle, no key, no message text.
    console.error(`Email finder: a lookup failed (${code}).`);
    round ??= { ids: new Set(pending), found: 0 };
    pending = [];
    emit("failed", code);
    round = null;
  }

  function later(): void {
    if (retry !== null || disposed) {
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      kick();
    }, laneRetryMs);
  }

  function kick(): void {
    if (working || retry !== null || disposed) {
      return;
    }
    working = true;
    void next().then(
      (started) => {
        if (!started) {
          working = false;
        }
      },
      () => {
        // Something threw (the lane's start, the data's context): without this the finder would
        // stay "working" and ignore every later shortlist. The lookup fails as any other does,
        // letting its channels go; the next shortlist starts afresh.
        working = false;
        fail("crash");
      },
    );
  }

  /** Prepares and starts the next batch; true when a job started (its exit carries on). */
  async function next(): Promise<boolean> {
    const context = deps.liveContext();
    if (context === null || ownerOf(context) !== owner) {
      drop();
      return false;
    }
    if (pending.length === 0) {
      finish();
      return false;
    }
    if (laneBusy()) {
      later();
      return false;
    }
    const asked = new Set(pending);
    let known: readonly FinderChannel[];
    try {
      known = await deps.channels([...asked]);
    } catch {
      fail("crash");
      return false;
    }
    const byId = new Map(known.map((channel) => [channel.id, channel]));
    const handles = new Map<string, string>();
    const seenHandles = new Set<string>();
    // Ids that came in during the lookup weren't asked about: they wait for the next batch.
    pending = pending.filter((id) => {
      if (!asked.has(id)) {
        return true;
      }
      const channel = byId.get(id);
      const handle = channel === undefined ? null : refetchHandle(channel.handle);
      if (
        channel === undefined ||
        channel.stage !== "shortlisted" ||
        channel.confirmed ||
        handle === null ||
        seenHandles.has(handle.toLowerCase())
      ) {
        return false;
      }
      seenHandles.add(handle.toLowerCase());
      handles.set(id, handle);
      return true;
    });
    const ids = pending.filter((id) => handles.has(id)).slice(0, batchMax);
    if (ids.length === 0) {
      if (pending.length > 0) {
        return next();
      }
      finish();
      return false;
    }
    let youtubeKey: string | null;
    try {
      youtubeKey = await deps.youtubeKey();
    } catch {
      youtubeKey = null;
    }
    if (youtubeKey === null || youtubeKey === "") {
      fail("no_youtube_key");
      return false;
    }
    const { proxyUrls, gatewayUrls } = await deps.routing();
    // The awaits took time: the data may have closed, or a search may have taken the lane.
    const now = deps.liveContext();
    if (now === null || ownerOf(now) !== owner || disposed) {
      drop();
      return false;
    }
    if (laneBusy()) {
      later();
      return false;
    }
    const taken = new Set(ids);
    const current: Job = {
      ids,
      reached: new Set(),
      before: new Map(ids.map((id) => [id, lower(byId.get(id)?.emails ?? [])])),
    };
    const started = supervisor.start(
      {
        type: "start",
        protocol: 1,
        source: "live",
        dataDir: now.dataDir,
        worker: now.worker,
        job: {
          kind: "refetch",
          handles: ids.map((id) => handles.get(id) ?? ""),
          // The keyword is left to refetch's own default, and nothing is archived (D30).
          autoClean: null,
        },
        settings: searchSettings(deps.settings?.()),
        secrets: { youtubeKey, proxyUrls, gatewayUrls },
      },
      {
        onMessage(message) {
          if (message.type === "channel") {
            current.reached.add(message.channelId);
          }
        },
        onExit(how) {
          void ended(current, how);
        },
      },
    );
    if (!started.ok) {
      if (started.problem === "running") {
        later();
      } else {
        fail(started.problem);
      }
      return false;
    }
    job = current;
    pending = pending.filter((id) => !taken.has(id));
    round ??= { ids: new Set(), found: 0 };
    for (const id of ids) {
      round.ids.add(id);
    }
    emit("running");
    return true;
  }

  async function ended(finished: Job, how: PipelineExit): Promise<void> {
    job = null;
    // A search waiting on Start goes first, before the counting below.
    const gaveWay = yielders;
    yielders = null;
    for (const resolve of gaveWay ?? []) {
      resolve();
    }
    deps.onPipelineChanged?.();
    let after: readonly FinderChannel[] = [];
    try {
      after = await deps.channels(finished.ids);
    } catch {
      console.error("Email finder: the channels could not be read after a lookup.");
    }
    if (round !== null) {
      round.found += newAddresses(finished.before, after);
    }
    working = false;
    const state = how.kind === "ended" ? how.end.state : "failed";
    if (gaveWay !== null && (state === "stopped" || state === "failed")) {
      // It stopped for a search: the channels it hadn't reached go first once the lane is free.
      // (A refetch that ran past the stop's grace is killed, which ends `failed`.)
      const unreached = finished.ids.filter((id) => !finished.reached.has(id));
      pending = [...unreached, ...pending.filter((id) => !unreached.includes(id))];
      later();
      return;
    }
    if (how.kind === "failed") {
      fail("crash");
      return;
    }
    if (how.end.state === "failed") {
      fail(how.end.error?.code ?? "crash");
      return;
    }
    if (how.end.state === "stopped") {
      // Stopped from outside (sign-out, quit): what was found stands; the rest is let go.
      pending = [];
      finish();
      return;
    }
    kick();
  }

  return {
    shortlisted(ids) {
      const context = deps.liveContext();
      if (context === null || ids.length === 0 || disposed) {
        return;
      }
      const key = ownerOf(context);
      if (owner !== key) {
        drop();
        owner = key;
      }
      for (const id of ids) {
        collected.add(id);
      }
      if (debounce !== null) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => {
        debounce = null;
        const running = new Set(job?.ids ?? []);
        for (const id of collected) {
          if (!pending.includes(id) && !running.has(id)) {
            pending.push(id);
          }
        }
        collected.clear();
        kick();
      }, debounceMs);
    },

    yieldLane() {
      if (job === null) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        if (yielders === null) {
          yielders = [];
          supervisor.stop();
        }
        yielders.push(resolve);
      });
    },

    dispose() {
      disposed = true;
      for (const timer of [debounce, retry]) {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
      debounce = null;
      retry = null;
    },
  };
}
