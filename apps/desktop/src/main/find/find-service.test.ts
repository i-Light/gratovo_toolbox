import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findStateSchema, type FindState } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineMessage, SearchJob, Start } from "../pipeline/protocol";
import type {
  JobHandlers,
  PipelineExit,
  PipelineSupervisor,
  EndMessage,
} from "../pipeline/supervisor";

import { createFindService, type FindMode, type FindService } from "./find-service";

const exampleKey = "example-key-not-real";
const proxy = "http://user:example-pass@proxy.example.com:8080";
const gateway = "https://abc123.execute-api.us-east-1.amazonaws.com/prod";

interface FakeSupervisor extends Omit<PipelineSupervisor, "running"> {
  running: boolean;
  starts: Start[];
  handlers: JobHandlers | null;
  stops: number;
  problem: "running" | "no_python" | null;
  send(message: PipelineMessage): void;
  finish(exit: PipelineExit): void;
}

function fakeSupervisor(): FakeSupervisor {
  const fake: FakeSupervisor = {
    starts: [],
    handlers: null,
    stops: 0,
    problem: null,
    running: false,
    start(start, handlers) {
      if (fake.problem !== null) {
        return { ok: false, problem: fake.problem };
      }
      fake.starts.push(start);
      fake.handlers = handlers;
      fake.running = true;
      return { ok: true };
    },
    stop() {
      fake.stops += 1;
    },
    shutdown() {
      fake.running = false;
      return Promise.resolve();
    },
    send(message) {
      fake.handlers?.onMessage(message);
    },
    finish(exit) {
      fake.running = false;
      fake.handlers?.onExit(exit);
    },
  };
  return fake;
}

const keyword = (
  index: number,
  state: "started" | "done" | "failed",
  extra: { found?: number; kept?: number } = {},
): PipelineMessage => ({
  type: "keyword",
  index,
  total: 3,
  keyword: ["ai agents", "local llm", "ai news"][index] ?? "x",
  state,
  ...extra,
});

const channel = (
  id: string,
  outcome: "kept" | "swept" | "delayed",
  keywordText = "ai agents",
): Extract<PipelineMessage, { type: "channel" }> => ({
  type: "channel",
  keyword: keywordText,
  channelId: id,
  handle: `@${id}`,
  name: `Channel ${id}`,
  subscribers: 90_000,
  medianViews: 12_000,
  country: "US",
  outcome,
});

const endLine = (over: Partial<EndMessage> = {}): EndMessage => ({
  type: "end",
  state: "done",
  at: 3,
  found: 0,
  kept: 0,
  ...over,
});

