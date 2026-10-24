import { archiveDate, type CatalogItem } from "@gratovo/core/find";
import type { ChannelResponse } from "@gratovo/ipc";

import type { PipelineExit, PipelineSupervisor } from "../pipeline/supervisor";
import type { Job, PipelineMessage, Start } from "../pipeline/protocol";

import { searchSettings } from "./find-service";
import type { CatalogSnapshot } from "./toolbox";

/**
 * Archiving rejected creators for good, and bringing them back (plan step 5d, D37 and D38).
 *
 * The sweep picks the creators at `rejected` whose archive date (`archiveDate`, D35) has passed
 * and runs `archive.sweep` on the store lane, at most `sweepMax` a job. It runs shortly after
 * start, every hour, and whenever the Archive tool opens (`toolbox:sweep`), on live and example
 * data alike: it only touches the open source's own `pipeline.db`. One sweep at a time: a request
 * while one runs or waits is folded into it, as one more pass once it ends.
 *
 * A restore runs `archive.restore` and, on live data, refetches the restored handles in the
 * background so their numbers come back. It waits up to `restoreWaitMs` for the finder or a sweep,
 * never for a search: a search can run for hours, so the page is told at once to try again later.
 *
 * Like the email finder (D30), the sweep and the refetch wait behind a busy lane, trying again
 * every `laneRetryMs`, and give way when Start is pressed (`yieldLane`). A restore waiting goes
 * before this service's own next sweep or refetch job.
 */

/** Whose data, which folder: the start message's `source`, `dataDir` and `worker`. */
export interface ArchiveContext {
  readonly source: "live" | "example";
  readonly dataDir: string;
  readonly worker: string;
}

export interface ArchiveServiceDeps {
  /** The store lane. */
  supervisor: Pick<PipelineSupervisor, "running" | "start" | "stop">;
  /** The open source's job context; null with nothing open. */
  context(): ArchiveContext | null;
  /** Whether a search holds the lane (running or stopping). */
  searching(): boolean;
  /** The catalog's rows; waits for a pending rebuild. */
  snapshot(): Promise<CatalogSnapshot>;
  /** The owner's archive days (Settings › Search rules). */
  archiveDays(): number;
  /** The team's YouTube key, as a search gets it (the refetch only). */
  youtubeKey(): Promise<string | null>;
  /** The proxies and gateways, as a search gets them (the refetch only). */
  routing(): Promise<{ proxyUrls: string[]; gatewayUrls: string[] }>;
  /** The refetch's start settings; any mail part is dropped, as for a search. */
  settings?: () => Start["settings"];
  /** Called after each job: `pipeline.db` changed, so the catalog rebuilds. */
  onPipelineChanged?: () => void;
  now?: () => number;
  /** How long to wait before trying a busy lane again. Default 5000. */
  laneRetryMs?: number;
  /** How long a restore waits for the finder or a sweep. Default 60000. */
  restoreWaitMs?: number;
  /** How often a waiting restore looks at the lane. Default 1000. */
  restorePollMs?: number;
  /** The first sweep, after start. Default 30000. */
  firstSweepMs?: number;
  /** The sweeps after it. Default an hour. */
  sweepEveryMs?: number;
}

export type RestoreAnswer = ChannelResponse<"toolbox:restore">;

export interface ArchiveService {
  /** Sweeps now, or once more after the sweep in progress. Never throws. */
  sweep(): void;
  /** Deletes the named tombstones, then refetches them on live data (D38). */
  restore(ids: readonly string[]): Promise<RestoreAnswer>;
  /** Stops a running sweep or refetch to free the lane for a search; resolves once it has ended. */
  yieldLane(): Promise<void>;
  dispose(): void;
}

/** The most channels one `archive.sweep` job carries (D37). */
export const sweepMax = 2000;
/** The most handles one refetch job carries, as the email finder's (D30, D38). */
export const refetchMax = 50;

const defaultLaneRetryMs = 5000;
const defaultRestoreWaitMs = 60_000;
const defaultRestorePollMs = 1000;
const defaultFirstSweepMs = 30_000;
const defaultSweepEveryMs = 3_600_000;

/** As the archive jobs' channel ids and handles in `protocol.ts`. */
const channelIdShape = /^UC[A-Za-z0-9_-]{22}$/;
const handleShape = /^@[A-Za-z0-9._-]{1,100}$/;

/** The handle as the protocol takes it (`@name`), or null when it can't take this one. */
function protocolHandle(handle: string | null): string | null {
  const trimmed = handle?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  const at = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return handleShape.test(at) ? at : null;
}

