import { join } from "node:path";

import type { CreatorState } from "@gratovo/core/data";
import { findErrors, type FindState } from "@gratovo/ipc";

import { redact, secretsOf } from "../pipeline/logs";
import { gatewayUrlsForSearch } from "../pipeline/pipeline-secrets";
import type { PipelineMessage, Start } from "../pipeline/protocol";
import type { PipelineExit, PipelineSupervisor } from "../pipeline/supervisor";
import type { SecretStore } from "../secret-store";

import { pipelineRules, readFindFile, writeFindFile, type FindFile } from "./find-store";
import { readKept } from "./results";

/**
 * What the Find screen needs from the main process: the queue, the rules, one search run through
 * the pipeline supervisor, and the channels it kept. The page reads `state()` and gets the same
 * shape in `find:changed`, throttled while a run streams messages.
 *
 * The queue lives in `find.json` beside `pipeline.db`: `example-pipeline` for the example data,
 * `pipeline` when signed in. The proxies and gateways come from the secret store and go only into
 * the start message; nothing of them (or of the key) enters the state, an event or the file.
 */

export type FindMode = "example" | "live";

export interface FindServiceDeps {
  supervisor: PipelineSupervisor;
  account: {
    findContext(): { mode: FindMode; workerId: string; folder: string } | null;
    teamKeys: { youtubeKey(): Promise<string | null> };
  };
  secrets: Pick<SecretStore, "get">;
  userData: string;
  /**
   * The start message's `settings` (pacing, parallel, proxies); `{}` when not given. Any `mail`
   * part is dropped: a search needs no mailbox, so its start message carries no address.
   */
  settings?: () => Start["settings"];
  emit: (state: FindState) => void;
  now: () => number;
  /**
   * Every creator's stored state, for the search's `skip` list (never-contact creators, D7).
   * Not given or failing means no skip list.
   */
  creatorStates?: () => Promise<readonly CreatorState[]>;
  /**
   * Called when `pipeline.db` has changed: a keyword finished or failed, or the job ended. Not on
   * each channel line: a keyword writes its channels as it goes, and its done line follows (D1).
   * The catalog rebuilds on it.
   */
  onPipelineChanged?: () => void;
  /** The least time between two emits while a run streams. Default 250. */
  throttleMs?: number;
  /**
   * Asks a store-lane job that gives way to a search (the email finder's refetch, plan D30) to
   * stop, and resolves once it has gone; at once when there is none. A start that finds the lane
   * busy calls it first, so a lookup in the background never makes Start answer `running`.
   */
  yieldLane?: () => Promise<void>;
}

export type StartProblem = "no_keywords" | "running" | "no_youtube_key" | "no_python";

export interface FindService {
  state(): FindState;
  /** The open find folder (where `pipeline.db` is); null when no source is open. */
  folder(): string | null;
  add(keywords: readonly string[]): { added: number; skipped: number };
  remove(index: number): { ok: true } | { ok: false; problem: "running" };
  startAt(index: number): { ok: true } | { ok: false; problem: "running" };
  /**
   * Replaces the rules (Settings › Search rules). A search already running keeps the rules it
   * started with; the next one uses these.
   */
  setRules(rules: FindFile["rules"]): void;
  start(): Promise<{ ok: true } | { ok: false; problem: StartProblem }>;
  stop(): void;
  /** Stops a running search and resolves once it is gone. For sign-out and quit. */
  shutdown(): Promise<void>;
}

const queueMax = 500;
const skipMax = 20_000;
const channelIdShape = /^UC[A-Za-z0-9_-]{22}$/;

/** The settings a search starts with: everything but the mail settings. */
export function searchSettings(settings: Start["settings"] | undefined): Start["settings"] {
  const kept = { ...settings };
  delete kept.mail;
  return kept;
}
const logMax = 200;
const keptMax = 100;
const noData = "No data is open.";

type Run = FindState["run"];
type Kept = FindState["kept"][number];

