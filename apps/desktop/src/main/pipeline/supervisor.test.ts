import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openPipelineLog } from "./logs";
import type { PipelineMessage, Start } from "./protocol";
import { findPython, pipelineEnv } from "./python-path";
import {
  createPipelineSupervisor,
  type ChildLike,
  type JobHandlers,
  type PipelineExit,
  type SpawnPipeline,
} from "./supervisor";

const key = "example-key-not-real";

function startMessage(dataDir: string, overrides: Partial<Start["job"]> = {}): Start {
  return {
    type: "start",
    protocol: 1,
    source: "example",
    dataDir,
    worker: "example",
    job: {
      kind: "search",
      keywords: ["claude code tutorial", "ai news this week"],
      startAt: 0,
      rules: {
        countries: ["US", "GB"],
        perKeyword: 200,
        sortBy: "relevance",
        resultsType: "video",
        autoClean: {
          enabled: true,
          minSubscribers: 50_000,
          maxSubscribers: 2_000_000,
          belowMin: "sweep",
          aboveMax: "delay",
          label: "irrelevant",
        },
      },
      ...overrides,
    },
    settings: {},
    secrets: {
      youtubeKey: key,
      proxyUrls: ["http://ai-user:proxy-pass-123@proxy.example:8080"],
      gatewayUrls: [],
    },
  };
}

class FakeChild extends EventEmitter implements ChildLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  written = "";
  killed = false;
  stdinEnded = false;

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.written += chunk;
    });
    this.stdin.on("end", () => {
      this.stdinEnded = true;
    });
  }

  send(message: object): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, signal));
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null, "SIGTERM");
    return true;
  }
}

const end = { type: "end", state: "done", at: 2, found: 9, kept: 5 } as const;

