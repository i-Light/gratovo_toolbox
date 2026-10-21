import type { Readable, Writable } from "node:stream";

import { secretsOf, type PipelineLog } from "./logs";
import {
  maxLineLength,
  parseLine,
  startLine,
  stopLine,
  type PipelineMessage,
  type Start,
} from "./protocol";
import type { PythonCommand } from "./python-path";

/**
 * Runs one pipeline job at a time (ADR 0013): spawns `python -I -u -m gratovo_pipeline`, writes the
 * start line (the only place the secrets go), reads the JSON lines it answers with, and stops it.
 *
 * Every line is checked against the protocol. One that fails is logged (its first 200 characters)
 * and ignored; three in a row end the job, since the two sides no longer agree. A stop asks first
 * and kills 30 s later; on quit it asks, closes stdin and kills 5 s later.
 */

export interface ChildLike {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "spawn", listener: () => void): this;
}

export type SpawnPipeline = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
) => ChildLike;

export type EndMessage = Extract<PipelineMessage, { type: "end" }>;

/** How a job finished: with its own end line, or not. */
export type PipelineExit =
  | { kind: "ended"; end: EndMessage }
  | { kind: "failed"; reason: "crash" | "protocol" | "killed" | "spawn" };

export interface JobHandlers {
  onMessage(message: PipelineMessage): void;
  /** Called once, after the last message. */
  onExit(exit: PipelineExit): void;
}

export interface PipelineSupervisor {
  readonly running: boolean;
  start(
    start: Start,
    handlers: JobHandlers,
  ): { ok: true } | { ok: false; problem: "running" | "no_python" };
  /** Asks the job to stop; kills it if it hasn't ended `stopGraceMs` later. */
  stop(): void;
  /** For app quit: stops the job and resolves once it is gone (killed after `quitGraceMs`). */
  shutdown(): Promise<void>;
}

export const stopGraceMs = 30_000;
export const quitGraceMs = 5_000;
const badLinesToFail = 3;
const loggedLineLength = 200;

