import {
  geminiPort,
  geminiRequestLine,
  maxGeminiLineLength,
  parseGeminiLine,
  readGeminiResult,
  type GeminiErrorCode,
  type GeminiEvent,
  type GeminiParams,
  type GeminiResult,
  type TypedGeminiMethod,
} from "./gemini-protocol";
import { readLines } from "./lines";
import type { PipelineLog } from "./logs";
import type { PythonCommand } from "./python-path";
import { quitGraceMs, type ChildLike, type SpawnPipeline } from "./supervisor";

/**
 * Runs the Gemini bridge (step 3e-3, `.router/PLAN.md` D2): one long-lived
 * `python -I -u -m gratovo_pipeline.gemini` that the browser extension connects to, and that main
 * asks things with JSON lines. Unlike a job, it answers many requests, in any order, by `id`.
 *
 * At most one runs (the owner's rule: port 8765). It needs no secrets. Every line it writes is
 * checked against `gemini-protocol.ts`; one that fails is logged and ignored, and three in a row
 * end it, as for the jobs. Closing stdin stops it; on quit it is killed 5 s later if still there.
 */

export interface GeminiStartOptions {
  /** The data source's pipeline folder: `pipeline.db`, which the comms actions read. */
  dataDir: string;
  /** `<userData>/gemini-profile`: the browser profile the bridge manages. */
  profileDir: string;
  /** `services/gemini-extension` (step 6); the bridge reports the add-on missing until then. */
  extensionDir: string;
  /** The owner's course folders, from this computer's settings (plan D8), when set. */
  courseDir?: string;
  videoDir?: string;
}

export type GeminiStart =
  { ok: true } | { ok: false; problem: "running" | "no_python" | "port_in_use" | "crash" };

/** A failed call: the bridge's code, or `NOT_RUNNING` when there is no bridge to ask. */
export interface GeminiCallError {
  code: GeminiErrorCode | "NOT_RUNNING";
  message: string;
  details: Record<string, unknown>;
}

export type GeminiCall<M extends TypedGeminiMethod> =
  { ok: true; result: GeminiResult<M> } | { ok: false; error: GeminiCallError };

export type GeminiState = "stopped" | "starting" | "listening";

export interface GeminiService {
  readonly state: GeminiState;
  start(options: GeminiStartOptions): Promise<GeminiStart>;
  /**
   * Asks the bridge. Resolves with its answer, or `TIMEOUT` after `timeoutMs` (default: the
   * method's own `timeoutS` plus 30 s, else 30 s), leaving the bridge to finish; never rejects.
   */
  call<M extends TypedGeminiMethod>(
    method: M,
    params: GeminiParams<M>,
    options?: { timeoutMs?: number },
  ): Promise<GeminiCall<M>>;
  /** Every event the bridge sends (daemon state, progress, the extension's). Returns an unsubscribe. */
  onEvent(listener: (event: GeminiEvent) => void): () => void;
  /** Stops the bridge and resolves once it is gone (killed after `quitGraceMs`). */
  shutdown(): Promise<void>;
}

/** How long the bridge has to say `listening` before main gives up on it. */
export const listenTimeoutMs = 30_000;
const defaultCallTimeoutMs = 30_000;
const callSlackMs = 30_000;
const badLinesToFail = 3;
const loggedLineLength = 200;

export function bridgeArgs(options: GeminiStartOptions): string[] {
  const args = [
    "-I",
    "-u",
    "-m",
    "gratovo_pipeline.gemini",
    "--port",
    String(geminiPort),
    "--data-dir",
    options.dataDir,
    "--profile-dir",
    options.profileDir,
    "--extension-dir",
    options.extensionDir,
  ];
  if (options.courseDir !== undefined) {
    args.push("--course-dir", options.courseDir);
  }
  if (options.videoDir !== undefined) {
    args.push("--video-dir", options.videoDir);
  }
  return args;
}

function defaultTimeout(params: unknown): number {
  if (typeof params === "object" && params !== null && "timeoutS" in params) {
    const seconds = (params as { timeoutS?: unknown }).timeoutS;
    if (typeof seconds === "number" && seconds > 0) {
      return seconds * 1000 + callSlackMs;
    }
  }
  return defaultCallTimeoutMs;
}