/** Lets stream events and the close event run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("the pipeline supervisor", () => {
  let folder: string;
  let child: FakeChild;
  let spawned: { command: string; args: readonly string[]; cwd: string; env: object }[];
  let messages: PipelineMessage[];
  let exits: PipelineExit[];
  let handlers: JobHandlers;

  const spawnFake: SpawnPipeline = (command, args, options) => {
    spawned.push({ command, args, cwd: options.cwd, env: options.env });
    child = new FakeChild();
    return child;
  };

  function supervisor(python = true) {
    return createPipelineSupervisor({
      spawn: spawnFake,
      python: () => (python ? { python: "C:\\repo\\py.exe", cwd: "C:\\repo\\pipeline" } : null),
      env: { SystemRoot: "C:\\Windows" },
      openLog: (secrets) => openPipelineLog({ folder, now: () => 0, secrets }),
    });
  }

  async function logText(): Promise<string> {
    const [file] = await readdir(folder);
    return file === undefined ? "" : readFile(join(folder, file), "utf8");
  }

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-pipeline-"));
    spawned = [];
    messages = [];
    exits = [];
    handlers = {
      onMessage: (message) => messages.push(message),
      onExit: (exit) => exits.push(exit),
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(folder, { recursive: true, force: true });
  });

  it("starts the module isolated and unbuffered, and writes the start line first", async () => {
    const pipeline = supervisor();
    expect(pipeline.start(startMessage("D:\\data"), handlers)).toEqual({ ok: true });
    await settle();

    expect(spawned).toEqual([
      {
        command: "C:\\repo\\py.exe",
        args: ["-I", "-u", "-m", "gratovo_pipeline"],
        cwd: "C:\\repo\\pipeline",
        env: { SystemRoot: "C:\\Windows" },
      },
    ]);
    const [first] = child.written.split("\n");
    expect(JSON.parse(first ?? "")).toMatchObject({ type: "start", secrets: { youtubeKey: key } });
    expect(pipeline.running).toBe(true);
  });

  it("passes each valid line on, even when it arrives in pieces", async () => {
    supervisor().start(startMessage("D:\\data"), handlers);
    const line = Buffer.from(
      `${JSON.stringify({ type: "log", level: "info", text: "Found 5 channel(s) \u{1F916}" })}\n`,
    );
    // Split inside the robot's four UTF-8 bytes.
    const cut = line.indexOf(0xf0) + 2;
    child.stdout.write(line.subarray(0, cut));
    child.stdout.write(line.subarray(cut));
    child.send({ type: "run", state: "running", total: 2, startAt: 0 });
    await settle();

    expect(messages).toEqual([
      { type: "log", level: "info", text: "Found 5 channel(s) \u{1F916}" },
      { type: "run", state: "running", total: 2, startAt: 0 },
    ]);
  });

  it("reports the end line once the process exits cleanly", async () => {
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    child.send(end);
    child.exit(0);
    await settle();

    expect(exits).toEqual([{ kind: "ended", end }]);
    expect(pipeline.running).toBe(false);
  });

  it.each([
    ["no end line", false, 0],
    ["an exit code other than 0", true, 1],
  ])("calls it a crash with %s", async (_name, sendEnd, code) => {
    supervisor().start(startMessage("D:\\data"), handlers);
    if (sendEnd) {
      child.send(end);
    }
    child.exit(code);
    await settle();

    expect(exits).toEqual([{ kind: "failed", reason: "crash" }]);
  });

  it("logs a bad line and ignores it; three in a row end the job", async () => {
    supervisor().start(startMessage("D:\\data"), handlers);
    child.stdout.write("not json\n");
    child.stdout.write(`${JSON.stringify({ type: "mystery" })}\n`);
    child.send({ type: "log", level: "info", text: "fine" }); // resets the count
    child.stdout.write("bad 1\nbad 2\n");
    await settle();
    expect(child.killed).toBe(false);

    child.stdout.write("bad 3\n");
    await settle();

    expect(child.killed).toBe(true);
    expect(exits).toEqual([{ kind: "failed", reason: "protocol" }]);
    expect(messages).toEqual([{ type: "log", level: "info", text: "fine" }]);
    expect(await logText()).toContain("not_json: not json");
  });

  it("counts an overlong line as one bad line and drops it whole", async () => {
    supervisor().start(startMessage("D:\\data"), handlers);
    child.stdout.write("x".repeat(70 * 1024));
    child.stdout.write(`yyy\n${JSON.stringify({ type: "log", level: "info", text: "after" })}\n`);
    await settle();

    expect(messages).toEqual([{ type: "log", level: "info", text: "after" }]);
    expect(await logText()).toContain("too_long");
  });

  it("asks the process to stop, and kills it 30 s later if it hasn't", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    pipeline.stop();
    await settle();
    expect(child.written.split("\n")[1]).toBe('{"type":"stop"}');

    vi.advanceTimersByTime(29_999);
    expect(child.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(child.killed).toBe(true);
    await settle();
    expect(exits).toEqual([{ kind: "failed", reason: "killed" }]);
  });

  it("doesn't kill a process that ended after the stop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    pipeline.stop();
    child.send({ ...end, state: "stopped", at: 1 });
    child.exit(0);
    await settle();
    vi.advanceTimersByTime(60_000);

    expect(child.killed).toBe(false);
    expect(exits).toEqual([{ kind: "ended", end: { ...end, state: "stopped", at: 1 } }]);
  });

  it("on quit, stops, closes stdin and kills after 5 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    let finished = false;
    void pipeline.shutdown().then(() => {
      finished = true;
    });
    await settle();
    expect(child.stdinEnded).toBe(true);

    vi.advanceTimersByTime(5_000);
    await settle();
    expect(child.killed).toBe(true);
    expect(finished).toBe(true);
  });

  it("runs one job at a time, and none without Python", async () => {
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    expect(pipeline.start(startMessage("D:\\data"), handlers)).toEqual({
      ok: false,
      problem: "running",
    });
    expect(supervisor(false).start(startMessage("D:\\data"), handlers)).toEqual({
      ok: false,
      problem: "no_python",
    });
    expect(spawned).toHaveLength(1);
    await expect(supervisor().shutdown()).resolves.toBeUndefined();
  });

  it("reports a process that couldn't start", async () => {
    const pipeline = supervisor();
    pipeline.start(startMessage("D:\\data"), handlers);
    child.emit("error", new Error("spawn ENOENT"));
    await settle();

    expect(exits).toEqual([{ kind: "failed", reason: "spawn" }]);
    expect(pipeline.running).toBe(false);
  });

  it("logs stderr and log events, with every secret of the job blanked out", async () => {
    supervisor().start(startMessage("D:\\data"), handlers);
    child.stderr.write(`Traceback: key ${key} via proxy-pass-123\n`);
    child.send({ type: "log", level: "warn", text: `retrying ${key}` });
    child.send(end);
    child.exit(0);
    await settle();

    const text = await logText();
    expect(text).toContain("stderr Traceback: key [secret] via [secret]");
    expect(text).toContain("warn retrying [secret]");
    expect(text).toContain("exit code 0");
    expect(text).not.toContain(key);
    expect(text).not.toContain("proxy-pass-123");
  });
});

describe("the real pipeline process", () => {
  const appPath = resolve(import.meta.dirname, "../../..");
  const python = findPython({ packaged: false, appPath, exists: existsSync });

  it.skipIf(python === null)(
    "runs a search on example data to the end",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "gratovo-pipeline-real-"));
      try {
        const messages: PipelineMessage[] = [];
        const exit = await new Promise<PipelineExit>((done) => {
          const pipeline = createPipelineSupervisor({
            spawn: (command, args, options) =>
              spawn(command, args, { ...options, stdio: "pipe", windowsHide: true }),
            python: () => python,
            env: pipelineEnv(process.env),
            openLog: (secrets) =>
              openPipelineLog({ folder: join(folder, "logs"), now: Date.now, secrets }),
          });
          const result = pipeline.start(
            startMessage(join(folder, "example-pipeline"), { keywords: ["ai agents explained"] }),
            { onMessage: (message) => messages.push(message), onExit: done },
          );
          expect(result).toEqual({ ok: true });
        });

        expect(exit).toMatchObject({ kind: "ended", end: { state: "done", at: 1 } });
        expect(messages[0]).toMatchObject({ type: "ready", protocol: 1 });
        expect(messages.some((m) => m.type === "channel" && m.outcome === "kept")).toBe(true);
        const [log] = await readdir(join(folder, "logs"));
        const text = await readFile(join(folder, "logs", log ?? ""), "utf8");
        expect(text).not.toContain(key);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
