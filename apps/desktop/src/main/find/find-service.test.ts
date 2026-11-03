import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CreatorState } from "@gratovo/core/data";
import { findStateSchema, type FindState } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineMessage, SearchJob, Start } from "../pipeline/protocol";
import type {
  JobHandlers,
  PipelineExit,
  PipelineSupervisor,
  EndMessage,
} from "../pipeline/supervisor";

import { failureLimit } from "@gratovo/ipc";
import { readPipelineFacts } from "../insights/pipeline-facts";
import { createFindService, type FindMode, type FindService } from "./find-service";

// The real reads, counted: the scorer must not read pipeline.db's facts on each emit.
vi.mock("../insights/pipeline-facts", { spy: true });
const factsReads = vi.mocked(readPipelineFacts);

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
  state: "started" | "done" | "incomplete" | "failed",
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
  const queueRows = (): FindState["queue"]["current"] =>
    service.keywords({ offset: 0, limit: 100, filter: "all" }).rows;
  let settings: (() => Start["settings"]) | undefined;

  function make(throttleMs?: number): FindService {
    return createFindService({
      supervisor,
      account: {
        findContext: () =>
          mode === null
            ? null
            : mode === "example"
              ? { mode, workerId: "example", folder: "example-pipeline" }
              : { mode, workerId: "user-1", folder: "pipeline" },
        teamKeys: { youtubeKey: () => key() },
      },
      secrets: { get: (name) => Promise.resolve(secretValues[name]) },
      userData,
      ...(settings === undefined ? {} : { settings }),
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
    settings = undefined;
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
      expect(state.queue.total).toBe(0);
      expect(state.at).toBe(0);
      expect(state.run).toEqual({
        state: "ready",
        found: 0,
        kept: 0,
        swept: 0,
        error: null,
        wait: null,
      });
      expect(state.rules.perKeyword).toBe(200);
    });

    it("adds trimmed keywords and skips blanks and repeats, in any case", () => {
      const result = service.add(["  AI Agents ", "ai agents", "", "   ", "Local LLM"]);
      expect(result).toEqual({ added: 2, skipped: 3 });
      expect(queueRows().map((q) => q.keyword)).toEqual(["AI Agents", "Local LLM"]);
      expect(service.add(["LOCAL llm", "ai news"])).toEqual({ added: 1, skipped: 1 });
    });

    it("stops adding at 10,000 entries", () => {
      const many = Array.from({ length: 9998 }, (_, i) => `ai topic ${String(i)}`);
      service.add(many);
      expect(service.add(["one more", "two more", "three more"])).toEqual({
        added: 2,
        skipped: 1,
      });
      expect(service.state().queue.total).toBe(10_000);
    });

    it("keeps the queue between service instances (the file)", () => {
      service.add(["ai agents", "ai news"]);
      service.startAt(1);
      const again = make();
      expect(
        again.keywords({ offset: 0, limit: 100, filter: "all" }).rows.map((q) => q.keyword),
      ).toEqual(["ai agents", "ai news"]);
      expect(again.state().at).toBe(1);
    });

    it("removes an entry, moving at back when it was before at", () => {
      service.add(["a one", "b two", "c three"]);
      service.startAt(2);
      expect(service.remove(0)).toEqual({ ok: true });
      expect(queueRows().map((q) => q.keyword)).toEqual(["b two", "c three"]);
      expect(service.state().at).toBe(1);
      expect(service.remove(1)).toEqual({ ok: true });
      expect(service.state().at).toBe(1);
    });

    it("treats a remove out of range as ok and changes nothing", () => {
      service.add(["a one"]);
      emitted = [];
      expect(service.remove(40)).toEqual({ ok: true });
      expect(service.state().queue.total).toBe(1);
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
      expect(service.state().queue.total).toBe(4);
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
      expect(service.state().queue.total).toBe(0);
      service.add(["live only"]);
      mode = "example";
      expect(queueRows().map((q) => q.keyword)).toEqual(["example only"]);
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

    it("fills the start message's settings from the injected function", async () => {
      settings = () => ({
        pacing: "fast",
        parallel: { enabled: true, maxWorkers: 4 },
        proxies: { enabled: false, includeDirect: true },
      });
      service = make();
      await started();
      expect(supervisor.starts[0]?.settings).toEqual({
        pacing: "fast",
        parallel: { enabled: true, maxWorkers: 4 },
        proxies: { enabled: false, includeDirect: true },
      });
    });

    it("leaves the mail settings, and so every mailbox address, out of a search start", async () => {
      settings = () => ({
        pacing: "normal",
        mail: {
          label: "Gratovo Outreach",
          senderName: null,
          mailboxes: [
            { address: "sam@ai-weekly.example", dailyCap: 20, warmupStartedOn: "2026-10-24" },
          ],
        },
      });
      service = make();
      await started();
      expect(supervisor.starts[0]?.settings).toEqual({ pacing: "normal" });
      expect(JSON.stringify(supervisor.starts[0])).not.toContain("ai-weekly.example");
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
        job: { keywords: ["local llm"], startAt: 0 },
        secrets: { youtubeKey: exampleKey, proxyUrls: [proxy], gatewayUrls: [gateway] },
      });
    });

    it("reads the gateways' object shape", async () => {
      mode = "live";
      secretValues = {
        "pipeline.gateways": JSON.stringify({
          enabled: true,
          gateways: [{ region: "us-east-1", apiId: "abc123", url: gateway }],
        }),
      };
      await started(["a one"]);
      expect(supervisor.starts[0]?.secrets).toMatchObject({ gatewayUrls: [gateway] });
    });

    it("sends no gateway while they are turned off", async () => {
      mode = "live";
      secretValues = {
        "pipeline.gateways": JSON.stringify({
          enabled: false,
          gateways: [{ region: "us-east-1", apiId: "abc123", url: gateway }],
        }),
      };
      await started(["a one"]);
      expect(supervisor.starts[0]?.secrets).toMatchObject({ gatewayUrls: [] });
    });

    it("treats a missing or malformed proxy list as none", async () => {
      secretValues = { "pipeline.proxies": "{not json", "pipeline.gateways": '["ok", 5]' };
      await started(["a one"]);
      expect(supervisor.starts[0]?.secrets).toMatchObject({ proxyUrls: [], gatewayUrls: [] });
    });

    it("sets the run to running, clears the log and emits", async () => {
      await started();
      supervisor.send({ type: "log", level: "info", text: "hello" });
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
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
        wait: null,
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
      expect(queueRows()[0]?.state).toBe("running");
      supervisor.send(keyword(0, "done", { found: 12, kept: 4 }));
      const state = service.state();
      expect(queueRows()[0]).toMatchObject({
        keyword: "ai agents",
        state: "done",
        found: 12,
        kept: 4,
        failures: 0,
      });
      expect(state.at).toBe(1);
      expect(state.run.found).toBe(12);
      expect(readFileSync(join(userData, "example-pipeline", "find.json"), "utf8")).toContain(
        '"at": 1',
      );
    });

    it("counts a keyword's incomplete searches: queued again twice, failed at the third", () => {
      supervisor.send(keyword(1, "incomplete"));
      expect(queueRows()[1]).toMatchObject({ state: "queued", failures: 1 });
      supervisor.send(keyword(1, "incomplete"));
      expect(queueRows()[1]).toMatchObject({ state: "queued", failures: 2 });
      supervisor.send(keyword(1, "incomplete"));
      expect(queueRows()[1]).toMatchObject({ state: "failed", failures: failureLimit });
    });

    it("queues a keyword again on a run-ending error without counting a failure", () => {
      supervisor.send(keyword(1, "started"));
      supervisor.send(keyword(1, "failed"));
      expect(queueRows()[1]).toMatchObject({ state: "queued", failures: 0 });
    });

    it("resets the failures when the keyword is done", () => {
      supervisor.send(keyword(1, "incomplete"));
      supervisor.send(keyword(1, "done", { found: 1, kept: 1 }));
      expect(queueRows()[1]).toMatchObject({ state: "done", failures: 0 });
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
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      supervisor.send(keyword(1, "done", { found: 1, kept: 1 }));
      supervisor.send(keyword(2, "done", { found: 1, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "done", at: 3 }) });
      const state = service.state();
      expect(state.run).toMatchObject({ state: "done", error: null });
      expect(state.at).toBe(3);
    });

    it("puts running entries back to queued and points at the first one not done", () => {
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "done", at: 3 }) });
      const state = service.state();
      expect(queueRows()[0]?.state).toBe("queued");
      expect(state.at).toBe(0);
    });

    it("stopped: paused", () => {
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "stopped", at: 1 }) });
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
        result: null,
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
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      // There is no pipeline.db in this folder, so the list is what the database holds: none.
      expect(service.state().kept).toEqual([]);
    });

    describe("waiting", () => {
      const until = "2026-11-02T09:30:00Z";

      it("a wait message shows the reason and the time; resume clears it", () => {
        supervisor.send({ type: "wait", reason: "quota", until });
        expect(service.state().run).toMatchObject({
          state: "waiting",
          wait: { reason: "quota", until },
        });
        supervisor.send({ type: "resume", reason: "quota" });
        expect(service.state().run).toMatchObject({ state: "running", wait: null });
      });

      it("a resume while running changes nothing", () => {
        supervisor.send({ type: "resume", reason: "quota" });
        expect(service.state().run).toMatchObject({ state: "running", wait: null });
      });

      it("one reason resuming leaves the others showing", () => {
        const later = "2026-11-02T10:30:00Z";
        supervisor.send({ type: "wait", reason: "quota", until: later });
        supervisor.send({ type: "wait", reason: "routes", until });
        expect(service.state().run.wait).toEqual({ reason: "quota", until: later });
        supervisor.send({ type: "resume", reason: "routes" });
        expect(service.state().run).toMatchObject({
          state: "waiting",
          wait: { reason: "quota", until: later },
        });
        supervisor.send({ type: "resume", reason: "api" });
        expect(service.state().run.state).toBe("waiting");
        supervisor.send({ type: "resume", reason: "quota" });
        expect(service.state().run).toMatchObject({ state: "running", wait: null });
      });

      it("the exit clears the wait", () => {
        supervisor.send({ type: "wait", reason: "routes", until });
        supervisor.finish({ kind: "ended", result: null, end: endLine() });
        expect(service.state().run).toMatchObject({ state: "done", wait: null });
      });

      it("stop while waiting stops, and a late wait does not undo it", () => {
        supervisor.send({ type: "wait", reason: "api", until });
        service.stop();
        expect(supervisor.stops).toBe(1);
        expect(service.state().run).toMatchObject({ state: "stopping", wait: null });
        supervisor.send({ type: "wait", reason: "api", until });
        expect(service.state().run.state).toBe("stopping");
        supervisor.finish({ kind: "failed", reason: "killed" });
        expect(service.state().run).toMatchObject({ state: "paused", wait: null });
      });

      it("still counts as busy while waiting", async () => {
        supervisor.send({ type: "wait", reason: "routes", until });
        expect(await service.start()).toMatchObject({ ok: false, problem: "running" });
      });
    });

    it("emits when the run ends", () => {
      emitted = [];
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
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

  describe("a lane shared with the email finder (plan D30)", () => {
    function withYield(yieldLane: () => Promise<void>): FindService {
      return createFindService({
        supervisor,
        account: {
          findContext: () => ({ mode: "example", workerId: "example", folder: "example-pipeline" }),
          teamKeys: { youtubeKey: () => key() },
        },
        secrets: { get: () => Promise.resolve(undefined) },
        userData,
        emit: (state) => emitted.push(state),
        now: () => clock,
        yieldLane,
      });
    }

    it("asks a lookup on the lane to give way, then starts the search", async () => {
      // The finder's refetch holds the lane; giving way ends it.
      supervisor.running = true;
      const yieldLane = vi.fn(() => {
        supervisor.running = false;
        return Promise.resolve();
      });
      service = withYield(yieldLane);
      await started();
      expect(yieldLane).toHaveBeenCalledOnce();
      expect(supervisor.starts[0]?.job.kind).toBe("search");
    });

    it("doesn't ask when the lane is free", async () => {
      const yieldLane = vi.fn(() => Promise.resolve());
      service = withYield(yieldLane);
      await started();
      expect(yieldLane).not.toHaveBeenCalled();
    });

    it("still answers running when the lane stays busy (the import)", async () => {
      supervisor.running = true;
      service = withYield(() => Promise.resolve());
      service.add(["ai agents"]);
      expect(await service.start()).toEqual({ ok: false, problem: "running" });
      expect(supervisor.starts).toEqual([]);
    });

    it("doesn't treat another job on the lane as its search: queue edits work, Pause stops nothing", () => {
      service.add(["ai agents", "local llm"]);
      supervisor.running = true;
      expect(service.startAt(1)).toEqual({ ok: true });
      expect(service.remove(0)).toEqual({ ok: true });
      service.stop();
      expect(supervisor.stops).toBe(0);
      expect(service.state().run.state).toBe("ready");
    });

    it("guards its own search again after it ends", async () => {
      await started();
      supervisor.finish({ kind: "ended", end: endLine(), result: null });
      expect(service.remove(0)).toEqual({ ok: true });
      supervisor.running = true;
      service.stop();
      expect(supervisor.stops).toBe(0);
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
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
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
  describe("the catalog hooks and the skip list", () => {
    const never = (id: string) => ({ id, stage: "never" }) as unknown as CreatorState;
    const goodId = `UC${"a".repeat(22)}`;

    function withHooks(extra: {
      states?: () => Promise<readonly CreatorState[]>;
      changed?: () => void;
    }): FindService {
      return createFindService({
        supervisor,
        account: {
          findContext: () => ({ mode: "example", workerId: "example", folder: "example-pipeline" }),
          teamKeys: { youtubeKey: () => key() },
        },
        secrets: { get: () => Promise.resolve(undefined) },
        userData,
        emit: (state) => emitted.push(state),
        now: () => clock,
        ...(extra.states === undefined ? {} : { creatorStates: extra.states }),
        ...(extra.changed === undefined ? {} : { onPipelineChanged: extra.changed }),
      });
    }

    it("sends only well-formed never-contact ids as the job's skip list", async () => {
      const other = { id: `UC${"b".repeat(22)}`, stage: "shortlisted" } as unknown as CreatorState;
      service = withHooks({
        states: () => Promise.resolve([never(goodId), never("not-an-id"), other]),
      });
      await started();
      expect((supervisor.starts[0]?.job as SearchJob | undefined)?.skip).toEqual([goodId]);
    });

    it("leaves skip out when there are none or the read fails", async () => {
      service = withHooks({ states: () => Promise.reject(new Error("db")) });
      await started();
      expect(supervisor.starts[0]?.job).not.toHaveProperty("skip");
    });

    it("tells the catalog on a finished or failed keyword and the end, not on a start or a channel", async () => {
      const changed = vi.fn();
      service = withHooks({ changed });
      await started();
      supervisor.send(keyword(0, "started"));
      supervisor.send(channel("UC_a", "kept"));
      supervisor.send(channel("UC_b", "swept"));
      expect(changed).not.toHaveBeenCalled();
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      supervisor.send(keyword(1, "incomplete"));
      expect(changed).toHaveBeenCalledTimes(2);
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      expect(changed).toHaveBeenCalledTimes(3);
    });

    it("names the open find folder", () => {
      expect(service.folder()).toBe(join(userData, "example-pipeline"));
      mode = null;
      expect(service.folder()).toBeNull();
    });

    it("names the folder without switching the session to it", async () => {
      await started(["ai agents"]);
      supervisor.send(keyword(0, "started"));
      // The account moves on while the run's session is open; asking for the folder only reads.
      mode = "live";
      expect(service.folder()).toBe(join(userData, "pipeline"));
      mode = "example";
      expect(service.state().run.state).toBe("running");
      expect(queueRows()[0]?.state).toBe("running");
    });
  });

  describe("a run sends only what is left", () => {
    it("sends the queued entries from at on, and maps the job index back to the queue", async () => {
      service.add(["a one", "b two", "c three", "d four"]);
      service.startAt(1);
      expect(await service.start()).toEqual({ ok: true });
      supervisor.send(keyword(0, "done", { found: 2, kept: 1 }));
      supervisor.send(keyword(1, "started"));
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      expect(supervisor.starts[0]?.job).toMatchObject({
        keywords: ["b two", "c three", "d four"],
        startAt: 0,
      });
      expect(queueRows().map((q) => q.state)).toEqual(["queued", "done", "queued", "queued"]);
      expect(service.state().at).toBe(2);
    });

    it("skips done and failed entries, and ignores an unknown index", async () => {
      service.add(["a one", "b two", "c three"]);
      expect(await service.start()).toEqual({ ok: true });
      supervisor.send(keyword(9, "done"));
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      for (let i = 0; i < failureLimit; i += 1) {
        supervisor.send(keyword(1, "incomplete"));
      }
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "stopped", at: 0 }) });
      expect(service.state().at).toBe(2);
      expect(queueRows().map((q) => q.state)).toEqual(["done", "failed", "queued"]);
      expect(await service.start()).toEqual({ ok: true });
      expect(supervisor.starts[1]?.job).toMatchObject({ keywords: ["c three"], startAt: 0 });
    });

    it("answers no_keywords when nothing is left to run", async () => {
      service.add(["a one"]);
      expect(await service.start()).toEqual({ ok: true });
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "done", at: 1 }) });
      expect(await service.start()).toEqual({ ok: false, problem: "no_keywords" });
    });
  });

  describe("retry", () => {
    async function failOne(): Promise<void> {
      service.add(["a one", "b two"]);
      expect(await service.start()).toEqual({ ok: true });
      for (let i = 0; i < failureLimit; i += 1) {
        supervisor.send(keyword(0, "incomplete"));
      }
      // The list ends here: with "b two" still to do, the run would chain its next batch.
      supervisor.send(keyword(1, "done", { found: 1, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
    }

    it("sets a failed entry back to queued with no failures", async () => {
      await failOne();
      expect(queueRows()[0]).toMatchObject({ state: "failed", failures: failureLimit });
      expect(service.retry(0)).toEqual({ ok: true });
      expect(queueRows()[0]).toMatchObject({ state: "queued", failures: 0 });
      expect(service.state().at).toBe(0);
    });

    it("is refused while a search runs", async () => {
      await failOne();
      service.retry(0);
      expect(await service.start()).toEqual({ ok: true });
      expect(service.retry(1)).toEqual({ ok: false, problem: "running" });
    });
  });

  describe("weak keywords", () => {
    type Row = readonly [string, string, number, string | null];

    function writeDb(rows: readonly Row[]): void {
      const folder = join(userData, "example-pipeline");
      mkdirSync(folder, { recursive: true });
      const db = new DatabaseSync(join(folder, "pipeline.db"));
      db.exec(
        "CREATE TABLE keywords (keyword TEXT PRIMARY KEY, status TEXT NOT NULL, " +
          "channels_found INTEGER NOT NULL DEFAULT 0, completed_at TEXT)",
      );
      const insert = db.prepare(
        "INSERT INTO keywords (keyword, status, channels_found, completed_at) VALUES (?, ?, ?, ?)",
      );
      for (const row of rows) {
        insert.run(...row);
      }
      db.close();
    }

    const rows: readonly Row[] = [
      ["found none", "done", 0, "2026-10-01 10:00:00"],
      ["honest none", "done", 0, "2026-11-03 09:00:00"],
      ["cut short", "done", 4, "2026-09-14 10:00:00"],
      ["fine early", "done", 4, "2026-09-20 10:00:00"],
      ["found many", "done", 40, "2026-09-14 10:00:00"],
      ["pending one", "pending", 0, null],
    ];

    it("counts none when there is no database or no table", () => {
      expect(service.weakCount()).toEqual({ count: 0 });
      const folder = join(userData, "example-pipeline");
      mkdirSync(folder, { recursive: true });
      new DatabaseSync(join(folder, "pipeline.db")).close();
      expect(service.weakCount()).toEqual({ count: 0 });
    });

    it("counts the done keywords with no channels before S1's release, or too few in the cut-short days", () => {
      writeDb(rows);
      expect(service.weakCount()).toEqual({ count: 2 });
    });

    it("leaves out keywords still queued, running or failed in the queue", () => {
      writeDb(rows);
      service.add(["FOUND NONE", "cut short"]);
      expect(service.weakCount()).toEqual({ count: 0 });
      expect(service.requeueWeak()).toEqual({ ok: true, requeued: 0, added: 0, skipped: 0 });
    });

    it("counts none, and logs the kind only, when the database can't be read", () => {
      const folder = join(userData, "example-pipeline");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "pipeline.db"), "not a database at all, just text".repeat(20));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(service.weakCount()).toEqual({ count: 0 });
      expect(log).toHaveBeenCalledTimes(1);
      expect(() => service.requeueWeak()).toThrow();
      log.mockRestore();
    });

    it("requeues a done keyword already in the queue (any case) and appends the rest", async () => {
      writeDb(rows);
      service.add(["Found None", "found many"]);
      expect(await service.start()).toEqual({ ok: true });
      supervisor.send(keyword(0, "done", { found: 0, kept: 0 }));
      supervisor.send(keyword(1, "done", { found: 40, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "done", at: 2 }) });
      expect(service.requeueWeak()).toEqual({ ok: true, requeued: 1, added: 1, skipped: 0 });
      expect(queueRows().map((q) => [q.keyword, q.state])).toEqual([
        ["Found None", "queued"],
        ["found many", "done"],
        ["cut short", "queued"],
      ]);
    });

    it("puts a done entry back with found, kept and failures at 0, and moves at back to it", async () => {
      writeDb(rows);
      service.add(["found none"]);
      expect(await service.start()).toEqual({ ok: true });
      supervisor.send(keyword(0, "done", { found: 3, kept: 2 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "done", at: 1 }) });
      expect(service.state().at).toBe(1);
      service.requeueWeak();
      expect(queueRows()[0]).toMatchObject({
        keyword: "found none",
        state: "queued",
        found: 0,
        kept: 0,
        failures: 0,
      });
      expect(service.state().at).toBe(0);
    });

    it("stops at the queue's limit and counts what did not fit", () => {
      writeDb(rows);
      service.add(Array.from({ length: 9999 }, (_, i) => `filler ${String(i)}`));
      expect(service.requeueWeak()).toEqual({ ok: true, requeued: 0, added: 1, skipped: 1 });
      expect(service.state().queue.total).toBe(10_000);
    });

    it("is refused while a search runs", async () => {
      writeDb(rows);
      service.add(["a one"]);
      expect(await service.start()).toEqual({ ok: true });
      expect(service.requeueWeak()).toEqual({ ok: false, problem: "running" });
    });
  });

  describe("keywords at scale", () => {
    const names = (prefix: string, n: number): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`);
    const folder = (): string => join(userData, "example-pipeline");

    function writeDb(): void {
      mkdirSync(folder(), { recursive: true });
      const db = new DatabaseSync(join(folder(), "pipeline.db"));
      db.exec(
        "CREATE TABLE keywords (keyword TEXT PRIMARY KEY, status TEXT NOT NULL, " +
          "channels_found INTEGER NOT NULL DEFAULT 0, completed_at TEXT, in_range_found INTEGER)",
      );
      db.exec("CREATE TABLE channel_keywords (channel_id TEXT, keyword TEXT, discovered_at TEXT)");
      db.exec(
        "INSERT INTO keywords (keyword, status) VALUES ('Alpha  Setup', 'pending'), ('beta setup', 'done')",
      );
      db.exec("INSERT INTO channel_keywords VALUES ('UC1', 'gamma setup', '2026-10-01 10:00:00')");
      db.close();
    }

    it("generates 3,000 keywords and a re-run adds none", () => {
      const tools = names("tool", 50);
      const angles = names("angle", 60);
      const counted = service.generate({ tools, angles, add: false });
      expect(counted).toMatchObject({ ok: true, fresh: 3000, repeats: 0, overCap: 0 });
      expect(service.state().queue.total).toBe(0);
      expect(service.generate({ tools, angles, add: true })).toMatchObject({ fresh: 3000 });
      expect(service.state().queue.total).toBe(3000);
      const again = service.generate({ tools, angles, add: true });
      expect(again).toMatchObject({ ok: true, fresh: 0, repeats: 3000 });
      expect(service.state().queue.total).toBe(3000);
    });

    it("skips what pipeline.db already knows and counts what is over the cap", () => {
      writeDb();
      const result = service.generate({
        tools: ["alpha", "beta", "gamma", "delta"],
        angles: ["setup"],
        add: true,
      });
      expect(result).toMatchObject({ ok: true, fresh: 1, repeats: 3, overCap: 0 });
      expect(queueRows().map((q) => q.keyword)).toEqual(["delta setup"]);
      const capped = service.generate({
        tools: names("t", 100),
        angles: names("a", 100),
        add: true,
      });
      expect(capped).toMatchObject({ fresh: 9999, overCap: 1 });
      expect(service.state().queue.total).toBe(10_000);
    });

    it("keeps a removed keyword's origin, and a removed tool never touches origins", () => {
      service.generate({ tools: ["claude"], angles: ["setup"], add: true });
      service.remove(0);
      service.setLists({ tools: [], angles: [] });
      const file = JSON.parse(readFileSync(join(folder(), "keywords.json"), "utf8")) as {
        tools: string[];
        origins: Record<string, unknown>;
      };
      expect(file.tools).toEqual([]);
      expect(file.origins["claude setup"]).toEqual({ tool: "claude", angle: "setup" });
      expect(make().lists()).toEqual({ tools: [], angles: [] });
    });

    it("answers the default lists when there is no file", () => {
      expect(service.lists().tools).toContain("claude code");
      expect(service.lists().angles).toContain("setup");
    });

    it("retries a done keyword", () => {
      service.add(["ai agents"]);
      const entry = { keyword: "ai agents", state: "done", found: 9, kept: 3, failures: 0 };
      writeFileSync(
        join(folder(), "find.json"),
        JSON.stringify({ queue: [entry], at: 1, rules: service.state().rules }),
      );
      const fresh = make();
      expect(fresh.retry(0)).toEqual({ ok: true });
      expect(fresh.keywords({ offset: 0, limit: 10, filter: "all" }).rows[0]).toMatchObject({
        state: "queued",
        found: 0,
        kept: 0,
      });
      expect(fresh.state().at).toBe(0);
    });

    it("pages the queue with tool, angle and the place in the whole queue", () => {
      service.add(["typed by hand"]);
      service.generate({ tools: ["claude", "cursor"], angles: ["setup", "review"], add: true });
      const page = service.keywords({ offset: 1, limit: 2, filter: "all" });
      expect(page.total).toBe(5);
      expect(page.rows.map((r) => [r.index, r.keyword, r.tool, r.angle])).toEqual([
        [1, "claude setup", "claude", "setup"],
        [2, "cursor review", "cursor", "review"],
      ]);
      expect(queueRows()[0]).toMatchObject({ tool: null, angle: null, rank: null });
      expect(service.keywords({ offset: 0, limit: 10, filter: "done" }).total).toBe(0);
      expect(service.keywords({ offset: 0, limit: 10, filter: "todo" }).total).toBe(5);
    });

    it("summarizes counts and bumps the version on each change", () => {
      const before = service.state().queue;
      service.add(["one", "two"]);
      const after = service.state().queue;
      expect(after).toMatchObject({ total: 2, queued: 2, running: 0, done: 0, failed: 0 });
      expect(after.current.map((r) => r.keyword)).toEqual(["one"]);
      expect(after.version).toBeGreaterThan(before.version);
      service.remove(1);
      expect(service.state().queue.version).toBeGreaterThan(after.version);
      expect(service.entries()).toEqual([{ keyword: "one", found: 0, kept: 0 }]);
    });

    it("reads origins from own keys only: a keyword named constructor has none", () => {
      service.add(["constructor", "toString", "__proto__"]);
      expect(queueRows().map((r) => [r.keyword, r.tool, r.angle, r.rank])).toEqual([
        ["constructor", null, null, null],
        ["toString", null, null, null],
        ["__proto__", null, null, null],
      ]);
      expect(service.state().queue.current[0]).toMatchObject({
        keyword: "constructor",
        tool: null,
      });
    });

    it("stores an origin for a crossed __proto__ as an own key", () => {
      service.generate({ tools: ["__proto__"], angles: ["{tool}"], add: true });
      const row = queueRows().find((r) => r.keyword === "__proto__");
      expect(row).toMatchObject({ tool: "__proto__", angle: "{tool}" });
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it("seeds the example data's empty origins from the example history (K13)", () => {
      service.add(["claude code tutorial"]);
      expect(queueRows()[0]).toMatchObject({ tool: "claude code", angle: "tutorial" });
      mode = "live";
      const live = make();
      live.add(["claude code tutorial"]);
      expect(live.keywords({ offset: 0, limit: 1, filter: "all" }).rows[0]).toMatchObject({
        tool: null,
        angle: null,
      });
    });

    it("answers stale and changes nothing when the keyword is no longer at that place", () => {
      service.add(["one", "two", "three"]);
      expect(service.remove(1, "two")).toEqual({ ok: true });
      expect(service.remove(1, "two")).toEqual({ ok: false, problem: "stale" });
      expect(service.startAt(1, "Two")).toEqual({ ok: false, problem: "stale" });
      expect(service.retry(5, "three")).toEqual({ ok: false, problem: "stale" });
      expect(service.entries().map((e) => e.keyword)).toEqual(["one", "three"]);
      expect(service.startAt(1, " THREE ")).toEqual({ ok: true });
      expect(service.state().at).toBe(1);
    });
  });

  describe("batches re-sorted by yield (plan S6, K9 and K10)", () => {
    const folder = (): string => join(userData, "example-pipeline");
    const jobWords = (n: number): string[] =>
      (supervisor.starts[n]?.job as SearchJob | undefined)?.keywords ?? [];
    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    /** Five done keywords per tool: "strong" found 20 in range each, "weak" none. */
    function writeYield(): void {
      const db = new DatabaseSync(join(folder(), "pipeline.db"));
      db.exec(
        "CREATE TABLE keywords (keyword TEXT PRIMARY KEY, status TEXT NOT NULL, " +
          "channels_found INTEGER NOT NULL DEFAULT 0, completed_at TEXT, in_range_found INTEGER)",
      );
      for (let i = 0; i < 5; i += 1) {
        db.exec(
          `INSERT INTO keywords VALUES ('strong past ${String(i)}', 'done', 20, '2026-11-01', 20)`,
        );
        db.exec(
          `INSERT INTO keywords VALUES ('weak past ${String(i)}', 'done', 0, '2026-11-01', 0)`,
        );
      }
      db.close();
    }

    /** `weak` keywords first, then `strong` ones, each with its origin in keywords.json. */
    function queueOf(weak: number, strong: number): void {
      const origins: Record<string, { tool: string; angle: string }> = {};
      for (let i = 0; i < 5; i += 1) {
        origins[`strong past ${String(i)}`] = { tool: "strong", angle: "past" };
        origins[`weak past ${String(i)}`] = { tool: "weak", angle: "past" };
      }
      const words: string[] = [];
      for (let i = 0; i < weak; i += 1) {
        words.push(`w${String(i)}`);
        origins[`w${String(i)}`] = { tool: "weak", angle: "now" };
      }
      for (let i = 0; i < strong; i += 1) {
        words.push(`s${String(i)}`);
        origins[`s${String(i)}`] = { tool: "strong", angle: "now" };
      }
      mkdirSync(folder(), { recursive: true });
      writeFileSync(
        join(folder(), "keywords.json"),
        JSON.stringify({ tools: ["strong", "weak"], angles: ["now", "past"], origins }),
      );
      service.add(words);
    }

    function finishBatch(n: number): void {
      for (let i = 0; i < jobWords(n).length; i += 1) {
        supervisor.send(keyword(i, "done", { found: 1, kept: 0 }));
      }
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
    }

    it("runs 450 keywords as 200, 200 and 50, re-sorting before each batch", async () => {
      queueOf(250, 200);
      expect(await service.start()).toEqual({ ok: true });
      // No yield yet: the order is the added order.
      expect(jobWords(0)).toHaveLength(200);
      expect(jobWords(0).slice(0, 2)).toEqual(["w0", "w1"]);
      supervisor.send({ type: "log", level: "info", text: "batch one" });
      for (let i = 0; i < 200; i += 1) {
        supervisor.send(keyword(i, "done", { found: 1, kept: 0 }));
      }
      // The pipeline wrote the yield while the first batch ran.
      writeYield();
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      expect(service.state().run).toMatchObject({ state: "running", found: 200 });
      expect(await service.start()).toEqual({ ok: false, problem: "running" });
      await vi.waitFor(() => {
        expect(supervisor.starts).toHaveLength(2);
      });
      // `at` (w200) keeps its place; the strong tool's keywords come before the weak ones.
      // A chained batch holds nothing in place: its first keyword is re-sorted too (w200 goes back).
      expect(jobWords(1)).toHaveLength(200);
      expect(jobWords(1).slice(0, 3)).toEqual(["s0", "s1", "s2"]);
      expect(jobWords(1).at(-1)).toBe("s199");
      expect(service.state().at).toBe(200);
      expect(service.keywords({ offset: 201, limit: 1, filter: "all" }).rows[0]).toMatchObject({
        keyword: "s1",
        rank: "up",
      });
      finishBatch(1);
      await vi.waitFor(() => {
        expect(supervisor.starts).toHaveLength(3);
      });
      expect(jobWords(2)).toEqual(Array.from({ length: 50 }, (_, i) => `w${String(i + 200)}`));
      finishBatch(2);
      await flush();
      expect(supervisor.starts).toHaveLength(3);
      const state = service.state();
      expect(state.run).toMatchObject({ state: "done", found: 450, error: null });
      expect(state.log.map((line) => line.text)).toContain("batch one");
      expect(state.queue).toMatchObject({ total: 450, done: 450 });
    });

    it("re-sorts before the first batch and keeps the Start here keyword first", async () => {
      queueOf(3, 2);
      writeYield();
      service.startAt(1);
      expect(await service.start()).toEqual({ ok: true });
      expect(jobWords(0)).toEqual(["w1", "s0", "s1", "w2"]);
      expect(queueRows().map((r) => r.keyword)).toEqual(["w0", "w1", "s0", "s1", "w2"]);
    });

    describe("what does not chain", () => {
      beforeEach(async () => {
        await started();
      });

      it("a stop", async () => {
        supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
        supervisor.finish({ kind: "ended", result: null, end: endLine({ state: "stopped" }) });
        await flush();
        expect(supervisor.starts).toHaveLength(1);
        expect(service.state().run.state).toBe("paused");
      });

      it("a failed batch", async () => {
        supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
        supervisor.finish({
          kind: "ended",
          result: null,
          end: endLine({ state: "failed", error: { code: "quota", message: "spent" } }),
        });
        await flush();
        expect(supervisor.starts).toHaveLength(1);
        expect(service.state().run).toMatchObject({ state: "failed", error: "quota" });
      });

      it("a crash", async () => {
        supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
        supervisor.finish({ kind: "failed", reason: "crash" });
        await flush();
        expect(supervisor.starts).toHaveLength(1);
      });

      it("a batch that finished nothing", async () => {
        supervisor.send(keyword(0, "incomplete"));
        supervisor.finish({ kind: "ended", result: null, end: endLine() });
        await flush();
        expect(supervisor.starts).toHaveLength(1);
        expect(service.state().run.state).toBe("done");
      });

      it("a sign-out between batches", async () => {
        supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
        supervisor.finish({ kind: "ended", result: null, end: endLine() });
        await service.shutdown();
        await flush();
        expect(supervisor.starts).toHaveLength(1);
      });
    });

    it("chains a batch that only failed a keyword for good", async () => {
      await started();
      for (let i = 0; i < failureLimit; i += 1) {
        supervisor.send(keyword(0, "incomplete"));
      }
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      await vi.waitFor(() => {
        expect(supervisor.starts).toHaveLength(2);
      });
      expect(jobWords(1)).toEqual(["local llm", "ai news"]);
    });

    it("Stop between batches stops the chain, and Start works again after", async () => {
      await started();
      supervisor.send(keyword(0, "done", { found: 3, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      service.stop();
      expect(service.state().run).toMatchObject({ state: "paused", found: 3 });
      await flush();
      expect(supervisor.starts).toHaveLength(1);
      expect(supervisor.stops).toBe(0);
      expect(await service.start()).toEqual({ ok: true });
      expect(jobWords(1)).toEqual(["local llm", "ai news"]);
      expect(service.state().run).toMatchObject({ state: "running", found: 0 });
    });

    it("lets Remove and Start work at once after Stop between batches, while a launch still waits", async () => {
      let release: (() => void) | null = null;
      mode = "live";
      service = make();
      await started();
      key = () =>
        new Promise((resolve) => {
          release = () => {
            resolve(exampleKey);
          };
        });
      supervisor.send(keyword(0, "done", { found: 3, kept: 1 }));
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      expect(service.remove(2)).toEqual({ ok: false, problem: "running" });
      service.stop();
      expect(service.state().run.state).toBe("paused");
      expect(service.remove(2)).toEqual({ ok: true });
      key = () => Promise.resolve(exampleKey);
      expect(await service.start()).toEqual({ ok: true });
      expect(jobWords(1)).toEqual(["local llm"]);
      (release as (() => void) | null)?.();
      await flush();
      expect(supervisor.starts).toHaveLength(2);
      expect(service.state().run.state).toBe("running");
    });

    it("reads pipeline.db's facts per batch and at the end, never per message or page", async () => {
      queueOf(0, 250);
      writeYield();
      expect(await service.start()).toEqual({ ok: true });
      const reads = factsReads.mock.calls.length;
      for (let i = 0; i < 50; i += 1) {
        supervisor.send(keyword(i, "started"));
        supervisor.send(keyword(i, "done", { found: 1, kept: 0 }));
        service.state();
        service.keywords({ offset: 0, limit: 100, filter: "all" });
      }
      expect(factsReads.mock.calls.length).toBe(reads);
    });

    it("a next batch that can't start ends the run", async () => {
      await started();
      supervisor.send(keyword(0, "done", { found: 1, kept: 1 }));
      supervisor.problem = "no_python";
      supervisor.finish({ kind: "ended", result: null, end: endLine() });
      await vi.waitFor(() => {
        expect(service.state().run).toMatchObject({ state: "failed", error: "crash" });
      });
      expect(await service.start()).toEqual({ ok: false, problem: "no_python" });
    });
  });
});