describe("the find service", () => {
  let userData: string;
  let supervisor: FakeSupervisor;
  let mode: FindMode | null;
  let key: () => Promise<string | null>;
  let secretValues: Record<string, string>;
  let clock: number;
  let emitted: FindState[];
  let service: FindService;

  function make(throttleMs?: number): FindService {
    return createFindService({
      supervisor,
      account: {
        findContext: () =>
          mode === null ? null : { mode, workerId: mode === "example" ? "example" : "user-1" },
        teamKeys: { youtubeKey: () => key() },
      },
      secrets: { get: (name) => Promise.resolve(secretValues[name]) },
      userData,
      emit: (state) => emitted.push(state),
      now: () => clock,
      ...(throttleMs === undefined ? {} : { throttleMs }),
    });
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), "gratovo-find-service-"));
    supervisor = fakeSupervisor();
    mode = "example";
    key = () => Promise.resolve(exampleKey);
    secretValues = {};
    clock = 1_000_000;
    emitted = [];
    service = make();
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(userData, { recursive: true, force: true });
  });

  async function started(words = ["ai agents", "local llm", "ai news"]): Promise<void> {
    service.add(words);
    expect(await service.start()).toEqual({ ok: true });
  }

  describe("the queue", () => {
    it("starts empty and ready, with the default rules", () => {
      const state = service.state();
      expect(state.queue).toEqual([]);
      expect(state.at).toBe(0);
      expect(state.run).toEqual({ state: "ready", found: 0, kept: 0, swept: 0, error: null });
      expect(state.rules.perKeyword).toBe(200);
    });

    it("adds trimmed keywords and skips blanks and repeats, in any case", () => {
      const result = service.add(["  AI Agents ", "ai agents", "", "   ", "Local LLM"]);
      expect(result).toEqual({ added: 2, skipped: 3 });
      expect(service.state().queue.map((q) => q.keyword)).toEqual(["AI Agents", "Local LLM"]);
      expect(service.add(["LOCAL llm", "ai news"])).toEqual({ added: 1, skipped: 1 });
    });

    it("stops adding at 500 entries", () => {
      const many = Array.from({ length: 498 }, (_, i) => `ai topic ${String(i)}`);
      service.add(many);
      expect(service.add(["one more", "two more", "three more"])).toEqual({
        added: 2,
        skipped: 1,
      });
      expect(service.state().queue).toHaveLength(500);
    });

    it("keeps the queue between service instances (the file)", () => {
      service.add(["ai agents", "ai news"]);
      service.startAt(1);
      const again = make();
      expect(again.state().queue.map((q) => q.keyword)).toEqual(["ai agents", "ai news"]);
      expect(again.state().at).toBe(1);
    });

    it("removes an entry, moving at back when it was before at", () => {
      service.add(["a one", "b two", "c three"]);
      service.startAt(2);
      expect(service.remove(0)).toEqual({ ok: true });
      expect(service.state().queue.map((q) => q.keyword)).toEqual(["b two", "c three"]);
      expect(service.state().at).toBe(1);
      expect(service.remove(1)).toEqual({ ok: true });
      expect(service.state().at).toBe(1);
    });

    it("treats a remove out of range as ok and changes nothing", () => {
      service.add(["a one"]);
      emitted = [];
      expect(service.remove(40)).toEqual({ ok: true });
      expect(service.state().queue).toHaveLength(1);
      expect(emitted).toHaveLength(0);
    });

    it("clamps start-at to the queue length", () => {
      service.add(["a one", "b two"]);
      expect(service.startAt(400)).toEqual({ ok: true });
      expect(service.state().at).toBe(2);
    });

    it("refuses remove and start-at while running, but allows add", async () => {
      await started();
      expect(service.remove(0)).toEqual({ ok: false, problem: "running" });
      expect(service.startAt(0)).toEqual({ ok: false, problem: "running" });
      expect(service.add(["ai video tools"])).toEqual({ added: 1, skipped: 0 });
      expect(service.state().queue).toHaveLength(4);
      // The running job kept its own list.
      expect((supervisor.starts[0]?.job as SearchJob | undefined)?.keywords).toHaveLength(3);
    });

    it("emits at once after each user action", () => {
      service.add(["a one"]);
      service.startAt(0);
      service.remove(0);
      expect(emitted).toHaveLength(3);
    });

    it("throws when no data is open", async () => {
      mode = null;
      expect(() => service.state()).toThrow("No data is open.");
      expect(() => service.add(["a one"])).toThrow("No data is open.");
      expect(() => service.remove(0)).toThrow("No data is open.");
      expect(() => service.startAt(0)).toThrow("No data is open.");
      await expect(service.start()).rejects.toThrow("No data is open.");
    });

    it("keeps example and live data apart, and follows a change of mode", () => {
      service.add(["example only"]);
      mode = "live";
      expect(service.state().queue).toEqual([]);
      service.add(["live only"]);
      mode = "example";
      expect(service.state().queue.map((q) => q.keyword)).toEqual(["example only"]);
      expect(readFileSync(join(userData, "pipeline", "find.json"), "utf8")).toContain("live only");
    });
  });

  describe("start", () => {
    it("answers no_keywords for an empty queue or an at past the end", async () => {
      expect(await service.start()).toEqual({ ok: false, problem: "no_keywords" });
      service.add(["a one"]);
      service.startAt(1);
      expect(await service.start()).toEqual({ ok: false, problem: "no_keywords" });
    });

    it("answers running when the supervisor runs", async () => {
      service.add(["a one"]);
      supervisor.running = true;
      expect(await service.start()).toEqual({ ok: false, problem: "running" });
    });

    it("answers no_python from the supervisor", async () => {
      service.add(["a one"]);
      supervisor.problem = "no_python";
      expect(await service.start()).toEqual({ ok: false, problem: "no_python" });
      expect(service.state().run.state).toBe("ready");
    });

    it("answers no_youtube_key live without a key, or when the lookup throws", async () => {
      mode = "live";
      service.add(["a one"]);
      key = () => Promise.resolve(null);
      expect(await service.start()).toEqual({ ok: false, problem: "no_youtube_key" });
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      key = () => Promise.reject(new Error(`lookup failed for ${exampleKey}`));
      expect(await service.start()).toEqual({ ok: false, problem: "no_youtube_key" });
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain(exampleKey);
      log.mockRestore();
      expect(supervisor.starts).toHaveLength(0);
    });

    it("sends the example start message with a null key", async () => {
      await started();
      const folder = join(userData, "example-pipeline");
      expect(supervisor.starts[0]).toMatchObject({
        type: "start",
        protocol: 1,
        source: "example",
        dataDir: folder,
        worker: "example",
        job: { kind: "search", keywords: ["ai agents", "local llm", "ai news"], startAt: 0 },
        settings: {},
        secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
      });
      expect((supervisor.starts[0]?.job as SearchJob | undefined)?.rules.perKeyword).toBe(200);
    });

    it("sends the live key, the user id, and the proxies and gateways from the secret store", async () => {
      mode = "live";
      secretValues = {
        "pipeline.proxies": JSON.stringify([proxy]),
        "pipeline.gateways": JSON.stringify([gateway]),
      };
      service.add(["ai agents", "local llm"]);
      service.startAt(1);
      expect(await service.start()).toEqual({ ok: true });
      expect(supervisor.starts[0]).toMatchObject({
        source: "live",
        worker: "user-1",
        dataDir: join(userData, "pipeline"),
        job: { startAt: 1 },
        secrets: { youtubeKey: exampleKey, proxyUrls: [proxy], gatewayUrls: [gateway] },
      });
    });

    it("treats a missing or malformed proxy list as none", async () => {
      secretValues = { "pipeline.proxies": "{not json", "pipeline.gateways": '["ok", 5]' };
      await started(["a one"]);
      expect(supervisor.starts[0]?.secrets).toMatchObject({ proxyUrls: [], gatewayUrls: [] });
    });

    it("sets the run to running, clears the log and emits", async () => {
      await started();
      supervisor.send({ type: "log", level: "info", text: "hello" });
      supervisor.finish({ kind: "ended", end: endLine() });
      expect(service.state().log).toHaveLength(1);
      service.startAt(0);
      expect(await service.start()).toEqual({ ok: true });
      expect(service.state().log).toEqual([]);
      expect(service.state().run).toEqual({
        state: "running",
        found: 0,
        kept: 0,
        swept: 0,
        error: null,
      });
      expect(emitted.at(-1)?.run.state).toBe("running");
    });
  });

  describe("messages", () => {
    beforeEach(async () => {
      service = make(0);
      await started();
    });

    it("marks a keyword running, then done with its counts, moving at on and saving", () => {
      supervisor.send(keyword(0, "started"));
      expect(service.state().queue[0]?.state).toBe("running");
      supervisor.send(keyword(0, "done", { found: 12, kept: 4 }));
      const state = service.state();
      expect(state.queue[0]).toEqual({ keyword: "ai agents", state: "done", found: 12, kept: 4 });
      expect(state.at).toBe(1);
      expect(state.run.found).toBe(12);
      expect(readFileSync(join(userData, "example-pipeline", "find.json"), "utf8")).toContain(
        '"at": 1',
      );
    });

    it("marks a failed keyword", () => {
      supervisor.send(keyword(1, "failed"));
      expect(service.state().queue[1]?.state).toBe("failed");
    });

    it("counts kept and swept channels and prepends the kept ones, capped at 100", () => {
      supervisor.send(channel("UC_one", "kept"));
      supervisor.send(channel("UC_two", "swept"));
      supervisor.send(channel("UC_three", "delayed"));
      supervisor.send(channel("UC_four", "kept"));
      const state = service.state();
      expect(state.run).toMatchObject({ kept: 2, swept: 1 });
      expect(state.kept.map((c) => c.channelId)).toEqual(["UC_four", "UC_one"]);
      for (let i = 0; i < 120; i += 1) {
        supervisor.send(channel(`UC_x${String(i)}`, "kept"));
      }
      expect(service.state().kept).toHaveLength(100);
      expect(service.state().kept[0]?.channelId).toBe("UC_x119");
    });

    it("appends log lines with the time, keeping the newest 200", () => {
      clock = 5_000;
      supervisor.send({ type: "log", level: "warn", text: "slow" });
      expect(service.state().log).toEqual([{ at: 5_000, level: "warn", text: "slow" }]);
      for (let i = 0; i < 210; i += 1) {
        supervisor.send({ type: "log", level: "info", text: `line ${String(i)}` });
      }
      const log = service.state().log;
      expect(log).toHaveLength(200);
      expect(log[0]?.text).toBe("line 10");
      expect(log.at(-1)?.text).toBe("line 209");
    });

    it("ignores ready and run messages", () => {
      const before = emitted.length;
      supervisor.send({ type: "ready", protocol: 1, version: "0.1.0" });
      supervisor.send({ type: "run", state: "running", total: 3, startAt: 0 });
      expect(emitted).toHaveLength(before);
    });
  });

  describe("exits", () => {
    beforeEach(async () => {
      await started();
      supervisor.send(keyword(0, "started"));
    });

    it("done: takes at from the end line and puts running entries back to queued", () => {
      supervisor.finish({ kind: "ended", end: endLine({ state: "done", at: 3 }) });
      const state = service.state();
      expect(state.run).toMatchObject({ state: "done", error: null });
      expect(state.at).toBe(3);
      expect(state.queue[0]?.state).toBe("queued");
    });

    it("stopped: paused", () => {
      supervisor.finish({ kind: "ended", end: endLine({ state: "stopped", at: 1 }) });
      expect(service.state().run).toMatchObject({ state: "paused", error: null });
      expect(service.state().at).toBe(1);
    });

    it.each([
      ["quota", "quota"],
      ["blocked", "blocked"],
      ["network", "network"],
      ["no_youtube_key", "no_youtube_key"],
      ["bad_start", "crash"],
      ["crash", "crash"],
    ] as const)("failed with %s: the error code is %s, never Python's text", (code, expected) => {
      supervisor.finish({
        kind: "ended",
        end: endLine({
          state: "failed",
          at: 0,
          error: { code, message: "Traceback: secret detail" },
        }),
      });
      expect(service.state().run).toMatchObject({ state: "failed", error: expected });
      expect(JSON.stringify(service.state())).not.toContain("Traceback");
    });

    it("killed after a stop: paused", () => {
      service.stop();
      expect(service.state().run.state).toBe("stopping");
      expect(supervisor.stops).toBe(1);
      supervisor.finish({ kind: "failed", reason: "killed" });
      expect(service.state().run).toMatchObject({ state: "paused", error: null });
    });

    it.each(["crash", "protocol", "spawn", "killed"] as const)(
      "failed exit %s without a stop: failed, crash",
      (reason) => {
        supervisor.finish({ kind: "failed", reason });
        expect(service.state().run).toMatchObject({ state: "failed", error: "crash" });
      },
    );

    it("re-reads the kept list from pipeline.db after the exit", () => {
      supervisor.send(channel("UC_live", "kept"));
      expect(service.state().kept.map((c) => c.channelId)).toEqual(["UC_live"]);
      supervisor.finish({ kind: "ended", end: endLine() });
      // There is no pipeline.db in this folder, so the list is what the database holds: none.
      expect(service.state().kept).toEqual([]);
    });

    it("emits when the run ends", () => {
      emitted = [];
      supervisor.finish({ kind: "ended", end: endLine() });
      expect(emitted.at(-1)?.run.state).toBe("done");
    });
  });

  describe("stop and shutdown", () => {
    it("does nothing when nothing runs", () => {
      service.stop();
      expect(supervisor.stops).toBe(0);
    });

    it("shutdown awaits the supervisor", async () => {
      await started();
      const shutdown = vi.spyOn(supervisor, "shutdown");
      await service.shutdown();
      expect(shutdown).toHaveBeenCalledOnce();
    });
  });

  describe("the throttle", () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      service = make(250);
      await started();
    });

    it("emits a streamed change at most once per throttle window, the trailing one newest", () => {
      // Start emitted at the current time; the next streamed change must wait.
      emitted = [];
      supervisor.send(channel("UC_a", "kept"));
      supervisor.send(channel("UC_b", "kept"));
      supervisor.send(channel("UC_c", "kept"));
      expect(emitted).toHaveLength(0);
      clock += 250;
      vi.advanceTimersByTime(250);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.kept.map((c) => c.channelId)).toEqual(["UC_c", "UC_b", "UC_a"]);
    });

    it("emits at once when the window has passed", () => {
      emitted = [];
      clock += 300;
      supervisor.send(channel("UC_a", "kept"));
      expect(emitted).toHaveLength(1);
    });

    it("emits user actions at once, even inside the window", () => {
      emitted = [];
      service.add(["ai video tools"]);
      expect(emitted).toHaveLength(1);
    });
  });

  describe("races and limits (review of 3e-1)", () => {
    /** A key lookup that answers only when the test says so. */
    function slowKey(): () => void {
      let answer: (value: string) => void = () => undefined;
      key = () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        });
      return () => {
        answer(exampleKey);
      };
    }

    it("refuses queue edits while a start awaits its key, and starts nothing it can't", async () => {
      mode = "live";
      service = make(0);
      service.add(["ai agents"]);
      const answer = slowKey();
      const starting = service.start();
      expect(service.remove(0)).toEqual({ ok: false, problem: "running" });
      expect(service.startAt(1)).toEqual({ ok: false, problem: "running" });
      answer();
      expect(await starting).toEqual({ ok: true });
      expect((supervisor.starts[0]?.job as SearchJob | undefined)?.keywords).toEqual(["ai agents"]);
    });

    it("doesn't start a live search after a sign-out during the key lookup", async () => {
      mode = "live";
      service = make(0);
      service.add(["ai agents"]);
      const answer = slowKey();
      const starting = service.start();
      await service.shutdown();
      mode = null;
      answer();
      expect(await starting).toEqual({ ok: false, problem: "running" });
      expect(supervisor.starts).toEqual([]);
    });

    it("keeps `at` on the first unfinished keyword when they finish out of order", async () => {
      service = make(0);
      await started();
      supervisor.send(keyword(0, "started"));
      supervisor.send(keyword(1, "started"));
      supervisor.send(keyword(1, "done", { found: 2, kept: 1 }));
      expect(service.state().at).toBe(0);
      supervisor.send(keyword(0, "done", { found: 3, kept: 1 }));
      expect(service.state().at).toBe(2);
      // Killed with no end line: the resume starts at the first keyword not done.
      supervisor.finish({ kind: "failed", reason: "crash" });
      expect(service.state().at).toBe(2);
    });

    it("cuts a long handle and a blanked log line to the page's limits", async () => {
      service = make(0);
      await started();
      supervisor.send({ ...channel("UC_a", "kept"), handle: `@${"%E3%81%82".repeat(32)}` });
      supervisor.send({ type: "log", level: "info", text: "x".repeat(500) });
      const state = service.state();
      expect(state.kept[0]?.handle).toHaveLength(200);
      expect(findStateSchema.safeParse(state).success).toBe(true);
    });
  });

  describe("secrets", () => {
    it("never puts the key or a proxy in the state, an event or the file", async () => {
      mode = "live";
      secretValues = {
        "pipeline.proxies": JSON.stringify([proxy]),
        "pipeline.gateways": JSON.stringify([gateway]),
      };
      service = make(0);
      await started();
      supervisor.send(keyword(0, "started"));
      supervisor.send(channel("UC_a", "kept"));
      supervisor.send(keyword(0, "done", { found: 3, kept: 1 }));
      supervisor.finish({ kind: "ended", end: endLine() });
      const everything = JSON.stringify([
        service.state(),
        emitted,
        readFileSync(join(userData, "pipeline", "find.json"), "utf8"),
      ]);
      for (const secret of [exampleKey, "example-pass", "proxy.example.com", "abc123"]) {
        expect(everything).not.toContain(secret);
      }
    });

    it("blanks the job's secrets in log lines before they reach the page", async () => {
      mode = "live";
      secretValues = { "pipeline.proxies": JSON.stringify([proxy]) };
      service = make(0);
      await started();
      supervisor.send({
        type: "log",
        level: "warn",
        text: `retrying with ${exampleKey} via example-pass`,
      });

      expect(service.state().log.at(-1)?.text).toBe("retrying with [secret] via [secret]");
    });
  });
});
