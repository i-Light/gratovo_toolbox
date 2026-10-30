import type { CatalogItem } from "@gratovo/core/find";
import { channels } from "@gratovo/ipc";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineMessage, Start } from "../pipeline/protocol";
import type { EndMessage, JobHandlers, PipelineExit } from "../pipeline/supervisor";

import {
  createArchiveService,
  dueChannels,
  refetchMax,
  sweepMax,
  type ArchiveContext,
  type ArchiveService,
  type ArchiveServiceDeps,
} from "./archive-service";
import { channelId } from "./catalog-fixture";

const day = 86_400_000;
const t0 = Date.UTC(2026, 9, 20);
const exampleKey = "example-key-not-real";

interface FakeLane {
  running: boolean;
  starts: Start[];
  handlers: JobHandlers | null;
  stops: number;
  problem: "running" | "no_python" | null;
  start(
    start: Start,
    handlers: JobHandlers,
  ): { ok: true } | { ok: false; problem: "running" | "no_python" };
  stop(): void;
  send(message: PipelineMessage): void;
  finish(exit: PipelineExit): void;
}

function fakeLane(): FakeLane {
  const lane: FakeLane = {
    running: false,
    starts: [],
    handlers: null,
    stops: 0,
    problem: null,
    start(start, handlers) {
      if (lane.running) {
        return { ok: false, problem: "running" };
      }
      if (lane.problem !== null) {
        return { ok: false, problem: lane.problem };
      }
      lane.starts.push(start);
      lane.handlers = handlers;
      lane.running = true;
      return { ok: true };
    },
    stop() {
      lane.stops += 1;
    },
    send(message) {
      lane.handlers?.onMessage(message);
    },
    finish(exit) {
      lane.running = false;
      lane.handlers?.onExit(exit);
    },
  };
  return lane;
}

const endMessage = (over: Partial<EndMessage> = {}): EndMessage => ({
  type: "end",
  state: "done",
  at: 0,
  found: 0,
  kept: 0,
  ...over,
});

const swept = (archived: number): PipelineExit => ({
  kind: "ended",
  end: endMessage(),
  result: { type: "result", kind: "archive.sweep", data: { archived } },
});

const restoredExit = (restored: { channelId: string; handle: string | null }[]): PipelineExit => ({
  kind: "ended",
  end: endMessage(),
  result: { type: "result", kind: "archive.restore", data: { restored } },
});

const plainEnd = (over: Partial<EndMessage> = {}): PipelineExit => ({
  kind: "ended",
  end: endMessage(over),
  result: null,
});

const reached = (id: string): PipelineMessage => ({
  type: "channel",
  keyword: "__manual_refetch__",
  channelId: id,
  handle: null,
  name: `Channel ${id}`,
  subscribers: 50_000,
  medianViews: 9_000,
  country: "US",
  outcome: "kept",
});

function row(id: string, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    name: id,
    handle: `@${id}`,
    pic: null,
    stage: "rejected",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: null,
    medianViews: 0,
    uploads30: 0,
    country: null,
    sponsors: [],
    emails: [],
    latestUploadAt: null,
    foundAt: null,
    run: null,
    keyword: null,
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
    uploadsRead: true,
    readFailed: false,
    trimmedAverage: null,
    viewStability: null,
    stars: null,
    format: null,
    botRisk: null,
    ...over,
  };
}

/** A creator rejected 30 days ago, long due. */
const due = (tag: string, over: Partial<CatalogItem> = {}): CatalogItem =>
  row(channelId(tag), { handle: `@${tag}`, rejectedAt: t0 - 30 * day, ...over });

const sweptChannels = (start: Start | undefined) =>
  start?.job.kind === "archive.sweep" ? start.job.channels : [];
const handlesOf = (start: Start | undefined): string[] =>
  start?.job.kind === "refetch" ? start.job.handles : [];