interface Session {
  folder: string;
  queue: FindFile["queue"];
  at: number;
  rules: FindFile["rules"];
  run: Run;
  log: FindState["log"];
  /** The list a run is building; null means read it from `pipeline.db` when asked. */
  kept: Kept[] | null;
}

const readyRun = (): Run => ({ state: "ready", found: 0, kept: 0, swept: 0, error: null });

/** The proxies: a secret-store value holding a JSON list of URLs; anything else is no URLs. */
async function urlList(secrets: Pick<SecretStore, "get">, name: string): Promise<string[]> {
  try {
    const raw = await secrets.get(name);
    const parsed: unknown = raw === undefined ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      return [];
    }
    return parsed.filter((url) => url.length >= 1 && url.length <= 2000).slice(0, 100);
  } catch {
    return [];
  }
}

/**
 * The proxies and gateways a search sends YouTube's requests through. The email finder's refetch
 * (D30) reads them the same way, so both jobs take the same route.
 */
export async function searchRouting(
  secrets: Pick<SecretStore, "get">,
): Promise<{ proxyUrls: string[]; gatewayUrls: string[] }> {
  const proxyUrls = await urlList(secrets, "pipeline.proxies");
  const gatewayUrls = await gatewayUrlsForSearch(secrets);
  return { proxyUrls, gatewayUrls };
}