export function createPipelineSupervisor(o: {
  spawn: SpawnPipeline;
  python: () => PythonCommand | null;
  env: Record<string, string>;
  openLog: (secrets: readonly string[]) => PipelineLog;
}): PipelineSupervisor {
  let job: {
    child: ChildLike;
    stopping: boolean;
    killTimer: ReturnType<typeof setTimeout> | null;
    killedByUs: boolean;
    exited: Promise<void>;
    kill(): void;
    stopWithin(ms: number): void;
  } | null = null;

  return {
    get running() {
      return job !== null;
    },

    start(start, handlers) {
      if (job !== null) {
        return { ok: false, problem: "running" };
      }
      const command = o.python();
      if (command === null) {
        return { ok: false, problem: "no_python" };
      }
      // Built (and checked) first: a message that fails its schema throws here, before a process
      // exists that would wait on stdin for it forever.
      const line = startLine(start);
      const log = o.openLog(secretsOf(start));
      const child = o.spawn(command.python, ["-I", "-u", "-m", "gratovo_pipeline"], {
        cwd: command.cwd,
        env: o.env,
      });

      let end: EndMessage | null = null;
      let badInARow = 0;
      let protocolFailed = false;
      let finished = false;
      let pending = "";
      let skipping = false;
      let stderrPending = "";
      let spawned = false;
      let markExited: () => void = () => undefined;
      const exited = new Promise<void>((resolve) => {
        markExited = resolve;
      });

      const current = {
        child,
        stopping: false,
        killTimer: null as ReturnType<typeof setTimeout> | null,
        killAt: Number.POSITIVE_INFINITY,
        killedByUs: false,
        exited,
        kill() {
          if (!finished) {
            current.killedByUs = true;
            child.kill();
          }
        },
        stopWithin(ms: number) {
          if (!current.stopping) {
            current.stopping = true;
            write(stopLine());
          }
          // A deadline only ever comes closer: asking again doesn't buy the process more time.
          const killAt = Date.now() + ms;
          if (killAt >= current.killAt) {
            return;
          }
          current.killAt = killAt;
          if (current.killTimer !== null) {
            clearTimeout(current.killTimer);
          }
          current.killTimer = setTimeout(() => {
            current.kill();
          }, ms);
        },
      };
      job = current;

      function write(text: string): void {
        if (!child.stdin.writableEnded && !child.stdin.destroyed) {
          child.stdin.write(text);
        }
      }

      function bad(problem: string, line: string): void {
        log.write("protocol", `${problem}: ${line.slice(0, loggedLineLength)}`);
        badInARow += 1;
        if (badInARow >= badLinesToFail && !protocolFailed) {
          protocolFailed = true;
          current.kill();
        }
      }

      function handleLine(line: string): void {
        if (protocolFailed || line === "") {
          return;
        }
        const parsed = parseLine(line);
        if (!parsed.ok) {
          bad(parsed.problem, line);
          return;
        }
        badInARow = 0;
        const message = parsed.message;
        if (message.type === "end") {
          end = message;
        } else if (message.type === "log") {
          log.write(message.level, message.text);
        }
        handlers.onMessage(message);
      }

      function finish(exit: PipelineExit, note: string): void {
        if (finished) {
          return;
        }
        finished = true;
        if (current.killTimer !== null) {
          clearTimeout(current.killTimer);
        }
        log.write("exit", note);
        log.close();
        job = null;
        markExited();
        handlers.onExit(exit);
      }

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        let rest = chunk;
        let newline = rest.indexOf("\n");
        while (newline >= 0) {
          const line = pending + rest.slice(0, newline);
          pending = "";
          rest = rest.slice(newline + 1);
          if (skipping) {
            skipping = false;
          } else {
            handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
          }
          newline = rest.indexOf("\n");
        }
        if (skipping) {
          return;
        }
        pending += rest;
        if (pending.length > maxLineLength) {
          // Dropped whole, not read in pieces: the rest of it arrives before the next newline.
          bad("too_long", pending);
          pending = "";
          skipping = true;
        }
      });
      child.stderr.setEncoding("utf8");
      // Whole lines only, so a secret split across two chunks is still blanked in the log.
      child.stderr.on("data", (chunk: string) => {
        stderrPending += chunk;
        const cut = stderrPending.lastIndexOf("\n");
        if (cut >= 0) {
          log.write("stderr", stderrPending.slice(0, cut + 1));
          stderrPending = stderrPending.slice(cut + 1);
        }
      });
      // A write after the process is gone fails with EPIPE; its exit is reported anyway.
      child.stdin.on("error", () => undefined);

      child.on("spawn", () => {
        spawned = true;
      });
      // Before `spawn` an error means it never started. After it (a kill that failed, say) the
      // process may still run: log it and wait for `close`, so no second job starts beside it.
      child.on("error", (error) => {
        if (spawned) {
          log.write("error", error.message);
          return;
        }
        log.write("spawn", error.message);
        finish({ kind: "failed", reason: "spawn" }, "the process couldn't start");
      });
      child.on("close", (code, signal) => {
        if (stderrPending !== "") {
          log.write("stderr", stderrPending);
          stderrPending = "";
        }
        if (pending !== "" && !skipping) {
          handleLine(pending);
        }
        const note = `code ${String(code)}${signal === null ? "" : ` signal ${signal}`}`;
        if (protocolFailed) {
          finish({ kind: "failed", reason: "protocol" }, note);
        } else if (end !== null && code === 0) {
          finish({ kind: "ended", end }, note);
        } else if (current.killedByUs) {
          finish({ kind: "failed", reason: "killed" }, note);
        } else {
          finish({ kind: "failed", reason: "crash" }, note);
        }
      });

      write(line);
      return { ok: true };
    },

    stop() {
      job?.stopWithin(stopGraceMs);
    },

    shutdown() {
      if (job === null) {
        return Promise.resolve();
      }
      const current = job;
      current.stopWithin(quitGraceMs);
      current.child.stdin.end();
      return current.exited;
    },
  };
}
