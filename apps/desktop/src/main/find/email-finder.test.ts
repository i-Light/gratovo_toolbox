import { findEmailsEventSchema, type FindEmailsEvent } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineMessage, Start } from "../pipeline/protocol";
import type { EndMessage, JobHandlers, PipelineExit } from "../pipeline/supervisor";
import { strings } from "../strings";

import type { FindCatalog } from "./catalog-types";
import {
  batchMax,
  catalogChannels,
  createEmailFinder,
  type EmailFinder,
  type FinderChannel,
} from "./email-finder";

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

const end = (over: Partial<EndMessage> = {}): PipelineExit => ({
  kind: "ended",
  end: { type: "end", state: "done", at: 0, found: 0, kept: 0, ...over },
  result: null,
});

const reached = (id: string): PipelineMessage => ({
  type: "channel",
  keyword: "__manual_refetch__",
  channelId: id,
  handle: `@${id}`,
  name: `Channel ${id}`,
  subscribers: 50_000,
  medianViews: 9_000,
  country: "US",
  outcome: "kept",
});

const handlesOf = (start: Start | undefined): string[] =>
  start?.job.kind === "refetch" ? start.job.handles : [];

describe("the email finder", () => {
  let lane: FakeLane;
  let live: boolean;
  let key: () => Promise<string | null>;
  let known: Map<string, FinderChannel>;
  let asked: string[][];
  let events: FindEmailsEvent[];
  let changed: number;
  let finder: EmailFinder;

  /** A shortlisted creator with no confirmed address, as the catalog has it. */
  function creator(id: string, over: Partial<FinderChannel> = {}): void {
    known.set(id, {
      id,
      handle: `@${id}`,
      stage: "shortlisted",
      confirmed: false,
      emails: [],
      ...over,
    });
  }

  function make(): EmailFinder {
    return createEmailFinder({
      supervisor: lane,
      liveContext: () => (live ? { dataDir: "C:\\data\\pipeline", worker: "user-1" } : null),
      youtubeKey: () => key(),
      routing: () => Promise.resolve({ proxyUrls: [], gatewayUrls: [] }),
      settings: () => ({
        pacing: "normal",
        mail: { label: "Gratovo", senderName: null, mailboxes: [] },
      }),
      channels: (ids) => {
        asked.push([...ids]);
        return Promise.resolve(ids.flatMap((id) => known.get(id) ?? []));
      },
      onPipelineChanged: () => {
        changed += 1;
      },
      emit: (event) => events.push(event),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    lane = fakeLane();
    live = true;
    key = () => Promise.resolve(exampleKey);
    known = new Map();
    asked = [];
    events = [];
    changed = 0;
    finder = make();
  });

  afterEach(() => {
    finder.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for 2 s of quiet, then refetches every creator shortlisted meanwhile in one job", async () => {
    creator("ch_a");
    creator("ch_b");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(1500);
    finder.shortlisted(["ch_b"]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(lane.starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(lane.starts).toHaveLength(1);
    const start = lane.starts[0];
    expect(start?.source).toBe("live");
    expect(start?.job).toEqual({ kind: "refetch", handles: ["@ch_a", "@ch_b"], autoClean: null });
    // The key goes in the start message only; the mail part of the settings is dropped.
    expect(start?.secrets.youtubeKey).toBe(exampleKey);
    expect(start?.settings.mail).toBeUndefined();
  });

  it("splits more than 50 creators into jobs of at most 50, one after another", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `ch_${String(i)}`);
    for (const id of ids) {
      creator(id);
    }
    finder.shortlisted(ids);
    await vi.advanceTimersByTimeAsync(2000);
    expect(handlesOf(lane.starts[0])).toHaveLength(batchMax);
    expect(events.at(-1)).toMatchObject({ state: "running", channels: 120 });
    lane.finish(end());
    await vi.advanceTimersByTimeAsync(0);
    expect(handlesOf(lane.starts[1])).toHaveLength(batchMax);
    lane.finish(end());
    await vi.advanceTimersByTimeAsync(0);
    expect(handlesOf(lane.starts[2])).toEqual(ids.slice(100).map((id) => `@${id}`));
    lane.finish(end());
    await vi.advanceTimersByTimeAsync(0);
    expect(lane.starts).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ state: "done", channels: 120, found: 0 });
  });

  it("skips creators with a confirmed address, no longer shortlisted, unknown or with no usable handle", async () => {
    creator("ch_ok");
    creator("ch_confirmed", { confirmed: true });
    creator("ch_undone", { stage: "new" });
    creator("ch_bad", { handle: "@名前" });
    finder.shortlisted(["ch_ok", "ch_confirmed", "ch_undone", "ch_bad", "ch_missing"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(handlesOf(lane.starts[0])).toEqual(["@ch_ok"]);
  });

  it("starts nothing and says nothing when every creator already has a confirmed address", async () => {
    creator("ch_a", { confirmed: true });
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(lane.starts).toEqual([]);
    expect(events).toEqual([]);
  });

  it("does nothing on the example data", async () => {
    live = false;
    creator("ch_a");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([]);
    expect(lane.starts).toEqual([]);
    expect(events).toEqual([]);
  });

  it("waits behind a search, trying the lane again every 5 s", async () => {
    creator("ch_a");
    lane.running = true;
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(lane.starts).toEqual([]);
    lane.running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(handlesOf(lane.starts[0])).toEqual(["@ch_a"]);
  });

  it("gives way to a search: stops, frees the lane, and does the channels it hadn't reached after", async () => {
    for (const id of ["ch_a", "ch_b", "ch_c"]) {
      creator(id);
    }
    finder.shortlisted(["ch_a", "ch_b", "ch_c"]);
    await vi.advanceTimersByTimeAsync(2000);
    lane.send(reached("ch_a"));
    let freed = false;
    const yielding = finder.yieldLane().then(() => {
      freed = true;
    });
    expect(lane.stops).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(freed).toBe(false);
    lane.finish(end({ state: "stopped" }));
    await yielding;
    expect(freed).toBe(true);
    // The search takes the lane; the finder keeps the tray's line and waits.
    lane.running = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(lane.starts).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ state: "running", channels: 3 });
    lane.running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(handlesOf(lane.starts[1])).toEqual(["@ch_b", "@ch_c"]);
  });

  it("frees the lane at once when it is running nothing", async () => {
    await expect(finder.yieldLane()).resolves.toBeUndefined();
    expect(lane.stops).toBe(0);
  });

  it("says how many channels it is looking at, then how many new addresses it found", async () => {
    creator("ch_a", { emails: ["old@aitools.example"] });
    creator("ch_b");
    finder.shortlisted(["ch_a", "ch_b"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toEqual([
      {
        state: "running",
        channels: 2,
        found: 0,
        label: "Finding emails for 2 channels",
        detail: null,
      },
    ]);
    // The refetch read the About texts again: one new address on a, two on b.
    creator("ch_a", { emails: ["OLD@aitools.example", "biz@aitools.example"] });
    creator("ch_b", { emails: ["hello@ainews.example", "team@ainews.example"] });
    lane.finish(end());
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toBe(1);
    expect(events.at(-1)).toEqual({
      state: "done",
      channels: 2,
      found: 3,
      label: strings.emailFinder.found(3),
      detail: null,
    });
    expect(events.at(-1)?.label).toBe("3 emails found");
    for (const event of events) {
      expect(findEmailsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("names the job's end code when a lookup fails, and logs the kind only", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    creator("ch_a");
    creator("ch_b");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    lane.finish(
      end({ state: "failed", error: { code: "quota", message: "Daily limit for @ch_a." } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toEqual({
      state: "failed",
      channels: 1,
      found: 0,
      label: "Couldn’t look up emails",
      detail: strings.emailFinder.problems["quota"],
    });
    expect(logged).toHaveBeenCalledWith("Email finder: a lookup failed (quota).");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("@ch_a");
    expect(changed).toBe(1);
  });

  it("fails without starting when there is no YouTube key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    key = () => Promise.resolve(null);
    creator("ch_a");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(lane.starts).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      state: "failed",
      detail: strings.emailFinder.problems["no_youtube_key"],
    });
  });

  it("calls a crash a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    creator("ch_a");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    lane.finish({ kind: "failed", reason: "crash" });
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({
      state: "failed",
      detail: strings.emailFinder.problems["crash"],
    });
  });

  it("a start that throws fails the lookup and leaves the finder working for the next shortlist", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(lane, "start").mockImplementationOnce(() => {
      throw new Error("spawn EPERM C:\\data\\pipeline");
    });
    creator("ch_a");
    creator("ch_b");
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events.at(-1)).toMatchObject({
      state: "failed",
      channels: 1,
      detail: strings.emailFinder.problems["crash"],
    });
    expect(logged).toHaveBeenCalledWith("Email finder: a lookup failed (crash).");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("EPERM");
    finder.shortlisted(["ch_b"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(handlesOf(lane.starts[0])).toEqual(["@ch_b"]);
  });

  it("lets the waiting creators go when the data closes", async () => {
    creator("ch_a");
    lane.running = true;
    finder.shortlisted(["ch_a"]);
    await vi.advanceTimersByTimeAsync(2000);
    live = false;
    lane.running = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(lane.starts).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe("catalogChannels", () => {
  it("pages through the shortlisted creators and keeps the named ones", async () => {
    const all = Array.from({ length: 130 }, (_, i) => ({
      id: `ch_${String(i)}`,
      handle: `@ch_${String(i)}`,
      stage: "shortlisted",
      emailConfirmed: i === 125,
      emails: [{ email: `team${String(i)}@aitools.example` }],
    }));
    const query = vi.fn((request: { offset: number; limit: number }) =>
      Promise.resolve({
        version: 1,
        total: all.length,
        items: all.slice(request.offset, request.offset + request.limit),
        facets: {},
      }),
    );
    const channels = catalogChannels({ query } as unknown as Pick<FindCatalog, "query">);
    expect(await channels(["ch_3", "ch_125", "ch_999"])).toEqual([
      {
        id: "ch_3",
        handle: "@ch_3",
        stage: "shortlisted",
        confirmed: false,
        emails: ["team3@aitools.example"],
      },
      {
        id: "ch_125",
        handle: "@ch_125",
        stage: "shortlisted",
        confirmed: true,
        emails: ["team125@aitools.example"],
      },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      filter: { stages: ["shortlisted"] },
      facets: false,
    });
  });
});