describe("dueChannels", () => {
  it("picks the rejected creators whose archive date has passed, and never one with no date", () => {
    const rows = [
      // The server's due date moves with the owner's days: due 7 days after it with 14.
      due("server_due", { archiveDueAt: t0 - 8 * day }),
      due("server_not_yet", { archiveDueAt: t0 - 6 * day }),
      due("reject_due", { rejectedAt: t0 - 14 * day }),
      due("reject_not_yet", { rejectedAt: t0 - 13 * day }),
      due("no_date", { rejectedAt: null, archiveDueAt: null }),
      due("archived", { archivedAt: t0 - day }),
      due("shortlisted", { stage: "shortlisted" }),
      due("never", { stage: "never" }),
      row("not_a_channel_id", { rejectedAt: t0 - 30 * day }),
    ];
    expect(dueChannels(rows, 14, t0).map((c) => c.channelId)).toEqual([
      channelId("server_due"),
      channelId("reject_due"),
    ]);
  });

  it("is due on the day itself", () => {
    expect(dueChannels([due("edge", { rejectedAt: t0 - 7 * day })], 7, t0)).toHaveLength(1);
  });

  it("sends the handle as the protocol takes it, else null", () => {
    const rows = [
      due("a", { handle: "@ai_tools" }),
      due("b", { handle: "ainews" }),
      due("c", { handle: "" }),
      due("d", { handle: "@名前" }),
    ];
    expect(dueChannels(rows, 7, t0).map((c) => c.handle)).toEqual([
      "@ai_tools",
      "@ainews",
      null,
      null,
    ]);
  });
});