export function createFindService(deps: FindServiceDeps): FindService {
  const { supervisor, account, secrets } = deps;
  const throttleMs = deps.throttleMs ?? 250;

  let session: Session | null = null;
  let starting = false;
  // True while this service's own search holds the lane. The lane can also be running another
  // store job (the email finder's refetch, the import): those are not a search to pause or guard.
  let searching = false;
  let stopRequested = false;
  // Bumped by shutdown (sign-out, quit): a start still awaiting its key gives up when it changed.
  let generation = 0;
  // Where the running job began; `at` is the first keyword from here that isn't done.
  let runStart = 0;
  // The running job's secrets: blanked out of its log lines before they reach the page.
  let jobSecrets: string[] = [];
  let lastEmit = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Read through a function so a check made before an await is not assumed to still hold. */
  function isRunning(): boolean {
    return supervisor.running;
  }

  /** Whether this service's own search is starting or running. */
  function busy(): boolean {
    return starting || searching;
  }

  /** Where a source's queue and `pipeline.db` live: its own folder under the user data. */
  function folderFor(context: { folder: string }): string {
    return join(deps.userData, context.folder);
  }

  /** The open session; read again when the data changed (sign-in, sign-out). */
  function open(): { session: Session; mode: FindMode; workerId: string } {
    const context = account.findContext();
    if (context === null) {
      throw new Error(noData);
    }
    const folder = folderFor(context);
    if (session?.folder !== folder) {
      session = { folder, ...readFindFile(folder), run: readyRun(), log: [], kept: null };
    }
    return { session, ...context };
  }

  function save(s: Session): void {
    try {
      writeFindFile(s.folder, { queue: s.queue, at: s.at, rules: s.rules });
    } catch {
      // The queue stays in memory; the next change tries again.
      console.error("Find: the queue file could not be written.");
    }
  }

  function build(s: Session): FindState {
    return {
      queue: s.queue.map((entry) => ({ ...entry })),
      at: s.at,
      rules: s.rules,
      run: { ...s.run },
      log: s.log.map((line) => ({ ...line })),
      kept: s.kept ?? readKept(join(s.folder, "pipeline.db"), s.rules, keptMax),
    };
  }

  function emitNow(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastEmit = deps.now();
    try {
      deps.emit(build(open().session));
    } catch {
      // No data is open any more: nobody to tell.
    }
  }

  /** For streamed changes: at most one emit per `throttleMs`, the trailing one with the newest. */
  function notify(): void {
    if (timer !== null) {
      return;
    }
    const wait = throttleMs - (deps.now() - lastEmit);
    if (wait <= 0) {
      emitNow();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      emitNow();
    }, wait);
  }

  /** Never-contact channels the search treats as known; a failed read means none. */
  async function skipList(): Promise<string[]> {
    if (deps.creatorStates === undefined) {
      return [];
    }
    try {
      const states = await deps.creatorStates();
      return states
        .filter((state) => state.stage === "never" && channelIdShape.test(state.id))
        .map((state) => state.id)
        .slice(0, skipMax);
    } catch {
      console.error("Find: the never-contact list could not be read.");
      return [];
    }
  }

  /** The first keyword from the run's start that isn't done. With parallel workers keywords can
   * finish out of order, so "one after the last done" could skip one still unfinished. */
  function firstUndone(s: Session): number {
    for (let i = Math.min(runStart, s.queue.length); i < s.queue.length; i += 1) {
      if (s.queue[i]?.state !== "done") {
        return i;
      }
    }
    return s.queue.length;
  }

  function message(s: Session, m: PipelineMessage): void {
    switch (m.type) {
      case "keyword": {
        const entry = s.queue[m.index];
        if (entry === undefined) {
          return;
        }
        if (m.state === "started") {
          entry.state = "running";
        } else if (m.state === "done") {
          entry.state = "done";
          entry.found = m.found ?? 0;
          entry.kept = m.kept ?? 0;
          s.at = firstUndone(s);
          s.run.found += m.found ?? 0;
          save(s);
        } else {
          entry.state = "failed";
        }
        if (m.state !== "started") {
          deps.onPipelineChanged?.();
        }
        break;
      }
      case "channel":
        if (m.outcome === "kept") {
          s.run.kept += 1;
          const channel: Kept = {
            channelId: m.channelId,
            name: m.name.slice(0, 200),
            // The page's limit is 200; a percent-encoded non-Latin handle can be longer.
            handle: m.handle === null ? null : m.handle.slice(0, 200),
            subscribers: m.subscribers,
            medianViews: m.medianViews,
            country: m.country,
            keyword: m.keyword,
          };
          s.kept = [channel, ...(s.kept ?? [])].slice(0, keptMax);
        } else if (m.outcome === "swept") {
          s.run.swept += 1;
        }
        break;
      case "log":
        s.log = [
          ...s.log,
          // Blanking can lengthen a line ("[secret]" for a shorter secret): cut to the page's limit.
          { at: deps.now(), level: m.level, text: redact(m.text, jobSecrets).slice(0, 500) },
        ].slice(-logMax);
        break;
      default:
        return;
    }
    notify();
  }

  function exit(s: Session, how: PipelineExit): void {
    searching = false;
    if (how.kind === "ended") {
      const end = how.end;
      s.at = Math.min(end.at, s.queue.length);
      if (end.state === "done") {
        s.run.state = "done";
      } else if (end.state === "stopped") {
        s.run.state = "paused";
      } else {
        s.run.state = "failed";
        const code = end.error?.code;
        // A search ends with one of the find errors; any other code (bad_start, or one that only
        // another job sends) means the two sides disagree, which the screen shows as a crash.
        s.run.error = findErrors.find((known) => known === code) ?? "crash";
      }
    } else if (how.reason === "killed" && stopRequested) {
      s.run.state = "paused";
    } else {
      s.run.state = "failed";
      s.run.error = "crash";
    }
    for (const entry of s.queue) {
      if (entry.state === "running") {
        entry.state = "queued";
      }
    }
    s.kept = null;
    save(s);
    emitNow();
    deps.onPipelineChanged?.();
  }

  return {
    state() {
      return build(open().session);
    },

    // Read only: asking where the folder is must not switch the session (and drop a run's state).
    folder() {
      const context = account.findContext();
      return context === null ? null : folderFor(context);
    },

    add(keywords) {
      const { session: s } = open();
      const seen = new Set(s.queue.map((entry) => entry.keyword.toLowerCase()));
      let added = 0;
      for (const raw of keywords) {
        const keyword = raw.trim();
        if (keyword === "" || seen.has(keyword.toLowerCase()) || s.queue.length >= queueMax) {
          continue;
        }
        seen.add(keyword.toLowerCase());
        s.queue.push({ keyword, state: "queued", found: 0, kept: 0 });
        added += 1;
      }
      save(s);
      emitNow();
      return { added, skipped: keywords.length - added };
    },

    remove(index) {
      const { session: s } = open();
      if (busy()) {
        return { ok: false, problem: "running" };
      }
      if (index < s.queue.length) {
        s.queue.splice(index, 1);
        if (index < s.at) {
          s.at -= 1;
        }
        save(s);
        emitNow();
      }
      return { ok: true };
    },

    setRules(rules) {
      const { session: s } = open();
      s.rules = rules;
      if (!busy()) {
        // The kept list is read with the rules: read it again with the new ones.
        s.kept = null;
      }
      save(s);
      emitNow();
    },

    startAt(index) {
      const { session: s } = open();
      if (busy()) {
        return { ok: false, problem: "running" };
      }
      s.at = Math.min(index, s.queue.length);
      save(s);
      emitNow();
      return { ok: true };
    },

    async start() {
      if (busy()) {
        return { ok: false, problem: "running" };
      }
      const { session: s, mode, workerId } = open();
      if (s.at >= s.queue.length) {
        return { ok: false, problem: "no_keywords" };
      }
      starting = true;
      const startedIn = generation;
      try {
        let youtubeKey: string | null = null;
        if (mode === "live") {
          try {
            youtubeKey = (await account.teamKeys.youtubeKey()) ?? null;
          } catch {
            console.error("Find: the YouTube key lookup failed.");
          }
          if (youtubeKey === null || youtubeKey === "") {
            return { ok: false, problem: "no_youtube_key" };
          }
        }
        const { proxyUrls, gatewayUrls } = await searchRouting(secrets);
        // The lookups above took time: the account may have signed out or changed (a live search
        // must never start for someone no longer signed in). Another job on the lane is checked
        // last, just before the start.
        const now = account.findContext();
        if (
          generation !== startedIn ||
          now === null ||
          now.mode !== mode ||
          now.workerId !== workerId ||
          session !== s
        ) {
          return { ok: false, problem: "running" };
        }
        if (s.at >= s.queue.length) {
          return { ok: false, problem: "no_keywords" };
        }
        const skip = await skipList();
        // A lookup in the background gives way (plan D30): it stops between two channels and
        // comes back after the search. Nothing is awaited between this and the start below, so
        // it can't take the lane back first. Any other job (the import) still answers `running`.
        if (isRunning() && deps.yieldLane !== undefined) {
          await deps.yieldLane();
        }
        if (isRunning() || generation !== startedIn || session !== s) {
          return { ok: false, problem: "running" };
        }
        stopRequested = false;
        runStart = s.at;
        jobSecrets = secretsOf({ secrets: { youtubeKey, proxyUrls, gatewayUrls } });
        // Set before the start, so an exit that came at once would still clear it.
        searching = true;
        const started = supervisor.start(
          {
            type: "start",
            protocol: 1,
            source: mode,
            dataDir: s.folder,
            worker: workerId,
            job: {
              kind: "search",
              keywords: s.queue.map((entry) => entry.keyword),
              startAt: s.at,
              rules: pipelineRules(s.rules),
              ...(skip.length === 0 ? {} : { skip }),
            },
            settings: searchSettings(deps.settings?.()),
            secrets: { youtubeKey, proxyUrls, gatewayUrls },
          },
          {
            onMessage: (m) => {
              message(s, m);
            },
            onExit: (how) => {
              exit(s, how);
            },
          },
        );
        if (!started.ok) {
          searching = false;
          return started;
        }
        s.run = { state: "running", found: 0, kept: 0, swept: 0, error: null };
        s.log = [];
        s.kept = readKept(join(s.folder, "pipeline.db"), s.rules, keptMax);
        emitNow();
        return { ok: true };
      } finally {
        starting = false;
      }
    },

    stop() {
      if (!searching || session === null) {
        return;
      }
      stopRequested = true;
      session.run.state = "stopping";
      supervisor.stop();
      emitNow();
    },

    async shutdown() {
      generation += 1;
      stopRequested = true;
      await supervisor.shutdown();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