/** The rejected creators due for archiving at `now`; a creator with no archive date never is. */
export function dueChannels(
  rows: readonly CatalogItem[],
  archiveDays: number,
  now: number,
): { channelId: string; handle: string | null }[] {
  const seen = new Set<string>();
  const due: { channelId: string; handle: string | null }[] = [];
  for (const row of rows) {
    if (row.stage !== "rejected" || row.archivedAt !== null || !channelIdShape.test(row.id)) {
      continue;
    }
    const at = archiveDate(row, archiveDays);
    if (at === null || at > now || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    due.push({ channelId: row.id, handle: protocolHandle(row.handle) });
  }
  return due;
}

type Holder = "sweep" | "restore" | "refetch";

/** How one of this service's jobs ended, and whether a search asked it to give way meanwhile. */
interface Ran {
  readonly exit: PipelineExit;
  readonly yielded: boolean;
}

/** The failure's kind for the log: an end code or the supervisor's reason, never a message. */
function failureOf(exit: PipelineExit): string | null {
  if (exit.kind === "failed") {
    return exit.reason;
  }
  return exit.end.state === "done" ? null : (exit.end.error?.code ?? exit.end.state);
}

const ownerOf = (context: ArchiveContext): string =>
  `${context.source}\n${context.worker}\n${context.dataDir}`;

export function createArchiveService(deps: ArchiveServiceDeps): ArchiveService {
  const { supervisor } = deps;
  const now = deps.now ?? Date.now;
  const laneRetryMs = deps.laneRetryMs ?? defaultLaneRetryMs;
  const restoreWaitMs = deps.restoreWaitMs ?? defaultRestoreWaitMs;
  const restorePollMs = deps.restorePollMs ?? defaultRestorePollMs;

  let disposed = false;
  /** This service's job on the lane, if any. */
  let held: Holder | null = null;
  /** Searches waiting for this service's job to give way. */
  let yielders: (() => void)[] | null = null;
  /** Restores waiting for the lane: this service's own sweep and refetch let them go first. */
  let restoresWaiting = 0;
  let sweeping = false;
  let sweepAgain = false;
  /** The handles to refetch, oldest first, and whose data they belong to. */
  let refetchPending: { id: string; handle: string }[] = [];
  let refetchOwner: string | null = null;
  let refetching = false;
  const sleepers = new Map<ReturnType<typeof setTimeout>, () => void>();

  /** Resolves after `ms`, or at once on dispose (the caller then checks `disposed`). */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        sleepers.delete(timer);
        resolve();
      }, ms);
      sleepers.set(timer, resolve);
    });
  }

  /** Read through a function so a check made before an await is not assumed to still hold. */
  function laneFree(kind: Holder): boolean {
    return !supervisor.running && held === null && (kind === "restore" || restoresWaiting === 0);
  }

  /** A search holds the lane: it is running and isn't this service's job. */
  function searchHolds(): boolean {
    return supervisor.running && held === null && deps.searching();
  }

  /** The archive jobs need no key, no route and no settings. */
  function startOf(context: ArchiveContext, job: Job): Start {
    return {
      type: "start",
      protocol: 1,
      source: context.source,
      dataDir: context.dataDir,
      worker: context.worker,
      job,
      settings: {},
      secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
    };
  }

  /** Starts one job now; `done` settles when it has ended and any search waiting is let go. */
  function run(
    kind: Holder,
    start: Start,
    onMessage?: (message: PipelineMessage) => void,
  ): { ok: true; done: Promise<Ran> } | { ok: false; problem: "running" | "no_python" } {
    let settle: (ran: Ran) => void = () => undefined;
    const done = new Promise<Ran>((resolve) => {
      settle = resolve;
    });
    held = kind;
    const started = supervisor.start(start, {
      onMessage(message) {
        onMessage?.(message);
      },
      onExit(exit) {
        held = null;
        // A search waiting on Start goes first; the caller then waits `laneRetryMs`, so it can't
        // take the lane back before the search starts.
        const gaveWay = yielders;
        yielders = null;
        for (const resolve of gaveWay ?? []) {
          resolve();
        }
        settle({ exit, yielded: gaveWay !== null });
      },
    });
    if (!started.ok) {
      held = null;
      return started;
    }
    return { ok: true, done };
  }

  /**
   * Waits until the lane is free for `kind`, trying again every `laneRetryMs`. Null when the data
   * closed or changed hands meanwhile, or on dispose: the work waiting is let go.
   */
  async function waitLane(kind: Holder, owner: string): Promise<ArchiveContext | null> {
    for (;;) {
      const context = disposed ? null : deps.context();
      if (context === null || ownerOf(context) !== owner) {
        return null;
      }
      if (laneFree(kind)) {
        return context;
      }
      await sleep(laneRetryMs);
    }
  }

  function archiveDays(): number | null {
    try {
      return deps.archiveDays();
    } catch {
      return null;
    }
  }

  /** One pass: the creators due now, `sweepMax` a job, one job after another. */
  async function sweepPass(): Promise<void> {
    const first = deps.context();
    if (first === null) {
      return;
    }
    const owner = ownerOf(first);
    const snapshot = await deps.snapshot();
    const days = archiveDays();
    if (days === null) {
      return;
    }
    const due = dueChannels(snapshot.rows, days, now());
    let at = 0;
    while (at < due.length) {
      const context = await waitLane("sweep", owner);
      if (context === null) {
        return;
      }
      const channels = due.slice(at, at + sweepMax);
      const started = run("sweep", startOf(context, { kind: "archive.sweep", channels }));
      if (!started.ok) {
        if (started.problem === "running") {
          await sleep(laneRetryMs);
          continue;
        }
        console.error("Archive: the sweep could not start (no_python).");
        return;
      }
      const { exit, yielded } = await started.done;
      deps.onPipelineChanged?.();
      const failure = failureOf(exit);
      if (yielded) {
        // It gave way to a search: a stopped job is sent again once the lane is free (the sweep is
        // idempotent), and either way the search starts first.
        await sleep(laneRetryMs);
        if (failure === null) {
          at += sweepMax;
        }
        continue;
      }
      if (failure !== null) {
        // The kind only: no handle, no message text.
        console.error(`Archive: a sweep failed (${failure}).`);
        return;
      }
      at += sweepMax;
    }
  }

  /** Whether a request came in during the pass; read through a function, as it changes meanwhile. */
  function again(): boolean {
    return sweepAgain && !disposed;
  }

  function sweep(): void {
    if (disposed) {
      return;
    }
    if (sweeping) {
      sweepAgain = true;
      return;
    }
    sweeping = true;
    void (async () => {
      try {
        do {
          sweepAgain = false;
          await sweepPass();
        } while (again());
      } catch {
        console.error("Archive: a sweep failed (crash).");
      } finally {
        sweeping = false;
        sweepAgain = false;
      }
    })();
  }

  /** Lets the refetches go: the data closed or changed hands, or one failed. */
  function dropRefetch(): void {
    refetchPending = [];
  }

  async function refetchLoop(): Promise<void> {
    while (refetchPending.length > 0 && refetchOwner !== null) {
      const owner = refetchOwner;
      const context = await waitLane("refetch", owner);
      if (context === null || context.source !== "live") {
        dropRefetch();
        return;
      }
      const batch = refetchPending.slice(0, refetchMax);
      let youtubeKey: string | null;
      try {
        youtubeKey = await deps.youtubeKey();
      } catch {
        youtubeKey = null;
      }
      if (youtubeKey === null || youtubeKey === "") {
        console.error("Archive: a refetch failed (no_youtube_key).");
        dropRefetch();
        return;
      }
      const { proxyUrls, gatewayUrls } = await deps.routing();
      // The awaits took time: the data may have closed, or a search may have taken the lane.
      const current = disposed ? null : deps.context();
      if (current === null || ownerOf(current) !== owner) {
        dropRefetch();
        return;
      }
      if (!laneFree("refetch")) {
        continue;
      }
      const reached = new Set<string>();
      const started = run(
        "refetch",
        {
          type: "start",
          protocol: 1,
          source: "live",
          dataDir: current.dataDir,
          worker: current.worker,
          // No auto-clean: a creator just brought back must not be archived again (D38).
          job: { kind: "refetch", handles: batch.map((item) => item.handle), autoClean: null },
          settings: searchSettings(deps.settings?.()),
          secrets: { youtubeKey, proxyUrls, gatewayUrls },
        },
        (message) => {
          if (message.type === "channel") {
            reached.add(message.channelId);
          }
        },
      );
      if (!started.ok) {
        if (started.problem === "running") {
          await sleep(laneRetryMs);
          continue;
        }
        console.error("Archive: a refetch could not start (no_python).");
        dropRefetch();
        return;
      }
      const taken = new Set(batch.map((item) => item.id));
      refetchPending = refetchPending.filter((item) => !taken.has(item.id));
      const { exit, yielded } = await started.done;
      deps.onPipelineChanged?.();
      const failure = failureOf(exit);
      if (yielded) {
        if (failure !== null) {
          // It stopped for a search: the channels it hadn't reached go first after it.
          const unreached = batch.filter((item) => !reached.has(item.id));
          const back = new Set(unreached.map((item) => item.id));
          refetchPending = [...unreached, ...refetchPending.filter((item) => !back.has(item.id))];
        }
        await sleep(laneRetryMs);
        continue;
      }
      if (failure !== null) {
        console.error(`Archive: a refetch failed (${failure}).`);
        dropRefetch();
        return;
      }
    }
  }

  /** `afterYield`: a search is about to take the lane, so the first try waits `laneRetryMs`. */
  function queueRefetch(
    items: readonly { id: string; handle: string }[],
    owner: string,
    afterYield: boolean,
  ): void {
    if (refetchOwner !== owner) {
      dropRefetch();
      refetchOwner = owner;
    }
    const known = new Set(refetchPending.map((item) => item.id));
    for (const item of items) {
      if (!known.has(item.id)) {
        known.add(item.id);
        refetchPending.push(item);
      }
    }
    if (refetching || disposed) {
      return;
    }
    refetching = true;
    void (afterYield ? sleep(laneRetryMs) : Promise.resolve())
      .then(refetchLoop)
      .catch(() => {
        console.error("Archive: a refetch failed (crash).");
        dropRefetch();
      })
      .finally(() => {
        refetching = false;
      });
  }

  /**
   * Starts the restore once the lane is free, waiting up to `restoreWaitMs` for the finder or a
   * sweep; a failure the page can act on when it can't.
   */
  async function startRestore(
    ids: readonly string[],
  ): Promise<
    | { ok: true; context: ArchiveContext; done: Promise<Ran> }
    | { ok: false; problem: "busy" | "no_python" }
  > {
    const busy = { ok: false, problem: "busy" } as const;
    for (let waited = 0; ; waited += restorePollMs) {
      const context = disposed ? null : deps.context();
      if (context === null || searchHolds()) {
        return busy;
      }
      if (laneFree("restore")) {
        const started = run(
          "restore",
          startOf(context, { kind: "archive.restore", channelIds: [...ids] }),
        );
        if (started.ok) {
          return { ok: true, context, done: started.done };
        }
        if (started.problem === "no_python") {
          return { ok: false, problem: "no_python" };
        }
      }
      if (waited >= restoreWaitMs) {
        return busy;
      }
      await sleep(restorePollMs);
    }
  }

  async function restore(ids: readonly string[]): Promise<RestoreAnswer> {
    restoresWaiting += 1;
    let job: Awaited<ReturnType<typeof startRestore>>;
    try {
      job = await startRestore(ids);
    } finally {
      restoresWaiting -= 1;
    }
    if (!job.ok) {
      return job;
    }
    const { exit, yielded } = await job.done;
    deps.onPipelineChanged?.();
    const failure = failureOf(exit);
    if (failure !== null || exit.kind !== "ended" || exit.result?.kind !== "archive.restore") {
      // Not a state the page can act on: the dispatcher logs it and the page says it failed.
      throw new Error(`Archive: a restore failed (${failure ?? "no_result"}).`);
    }
    const restored = exit.result.data.restored;
    // Example data has no refetch: a channel returns when a search finds it again (D38).
    const refetch =
      job.context.source === "live"
        ? restored.flatMap((item) => {
            const handle = protocolHandle(item.handle);
            return handle === null ? [] : [{ id: item.channelId, handle }];
          })
        : [];
    if (refetch.length > 0) {
      queueRefetch(refetch, ownerOf(job.context), yielded);
    }
    return { ok: true, restored: restored.length, refetch: refetch.length > 0 };
  }

  const firstSweep = setTimeout(sweep, deps.firstSweepMs ?? defaultFirstSweepMs);
  const everySweep = setInterval(sweep, deps.sweepEveryMs ?? defaultSweepEveryMs);

  return {
    sweep,
    restore,

    yieldLane() {
      if (held === null) {
        return Promise.resolve();
      }
      const kind = held;
      return new Promise<void>((resolve) => {
        if (yielders === null) {
          yielders = [];
          // A restore is short and the person is waiting on it: it ends on its own.
          if (kind !== "restore") {
            supervisor.stop();
          }
        }
        yielders.push(resolve);
      });
    },

    dispose() {
      disposed = true;
      clearTimeout(firstSweep);
      clearInterval(everySweep);
      for (const [timer, resolve] of sleepers) {
        clearTimeout(timer);
        resolve();
      }
      sleepers.clear();
      dropRefetch();
    },
  };
}
