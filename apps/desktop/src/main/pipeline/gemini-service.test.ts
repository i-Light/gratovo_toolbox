import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeminiEvent } from "./gemini-protocol";
import {
  bridgeArgs,
  bridgeTokenEnv,
  callTimeoutMs,
  promptGapS,
  createGeminiService,
  listenTimeoutMs,
  newBridgeToken,
  type GeminiService,
  type GeminiStartOptions,
} from "./gemini-service";
import { openPipelineLog } from "./logs";
import { findPython, pipelineEnv } from "./python-path";
import type { ChildLike, SpawnPipeline } from "./supervisor";

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

  requests(): { id: string; method: string; params: Record<string, unknown> }[] {
    return this.written
      .split("\n")
      .filter((line) => line !== "")
      .map(
        (line) =>
          JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> },
      );
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

/** A port nothing on this computer listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const options: GeminiStartOptions = {
  dataDir: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\pipeline",
  profileDir: "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\gemini-profile",
  extensionDir: "C:\\repo\\services\\gemini-extension",
};

const listening = {
  type: "event",
  event: "daemon",
  data: { state: "listening", port: 8765, pid: 4321, version: "0.2.0" },
};

describe("the Gemini bridge service", () => {
  let folder: string;
  let child: FakeChild;
  let spawned: {
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
  }[];

  const spawnFake: SpawnPipeline = (command, args, o) => {
    spawned.push({ command, args, cwd: o.cwd, env: o.env });
    child = new FakeChild();
    return child;
  };

  function service(python = true, token?: () => string): GeminiService {
    return createGeminiService({
      spawn: spawnFake,
      python: () => (python ? { python: "C:\\repo\\py.exe", cwd: "C:\\repo\\pipeline" } : null),
      env: { SystemRoot: "C:\\Windows" },
      openLog: (secrets) => openPipelineLog({ folder, now: () => 0, secrets, kind: "gemini" }),
      ...(token === undefined ? {} : { token }),
    });
  }

  async function started(bridge = service()): Promise<GeminiService> {
    const start = bridge.start(options);
    await settle();
    child.send(listening);
    expect(await start).toEqual({ ok: true });
    return bridge;
  }

  async function logText(): Promise<string> {
    const [file] = await readdir(folder);
    return file === undefined ? "" : readFile(join(folder, file), "utf8");
  }

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-gemini-"));
    spawned = [];
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(folder, { recursive: true, force: true });
  });

  it("starts the bridge module with its folders as arguments and the bare environment", async () => {
    const bridge = await started(service(true, () => "ab".repeat(32)));
    expect(bridge.state).toBe("listening");
    expect(spawned).toEqual([
      {
        command: "C:\\repo\\py.exe",
        args: bridgeArgs(options),
        cwd: "C:\\repo\\pipeline",
        // The bare environment gains just the per-launch token (plan D13).
        env: { SystemRoot: "C:\\Windows", [bridgeTokenEnv]: "ab".repeat(32) },
      },
    ]);
    expect(spawned[0]?.args.slice(0, 4)).toEqual(["-I", "-u", "-m", "gratovo_pipeline.gemini"]);
    expect(spawned[0]?.args).toContain("8765");
    expect(spawned[0]?.args).not.toContain("--course-dir");
  });

  it("gives each start a fresh token, in the environment only, and never logs it", async () => {
    const first = await started();
    child.stderr.write(`echo ${spawned[0]?.env[bridgeTokenEnv] ?? ""}\n`);
    await settle();
    const gone = first.shutdown();
    child.exit(0);
    await gone;
    await started();
    const tokens = spawned.map((s) => s.env[bridgeTokenEnv] ?? "");
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(tokens[0]).not.toBe(tokens[1]);
    const logged = (
      await Promise.all((await readdir(folder)).map((file) => readFile(join(folder, file), "utf8")))
    ).join("");
    expect(logged).toContain("echo ");
    for (const [i, token] of tokens.entries()) {
      expect(spawned[i]?.args.join(" ")).not.toContain(token);
      expect(logged).not.toContain(token);
    }
  });

  it("tells its exit listeners each time the bridge ends, until they unsubscribe", async () => {
    const bridge = await started();
    let exits = 0;
    const off = bridge.onExit(() => {
      exits += 1;
    });
    child.exit(1);
    await settle();
    expect(exits).toBe(1);
    off();
    await started(bridge);
    child.exit(0);
    await settle();
    expect(exits).toBe(1);
  });

  it("makes tokens of 32 random bytes", () => {
    const token = newBridgeToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(newBridgeToken()).not.toBe(token);
  });

  it("passes the course folders only when this computer has them", () => {
    const args = bridgeArgs({ ...options, courseDir: "D:\\course", videoDir: "D:\\videos" });
    expect(args.slice(-4)).toEqual(["--course-dir", "D:\\course", "--video-dir", "D:\\videos"]);
  });

  it("runs one bridge at a time and needs Python", async () => {
    const bridge = await started();
    expect(await bridge.start(options)).toEqual({ ok: false, problem: "running" });
    expect(await service(false).start(options)).toEqual({ ok: false, problem: "no_python" });
  });

  it("reports a taken port", async () => {
    const bridge = service();
    const start = bridge.start(options);
    await settle();
    child.send({
      type: "event",
      event: "daemon",
      data: { state: "failed", reason: "port_in_use", port: 8765 },
    });
    child.exit(2);
    expect(await start).toEqual({ ok: false, problem: "port_in_use" });
    await settle();
    expect(bridge.state).toBe("stopped");
  });

  it("gives up on a bridge that never says it is listening", async () => {
    vi.useFakeTimers();
    const bridge = service();
    const start = bridge.start(options);
    vi.advanceTimersByTime(listenTimeoutMs);
    expect(await start).toEqual({ ok: false, problem: "crash" });
    expect(child.killed).toBe(true);
  });

  it("matches answers to their requests, in any order", async () => {
    const bridge = await started();
    const status = bridge.call("bridge.status", {});
    const shutdown = bridge.call("bridge.shutdown", {});
    await settle();
    const [first, second] = child.requests();
    expect(first).toMatchObject({ method: "bridge.status", params: {} });
    child.send({ type: "response", id: second?.id, ok: true, result: { ok: true } });
    child.send({
      type: "response",
      id: first?.id,
      ok: true,
      result: {
        listening: true,
        port: 8765,
        extensionConnected: false,
        hello: null,
        status: null,
      },
    });
    expect(await shutdown).toEqual({ ok: true, result: { ok: true } });
    expect(await status).toMatchObject({ ok: true, result: { extensionConnected: false } });
  });

  it("hands back the bridge's error as it is", async () => {
    const bridge = await started();
    const call = bridge.call("action.generate_keywords", { topic: "AI coding tools", count: 20 });
    await settle();
    const [request] = child.requests();
    child.send({
      type: "response",
      id: request?.id,
      ok: false,
      error: { code: "EXTENSION_NOT_CONNECTED", message: "no extension", details: { port: 8765 } },
    });
    expect(await call).toEqual({
      ok: false,
      error: { code: "EXTENSION_NOT_CONNECTED", message: "no extension", details: { port: 8765 } },
    });
  });

  it("turns a result of the wrong shape into an error, never a bad value", async () => {
    const bridge = await started();
    const call = bridge.call("action.classify_channel", {
      channel: { handle: "@aitoolsweekly" },
      niche: "AI tools",
    });
    await settle();
    const [request] = child.requests();
    child.send({ type: "response", id: request?.id, ok: true, result: { brandFit: 11 } });
    expect(await call).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });

  it("times out a call after its own timeout plus a margin, and ignores the late answer", async () => {
    // Only timeouts are faked: the streams still run on real setImmediate.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bridge = await started();
    let answered = false;
    const call = bridge.call("bridge.ask", { prompt: "Five AI news keywords", timeoutS: 10 });
    void call.then(() => {
      answered = true;
    });
    await settle();
    const [request] = child.requests();
    // 10 s, the bridge's 60 s gap before the prompt, and the 30 s margin
    vi.advanceTimersByTime(99_999);
    await settle();
    expect(answered).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await call).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
    child.send({ type: "response", id: request?.id, ok: true, result: { ok: true } });
    await settle();
    expect(await logText()).toContain("unmatched");
  });

  it("refuses params a method doesn't take before anything is written", async () => {
    const bridge = await started();
    expect(() => bridge.call("bridge.status", { extra: 1 } as never)).toThrow();
    expect(child.written).toBe("");
  });

  it("forwards events to its listeners until they unsubscribe", async () => {
    const bridge = await started();
    const seen: GeminiEvent[] = [];
    const stop = bridge.onEvent((event) => seen.push(event));
    const progress = {
      type: "event",
      event: "progress",
      data: { action: "generate_keywords", done: 1, total: 2, message: "chat 1 of 2 done" },
    };
    child.send(progress);
    await settle();
    stop();
    child.send(progress);
    await settle();
    expect(seen).toEqual([progress]);
  });

  it("answers calls with NOT_RUNNING when stopped or when the bridge dies mid-call", async () => {
    const idle = service();
    expect(await idle.call("bridge.status", {})).toMatchObject({
      ok: false,
      error: { code: "NOT_RUNNING" },
    });

    const bridge = await started();
    const call = bridge.call("bridge.status", {});
    await settle();
    child.exit(1);
    expect(await call).toMatchObject({ ok: false, error: { code: "NOT_RUNNING" } });
    expect(bridge.state).toBe("stopped");
  });

  it("logs lines that break the protocol, and ends the bridge after three in a row", async () => {
    const bridge = await started();
    child.stdout.write("listening on 8765\n");
    child.send({ type: "response", id: "x", ok: "yes" });
    child.send({ type: "event", event: "secret", data: {} });
    await settle();
    expect(child.killed).toBe(true);
    expect(bridge.state).toBe("stopped");
    const text = await logText();
    expect(text).toContain("protocol not_json: listening on 8765");
    expect(text).toContain("protocol bad_message");
  });

  it("stops by closing stdin, and kills a bridge that lingers", async () => {
    const bridge = await started();
    const gone = bridge.shutdown();
    await settle();
    expect(child.stdinEnded).toBe(true);
    child.exit(0);
    await gone;
    expect(child.killed).toBe(false);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const second = await started();
    const lingering = second.shutdown();
    await settle();
    expect(child.killed).toBe(false);
    vi.advanceTimersByTime(5_000);
    await lingering;
    expect(child.killed).toBe(true);
  });
});

describe("how long main waits for the bridge", () => {
  it("waits the bridge's own default for a method, plus 30 s", () => {
    expect(callTimeoutMs("bridge.ask", { prompt: "AI news keywords" })).toBe(
      (240 + promptGapS) * 1000 + 30_000,
    );
    expect(callTimeoutMs("action.gem_read", { gem: "abc" })).toBe(120_000);
    expect(callTimeoutMs("bridge.status", {})).toBe(30_000);
  });

  it("takes the call's own timeoutS when it names one", () => {
    expect(callTimeoutMs("bridge.ask", { prompt: "AI news keywords", timeoutS: 10 })).toBe(
      (10 + promptGapS) * 1000 + 30_000,
    );
  });

  it("gives a keyword batch its time once per chat", () => {
    expect(callTimeoutMs("action.generate_keywords", { topic: "AI agents", chats: 4 })).toBe(
      ((240 + promptGapS) * 4 + 60) * 1000 + 30_000,
    );
  });

  it("reads a draft's timeoutS inside its request and leaves room for the subtitles", () => {
    const params = { request: { kind: "first", channelId: "UCabc", timeoutS: 100 } };
    expect(callTimeoutMs("action.comms_propose", params)).toBe(
      (100 * 3 + 660 + 360) * 1000 + 30_000,
    );
    expect(callTimeoutMs("action.comms_propose", { request: { kind: "reply" } })).toBe(
      (300 * 3 + 660 + 360) * 1000 + 30_000,
    );
  });

  it("gives every prompt a call may send the bridge's 60 s gap first", () => {
    expect(promptGapS).toBe(60);
    const draft = callTimeoutMs("action.comms_propose", { request: { kind: "first" } });
    expect(draft - ((300 * 3 + 660) * 1000 + 30_000)).toBe(6 * 60_000);
    const classify = callTimeoutMs("action.classify_channel", { channel: {}, niche: "AI tools" });
    expect(classify).toBe((240 + 60) * 1000 + 30_000);
    // the gem and skill pages send no prompt, so they get no gap
    expect(callTimeoutMs("action.gem_create", { name: "AI news" })).toBe(210_000);
    expect(callTimeoutMs("action.skill_deploy", { folder: "C:/skills/x" })).toBe(630_000);
  });
});

describe("the real Gemini bridge", () => {
  const appPath = resolve(import.meta.dirname, "../../..");
  const python = findPython({ packaged: false, appPath, exists: existsSync });

  it.skipIf(python === null)(
    "starts, answers its status and browser info without an extension, and stops",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "gratovo-gemini-real-"));
      const bridge = createGeminiService({
        spawn: (command, args, o) =>
          spawn(command, args, { ...o, stdio: "pipe", windowsHide: true }),
        python: () => python,
        env: pipelineEnv(process.env),
        openLog: () =>
          openPipelineLog({
            folder: join(folder, "logs"),
            now: Date.now,
            secrets: [],
            kind: "gemini",
          }),
      });
      try {
        // A free port, never 8765: a real bridge (or the owner's browser add-on) may be there.
        const port = await freePort();
        const start = await bridge.start({
          port,
          dataDir: join(folder, "example-pipeline"),
          profileDir: join(folder, "gemini-profile"),
          extensionDir: join(folder, "no-extension-yet"),
        });
        expect(start).toEqual({ ok: true });
        expect(await bridge.call("bridge.status", {})).toMatchObject({
          ok: true,
          result: { listening: true, port, extensionConnected: false },
        });
        expect(await bridge.call("bridge.browser_info", {})).toMatchObject({
          ok: true,
          result: { addon: { state: "missing" } },
        });
      } finally {
        await bridge.shutdown();
        await rm(folder, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