describe("the archive service", () => {
  let lane: FakeLane;
  let context: ArchiveContext | null;
  let searching: boolean;
  let rows: CatalogItem[];
  let snapshots: number;
  let changed: number;
  let service: ArchiveService;

  function make(over: Partial<ArchiveServiceDeps> = {}): ArchiveService {
    return createArchiveService({
      supervisor: lane,
      context: () => context,
      searching: () => searching,
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ version: snapshots, rows });
      },
      archiveDays: () => 7,
      youtubeKey: () => Promise.resolve(exampleKey),
      routing: () => Promise.resolve({ proxyUrls: [], gatewayUrls: [] }),
      settings: () => ({
        pacing: "normal",
        mail: { label: "Gratovo", senderName: null, mailboxes: [] },
      }),
      onPipelineChanged: () => {
        changed += 1;
      },
      now: () => t0,
      ...over,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    lane = fakeLane();
    context = { source: "live", dataDir: "C:\\data\\pipeline", worker: "user-1" };
    searching = false;
    rows = [];
    snapshots = 0;
    changed = 0;
    service = make();
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("the sweep", () => {
    it("archives the due creators on the store lane, with no key and no route", async () => {
      rows = [due("a"), due("b", { rejectedAt: t0 - day })];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toHaveLength(1);
      const start = lane.starts[0];
      expect(start?.job).toEqual({
        kind: "archive.sweep",
        channels: [{ channelId: channelId("a"), handle: "@a" }],
      });
      expect(start?.dataDir).toBe("C:\\data\\pipeline");
      expect(start?.secrets).toEqual({ youtubeKey: null, proxyUrls: [], gatewayUrls: [] });
      lane.finish(swept(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toBe(1);
    });

    it("records the week's totals after a pass, even when nothing was due", async () => {
      const recorded: [string, number][] = [];
      service.dispose();
      service = make({
        recordWeek: (path, at) => {
          recorded.push([path, at]);
        },
      });
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toEqual([]);
      expect(recorded).toEqual([[join(context?.dataDir ?? "", "pipeline.db"), t0]]);
    });

    it("keeps sweeping when the weekly totals fail", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      service.dispose();
      service = make({
        recordWeek: () => {
          throw new Error("disk");
        },
      });
      rows = [due("a")];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(swept(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toBe(1);
      expect(error).toHaveBeenCalledWith("Archive: the weekly totals could not be written.");
    });

    it("runs on the example data too", async () => {
      context = { source: "example", dataDir: "C:\\data\\example-pipeline", worker: "example" };
      rows = [due("a")];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts[0]?.source).toBe("example");
    });

    it("starts nothing when nothing is due or no data is open", async () => {
      rows = [due("a", { rejectedAt: t0 - day })];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      context = null;
      rows = [due("b")];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toEqual([]);
    });

    it("splits more than 2,000 creators into jobs of at most 2,000, one after another", async () => {
      rows = Array.from({ length: 4500 }, (_, i) => due(`c${String(i)}`));
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(sweptChannels(lane.starts[0])).toHaveLength(sweepMax);
      lane.finish(swept(sweepMax));
      await vi.advanceTimersByTimeAsync(0);
      expect(sweptChannels(lane.starts[1])).toHaveLength(sweepMax);
      lane.finish(swept(sweepMax));
      await vi.advanceTimersByTimeAsync(0);
      expect(sweptChannels(lane.starts[2]).map((c) => c.channelId)).toEqual(
        rows.slice(4000).map((r) => r.id),
      );
      lane.finish(swept(500));
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toHaveLength(3);
      expect(changed).toBe(3);
      // The list is read again for each job, and once more to find none left.
      expect(snapshots).toBe(4);
    });

    it("folds requests made while one runs into one more pass after it", async () => {
      rows = [due("a")];
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      service.sweep();
      service.sweep();
      service.sweep();
      // As the catalog after the job: a is archived for good, and b came due meanwhile.
      rows = [due("a", { archivedAt: t0 }), due("b")];
      lane.finish(swept(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(sweptChannels(lane.starts[1])).toEqual([{ channelId: channelId("b"), handle: "@b" }]);
      rows = [due("a", { archivedAt: t0 }), due("b", { archivedAt: t0 })];
      lane.finish(swept(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toHaveLength(2);
      // Two reads in the first pass and its last one, then a single read for the folded pass.
      expect(snapshots).toBe(4);
    });

    it("reads the due list again after waiting for the lane, so a creator brought back meanwhile stays", async () => {
      rows = [due("a"), due("b"), due("c")];
      lane.running = true;
      service.sweep();
      await vi.advanceTimersByTimeAsync(5000);
      expect(lane.starts).toEqual([]);
      // During the wait a was brought back to Review new and b was shortlisted.
      rows = [due("a", { stage: "new" }), due("b", { stage: "shortlisted" }), due("c")];
      lane.running = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(sweptChannels(lane.starts[0])).toEqual([{ channelId: channelId("c"), handle: "@c" }]);
    });

    it("checks the lane again after reading the list, and waits when a job took it meanwhile", async () => {
      rows = [due("a")];
      let release: () => void = () => undefined;
      const slow = make({
        snapshot: () =>
          new Promise((resolve) => {
            release = () => {
              resolve({ version: 1, rows });
            };
          }),
      });
      slow.sweep();
      await vi.advanceTimersByTimeAsync(0);
      // The finder took the lane while the catalog rebuilt.
      lane.running = true;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toEqual([]);
      slow.dispose();
    });

    it("frees the lane when the start message fails its schema, and logs a failed sweep", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      rows = [due("a")];
      const start = lane.start.bind(lane);
      lane.start = () => {
        throw new Error("the start message failed its schema");
      };
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(logged).toHaveBeenCalledWith("Archive: a sweep failed (protocol).");
      // Nothing holds the lane: Start gets it at once, and a restore runs.
      await expect(service.yieldLane()).resolves.toBeUndefined();
      lane.start = start;
      const answer = service.restore([channelId("b")]);
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts[0]?.job.kind).toBe("archive.restore");
      lane.finish(restoredExit([]));
      expect(await answer).toEqual({ ok: true, restored: 0, refetch: false });
    });

    it("waits behind a busy lane, trying again every 5 s, and folds requests meanwhile", async () => {
      rows = [due("a")];
      lane.running = true;
      service.sweep();
      await vi.advanceTimersByTimeAsync(5000);
      service.sweep();
      expect(lane.starts).toEqual([]);
      lane.running = false;
      await vi.advanceTimersByTimeAsync(4999);
      expect(lane.starts).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(lane.starts).toHaveLength(1);
    });

    it("gives way when Start is pressed, and sends the stopped job again after the search", async () => {
      rows = Array.from({ length: 2500 }, (_, i) => due(`c${String(i)}`));
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      let freed = false;
      const yielding = service.yieldLane().then(() => {
        freed = true;
      });
      expect(lane.stops).toBe(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(freed).toBe(false);
      lane.finish(plainEnd({ state: "stopped" }));
      await yielding;
      expect(freed).toBe(true);
      // The search takes the lane; the sweep waits for it.
      lane.running = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toHaveLength(1);
      lane.running = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(lane.starts[1]?.job).toEqual(lane.starts[0]?.job);
      lane.finish(swept(sweepMax));
      await vi.advanceTimersByTimeAsync(0);
      expect(sweptChannels(lane.starts[2])).toHaveLength(500);
    });

    it("frees the lane at once when it is running nothing", async () => {
      await expect(service.yieldLane()).resolves.toBeUndefined();
      expect(lane.stops).toBe(0);
    });

    it("stops the pass when a job fails, and logs the kind only", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      rows = Array.from({ length: 2500 }, (_, i) => due(`c${String(i)}`));
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(plainEnd({ state: "failed", error: { code: "crash", message: "@c1 broke" } }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toHaveLength(1);
      expect(logged).toHaveBeenCalledWith("Archive: a sweep failed (crash).");
      expect(JSON.stringify(logged.mock.calls)).not.toContain("@c1");
      // The next request sweeps again.
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toHaveLength(2);
    });

    it("sweeps shortly after start, then every hour, and not after dispose", async () => {
      rows = [due("a")];
      await vi.advanceTimersByTimeAsync(29_999);
      expect(lane.starts).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(lane.starts).toHaveLength(1);
      lane.finish(swept(1));
      await vi.advanceTimersByTimeAsync(3_600_000 - 30_000);
      expect(lane.starts).toHaveLength(2);
      lane.finish(swept(1));
      service.dispose();
      await vi.advanceTimersByTimeAsync(3 * 3_600_000);
      expect(lane.starts).toHaveLength(2);
    });

    it("lets a pass waiting on the lane go on dispose", async () => {
      rows = [due("a")];
      lane.running = true;
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      service.dispose();
      lane.running = false;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toEqual([]);
    });
  });

  describe("bringing channels back", () => {
    const a = channelId("a");
    const b = channelId("b");

    it("answers busy at once during a search, and starts nothing", async () => {
      lane.running = true;
      searching = true;
      expect(await service.restore([a])).toEqual({ ok: false, problem: "busy" });
      expect(lane.starts).toEqual([]);
    });

    it("waits for the finder, then restores and refetches the handles on live data", async () => {
      lane.running = true;
      const answer = service.restore([a, b]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lane.starts).toEqual([]);
      lane.running = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(lane.starts[0]?.job).toEqual({ kind: "archive.restore", channelIds: [a, b] });
      lane.finish(
        restoredExit([
          { channelId: a, handle: "@ai_tools" },
          { channelId: b, handle: null },
        ]),
      );
      const result = await answer;
      expect(result).toEqual({ ok: true, restored: 2, refetch: true });
      expect(channels["toolbox:restore"].response.safeParse(result).success).toBe(true);
      expect(changed).toBe(1);
      await vi.advanceTimersByTimeAsync(0);
      const refetch = lane.starts[1];
      expect(refetch?.source).toBe("live");
      // No auto-clean; the key goes in the start message only; no mail settings.
      expect(refetch?.job).toEqual({ kind: "refetch", handles: ["@ai_tools"], autoClean: null });
      expect(refetch?.secrets.youtubeKey).toBe(exampleKey);
      expect(refetch?.settings.mail).toBeUndefined();
      lane.finish(plainEnd());
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toBe(2);
    });

    it("answers busy when the lane stays taken for 60 s", async () => {
      lane.running = true;
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await answer).toEqual({ ok: false, problem: "busy" });
      lane.running = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(lane.starts).toEqual([]);
    });

    it("answers busy when a search takes the lane while it waits", async () => {
      lane.running = true;
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(2000);
      searching = true;
      await vi.advanceTimersByTimeAsync(1000);
      expect(await answer).toEqual({ ok: false, problem: "busy" });
    });

    it("goes before the sweep's next job", async () => {
      rows = Array.from({ length: 2500 }, (_, i) => due(`c${String(i)}`));
      service.sweep();
      await vi.advanceTimersByTimeAsync(0);
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(swept(sweepMax));
      await vi.advanceTimersByTimeAsync(1000);
      expect(lane.starts[1]?.job.kind).toBe("archive.restore");
      lane.finish(restoredExit([{ channelId: a, handle: null }]));
      expect(await answer).toEqual({ ok: true, restored: 1, refetch: false });
      await vi.advanceTimersByTimeAsync(5000);
      expect(sweptChannels(lane.starts[2])).toHaveLength(500);
    });

    it("refetches 50 handles a job, skipping a tombstone with no usable handle", async () => {
      const restored = Array.from({ length: 125 }, (_, i) => ({
        channelId: channelId(`r${String(i)}`),
        handle: i === 3 ? null : `@r${String(i)}`,
      }));
      const answer = service.restore(restored.map((r) => r.channelId));
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(restoredExit(restored));
      expect(await answer).toEqual({ ok: true, restored: 125, refetch: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[1])).toHaveLength(refetchMax);
      expect(handlesOf(lane.starts[1])).not.toContain("@r3");
      lane.finish(plainEnd());
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[2])).toHaveLength(refetchMax);
      lane.finish(plainEnd());
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[3])).toEqual(restored.slice(101).map((r) => r.handle));
      lane.finish(plainEnd());
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts).toHaveLength(4);
    });

    it("the refetch gives way to a search, and does the channels it hadn't reached after", async () => {
      const answer = service.restore([a, b]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(
        restoredExit([
          { channelId: a, handle: "@a" },
          { channelId: b, handle: "@b" },
        ]),
      );
      await answer;
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[1])).toEqual(["@a", "@b"]);
      lane.send(reached(a));
      const yielding = service.yieldLane();
      expect(lane.stops).toBe(1);
      lane.finish(plainEnd({ state: "stopped" }));
      await yielding;
      lane.running = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toHaveLength(2);
      lane.running = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(handlesOf(lane.starts[2])).toEqual(["@b"]);
    });

    it("has no refetch on the example data", async () => {
      context = { source: "example", dataDir: "C:\\data\\example-pipeline", worker: "example" };
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      expect(lane.starts[0]?.source).toBe("example");
      lane.finish(restoredExit([{ channelId: a, handle: "@ai_tools" }]));
      expect(await answer).toEqual({ ok: true, restored: 1, refetch: false });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toHaveLength(1);
    });

    it("answers no_python when the job can't start for lack of Python", async () => {
      lane.problem = "no_python";
      expect(await service.restore([a])).toEqual({ ok: false, problem: "no_python" });
    });

    it("lets a restore that waits for the lane end, not stop, when Start is pressed", async () => {
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      const yielding = service.yieldLane();
      expect(lane.stops).toBe(0);
      lane.finish(restoredExit([{ channelId: a, handle: "@a" }]));
      await yielding;
      expect(await answer).toEqual({ ok: true, restored: 1, refetch: true });
      // The search goes first: the refetch waits a retry before it looks at the lane.
      lane.running = true;
      await vi.advanceTimersByTimeAsync(5000);
      expect(lane.starts).toHaveLength(1);
    });

    it("answers failed when the restore job fails or is stopped, and logs the kind only", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish({ kind: "failed", reason: "crash" });
      const failed = await answer;
      expect(failed).toEqual({ ok: false, problem: "failed" });
      expect(channels["toolbox:restore"].response.safeParse(failed).success).toBe(true);
      expect(logged).toHaveBeenCalledWith("Archive: a restore failed (crash).");
      // Signing out stops the job.
      const stopped = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(plainEnd({ state: "stopped" }));
      expect(await stopped).toEqual({ ok: false, problem: "failed" });
    });

    it("answers failed when the start message fails its schema, and the lane is free after", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const start = lane.start.bind(lane);
      lane.start = () => {
        throw new Error("the start message failed its schema");
      };
      expect(await service.restore([a])).toEqual({ ok: false, problem: "failed" });
      lane.start = start;
      const again = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(restoredExit([{ channelId: a, handle: null }]));
      expect(await again).toEqual({ ok: true, restored: 1, refetch: false });
    });

    it("throws only when a done job has no restore result", async () => {
      const answer = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(plainEnd());
      await expect(answer).rejects.toThrow("Archive: a restore ended with no result.");
    });

    it("refetches a handle two restored channels share once", async () => {
      const answer = service.restore([a, b]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(
        restoredExit([
          { channelId: a, handle: "@ai_tools" },
          { channelId: b, handle: "@ai_tools" },
        ]),
      );
      await answer;
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[1])).toEqual(["@ai_tools"]);
      lane.finish(plainEnd());
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lane.starts).toHaveLength(2);
    });

    it("skips a channel brought back whose handle already waits for a refetch", async () => {
      const first = service.restore([a]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(restoredExit([{ channelId: a, handle: "@ai_tools" }]));
      await first;
      await vi.advanceTimersByTimeAsync(0);
      expect(handlesOf(lane.starts[1])).toEqual(["@ai_tools"]);
      // While that refetch runs, another channel with the same handle is brought back.
      const yielding = service.yieldLane();
      lane.finish(plainEnd({ state: "stopped" }));
      await yielding;
      const second = service.restore([b]);
      await vi.advanceTimersByTimeAsync(0);
      lane.finish(restoredExit([{ channelId: b, handle: "@ai_tools" }]));
      await second;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(handlesOf(lane.starts[3])).toEqual(["@ai_tools"]);
    });
  });
});