interface Pending {
  method: TypedGeminiMethod;
  resolve: (answer: GeminiCall<TypedGeminiMethod>) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createGeminiService(o: {
  spawn: SpawnPipeline;
  python: () => PythonCommand | null;
  env: Record<string, string>;
  openLog: () => PipelineLog;
}): GeminiService {
  const listeners = new Set<(event: GeminiEvent) => void>();
  let state: GeminiState = "stopped";
  let bridge: {
    child: ChildLike;
    pending: Map<string, Pending>;
    exited: Promise<void>;
    write(text: string): boolean;
    kill(): void;
  } | null = null;
  let nextId = 1;

  function notRunning(): GeminiCallError {
    return { code: "NOT_RUNNING", message: "The Gemini bridge isn't running.", details: {} };
  }

  return {
    get state() {
      return state;
    },

    start(options) {
      if (bridge !== null) {
        return Promise.resolve({ ok: false, problem: "running" });
      }
      const command = o.python();
      if (command === null) {
        return Promise.resolve({ ok: false, problem: "no_python" });
      }
      const log = o.openLog();
      const child = o.spawn(command.python, bridgeArgs(options), {
        cwd: command.cwd,
        env: o.env,
      });
      state = "starting";

      const pending = new Map<string, Pending>();
      let settleStart: (outcome: GeminiStart) => void = () => undefined;
      const started = new Promise<GeminiStart>((resolve) => {
        settleStart = resolve;
      });
      let startSettled = false;
      let badInARow = 0;
      let spawned = false;
      let finished = false;
      let stderrPending = "";
      let markExited: () => void = () => undefined;
      const exited = new Promise<void>((resolve) => {
        markExited = resolve;
      });

      function settle(outcome: GeminiStart): void {
        if (!startSettled) {
          startSettled = true;
          clearTimeout(listenTimer);
          settleStart(outcome);
        }
      }

      const current = {
        child,
        pending,
        exited,
        write(text: string): boolean {
          if (child.stdin.writableEnded || child.stdin.destroyed) {
            return false;
          }
          child.stdin.write(text);
          return true;
        },
        kill() {
          if (!finished) {
            child.kill();
          }
        },
      };
      bridge = current;

      // settle() reads this timer only from a later event, never before this line runs.
      const listenTimer = setTimeout(() => {
        log.write("start", "the bridge didn't say it was listening in time");
        settle({ ok: false, problem: "crash" });
        current.kill();
      }, listenTimeoutMs);

      function bad(problem: string, line: string): void {
        log.write("protocol", `${problem}: ${line.slice(0, loggedLineLength)}`);
        badInARow += 1;
        if (badInARow >= badLinesToFail) {
          current.kill();
        }
      }

      function handleLine(line: string): void {
        if (line === "") {
          return;
        }
        const parsed = parseGeminiLine(line);
        if (!parsed.ok) {
          bad(parsed.problem, line);
          return;
        }
        badInARow = 0;
        const message = parsed.line;
        if (message.type === "event") {
          if (message.event === "daemon") {
            const daemonState = message.data.state;
            if (daemonState === "listening") {
              state = "listening";
              settle({ ok: true });
            } else if (daemonState === "failed") {
              const portTaken = message.data.reason === "port_in_use";
              settle({ ok: false, problem: portTaken ? "port_in_use" : "crash" });
            }
          }
          if (message.event === "log") {
            log.write("event", JSON.stringify(message.data).slice(0, 2000));
          }
          for (const listener of listeners) {
            listener(message);
          }
          return;
        }
        const waiting = message.id === null ? undefined : pending.get(message.id);
        if (waiting === undefined) {
          log.write("unmatched", line.slice(0, loggedLineLength));
          return;
        }
        pending.delete(message.id ?? "");
        clearTimeout(waiting.timer);
        if (!message.ok) {
          waiting.resolve({ ok: false, error: message.error });
          return;
        }
        const result = readGeminiResult(waiting.method, message.result);
        if (result === null) {
          log.write("protocol", `bad result for ${waiting.method}`);
          waiting.resolve({
            ok: false,
            error: {
              code: "INTERNAL",
              message: "The bridge's answer didn't have the expected shape.",
              details: {},
            },
          });
          return;
        }
        waiting.resolve({ ok: true, result });
      }

      const stdout = readLines(child.stdout, {
        maxLength: maxGeminiLineLength,
        onLine: handleLine,
        onTooLong: (start) => {
          bad("too_long", start);
        },
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrPending += chunk;
        const cut = stderrPending.lastIndexOf("\n");
        if (cut >= 0) {
          log.write("stderr", stderrPending.slice(0, cut + 1));
          stderrPending = stderrPending.slice(cut + 1);
        }
      });
      child.stdin.on("error", () => undefined);

      function finish(note: string): void {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(listenTimer);
        for (const [, waiting] of pending) {
          clearTimeout(waiting.timer);
          waiting.resolve({ ok: false, error: notRunning() });
        }
        pending.clear();
        settle({ ok: false, problem: "crash" });
        log.write("exit", note);
        log.close();
        bridge = null;
        state = "stopped";
        markExited();
      }

      child.on("spawn", () => {
        spawned = true;
      });
      child.on("error", (error) => {
        if (spawned) {
          log.write("error", error.message);
          return;
        }
        log.write("spawn", error.message);
        finish("the process couldn't start");
      });
      child.on("close", (code, signal) => {
        if (stderrPending !== "") {
          log.write("stderr", stderrPending);
          stderrPending = "";
        }
        stdout.flush();
        finish(`code ${String(code)}${signal === null ? "" : ` signal ${signal}`}`);
      });

      return started;
    },

    call(method, params, options) {
      const current = bridge;
      if (current === null || state !== "listening") {
        return Promise.resolve({ ok: false, error: notRunning() });
      }
      const id = `r${String(nextId)}`;
      nextId += 1;
      // Built (and checked) first: params that break their schema throw here, which is main's bug.
      const line = geminiRequestLine(id, method, params);
      const timeoutMs = options?.timeoutMs ?? defaultTimeout(params);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          current.pending.delete(id);
          resolve({
            ok: false,
            error: {
              code: "TIMEOUT",
              message: "The Gemini bridge didn't answer in time.",
              details: { method, timeoutMs },
            },
          });
        }, timeoutMs);
        current.pending.set(id, {
          method,
          resolve: resolve as (answer: GeminiCall<TypedGeminiMethod>) => void,
          timer,
        });
        if (!current.write(line)) {
          clearTimeout(timer);
          current.pending.delete(id);
          resolve({ ok: false, error: notRunning() });
        }
      });
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    shutdown() {
      const current = bridge;
      if (current === null) {
        return Promise.resolve();
      }
      // End of input is the bridge's stop (DAEMON.md §1); a kill follows if it lingers.
      current.child.stdin.end();
      const timer = setTimeout(() => {
        current.kill();
      }, quitGraceMs);
      return current.exited.finally(() => {
        clearTimeout(timer);
      });
    },
  };
}
