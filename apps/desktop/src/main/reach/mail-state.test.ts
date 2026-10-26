import type { DataSource, MailboxCounts } from "@gratovo/core/data";
import { limitedCap } from "@gratovo/core/reach";
import { describe, expect, it, vi } from "vitest";

import type { JobOutcome } from "../pipeline/jobs";
import type { ResultData } from "../pipeline/protocol";

import { createMailState, localMidnight, warmupDay, type MailStateDeps } from "./mail-state";

// Noon on 2026-10-25, local time.
const clock = new Date(2026, 9, 25, 12, 0, 0).getTime();
const dayMs = 86_400_000;

type Account = ResultData<"mail.status">["accounts"][number];

function isoDay(daysAgo: number): string {
  const d = new Date(2026, 9, 25 - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Fake {
  source: DataSource;
  /** The local settings as written. */
  settings: Map<string, unknown>;
  write: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
}

function fakeSource(
  mailboxes: { address: string; dailyCap: number; warmupStartedOn: string | null }[],
  sent: { mailbox: string; count: number }[] = [],
  counts: Record<string, MailboxCounts> = {},
  flags?: unknown,
): Fake {
  const sentSince = vi.fn((since: number) => {
    expect(since).toBe(localMidnight(clock));
    return sent;
  });
  const settings = new Map<string, unknown>([
    ["mail.settings", { label: "Gratovo Outreach", senderName: null, mailboxes }],
  ]);
  if (flags !== undefined) {
    settings.set("reach.mailboxes", flags);
  }
  const write = vi.fn(() => Promise.resolve());
  const commit = vi.fn();
  const fake = {
    readSetting: (key: string) => settings.get(key),
    writeSetting: (key: string, value: unknown) => settings.set(key, value),
    write,
    outreach: { sentSince, mailboxCounts: () => new Map(Object.entries(counts)), commit },
  };
  return { source: fake as unknown as DataSource, settings, write, commit };
}

function source(
  mailboxes: { address: string; dailyCap: number; warmupStartedOn: string | null }[],
  sent: { mailbox: string; count: number }[] = [],
): DataSource {
  return fakeSource(mailboxes, sent).source;
}

function account(address: string, over: Partial<Account> = {}): Account {
  return {
    account: address,
    connected: true,
    counters: null,
    limits: { dailyCap: 30, warmupStartedOn: null, sentToday: 0, leftToday: 30 },
    lastSweepAt: null,
    error: null,
    ...over,
  };
}

function status(accounts: Account[]): JobOutcome {
  return {
    ok: true,
    replies: [],
    exit: {
      kind: "ended",
      end: { type: "end", state: "done", at: 0, found: 0, kept: 0 },
      result: {
        type: "result",
        kind: "mail.status",
        data: { configured: true, label: "Gratovo Outreach", senderName: null, accounts },
      },
    },
  };
}

function setup(over: Partial<MailStateDeps> = {}) {
  const runStatus = vi.fn<MailStateDeps["runStatus"]>(() => Promise.resolve(status([])));
  const deps: MailStateDeps = {
    mode: () => "live",
    source: () => null,
    runStatus,
    connected: () => Promise.resolve([]),
    now: () => clock,
    log: () => undefined,
    ...over,
  };
  return { state: createMailState(deps), runStatus };
}

describe("warm-up", () => {
  it("counts the start date as day 1 and ends after 30 days", () => {
    expect(warmupDay(isoDay(0), clock)).toBe(1);
    expect(warmupDay(isoDay(29), clock)).toBe(30);
    expect(warmupDay(isoDay(30), clock)).toBeNull();
    expect(warmupDay(null, clock)).toBeNull();
    expect(warmupDay(isoDay(-2), clock)).toBeNull();
  });
});

describe("the mailbox views", () => {
  it("builds each view from the settings, the last status and the app's own count", async () => {
    const src = source(
      [
        { address: "kai@gratovo.ai", dailyCap: 30, warmupStartedOn: null },
        { address: "lina@gratovo.ai", dailyCap: 40, warmupStartedOn: isoDay(4) },
        { address: "omar@gratovo.ai", dailyCap: 25, warmupStartedOn: null },
      ],
      [
        { mailbox: "Kai@Gratovo.ai", count: 6 },
        { mailbox: "lina@gratovo.ai", count: 2 },
      ],
    );
    const runStatus = vi.fn(() =>
      Promise.resolve(
        status([
          account("kai@gratovo.ai", {
            limits: { dailyCap: 30, warmupStartedOn: null, sentToday: 4, leftToday: 26 },
          }),
          account("lina@gratovo.ai", {
            limits: { dailyCap: 40, warmupStartedOn: isoDay(4), sentToday: 9, leftToday: 31 },
          }),
        ]),
      ),
    );
    const { state } = setup({
      source: () => src,
      runStatus,
      connected: () => Promise.resolve(["kai@gratovo.ai", "LINA@gratovo.ai"]),
    });
    await expect(state.refresh()).resolves.toBe("ok");
    const [kai, lina, omar] = state.views();
    // Ours (6) is newer than Gmail's (4): the larger wins.
    expect(kai).toMatchObject({
      connected: true,
      signedOut: false,
      dailyCap: 30,
      effectiveCap: 30,
      sentToday: 6,
      leftToday: 24,
      warmup: null,
      status: "good",
      paused: false,
      bounceRate: null,
      replyRate: null,
      checkedAt: clock,
    });
    // Warming: the cap is at most 20, and Gmail's count (9) is the larger.
    expect(lina).toMatchObject({
      connected: true,
      effectiveCap: limitedCap,
      sentToday: 9,
      leftToday: 11,
      warmup: { day: 5, of: 30 },
      status: "warming",
    });
    // No token stored: not connected, never checked.
    expect(omar).toMatchObject({ connected: false, checkedAt: null, leftToday: 25 });
  });

  it("shows a mailbox whose token Gmail refused as signed out", async () => {
    const src = source([{ address: "kai@gratovo.ai", dailyCap: 20, warmupStartedOn: isoDay(1) }]);
    const { state } = setup({
      source: () => src,
      connected: () => Promise.resolve(["kai@gratovo.ai"]),
      runStatus: () =>
        Promise.resolve(
          status([
            account("kai@gratovo.ai", {
              limits: null,
              error: { code: "mail_auth", message: "Reconnect the mailbox in Settings." },
            }),
          ]),
        ),
    });
    await state.refresh();
    expect(state.views()[0]).toMatchObject({ signedOut: true, status: "signed_out" });
  });

  it("keeps the cap from the settings when it is under the warm-up cap", () => {
    const src = source([{ address: "kai@gratovo.ai", dailyCap: 10, warmupStartedOn: isoDay(0) }]);
    const { state } = setup({ source: () => src });
    expect(state.views()[0]).toMatchObject({ effectiveCap: 10, status: "warming" });
  });

  it("lists every example mailbox as connected, with the app's own counts and no job", async () => {
    const src = source(
      [
        { address: "kai@gratovo.ai", dailyCap: 30, warmupStartedOn: null },
        { address: "lina@gratovo.ai", dailyCap: 30, warmupStartedOn: null },
      ],
      [{ mailbox: "kai@gratovo.ai", count: 3 }],
    );
    const connected = vi.fn(() => Promise.resolve([]));
    const { state, runStatus } = setup({ source: () => src, mode: () => "example", connected });
    await expect(state.refresh()).resolves.toBe("ok");
    state.afterSend();
    expect(runStatus).not.toHaveBeenCalled();
    expect(connected).not.toHaveBeenCalled();
    expect(state.views().map((v) => [v.connected, v.sentToday, v.leftToday])).toEqual([
      [true, 3, 27],
      [true, 0, 30],
    ]);
  });

  it("is empty with no data open", () => {
    const { state } = setup({ mode: () => null });
    expect(state.views()).toEqual([]);
  });
});

describe("refresh", () => {
  const one = [{ address: "kai@gratovo.ai", dailyCap: 30, warmupStartedOn: null }];

  it("answers no_data with no source, and no_mail with no mailbox or no token", async () => {
    await expect(setup().state.refresh()).resolves.toBe("no_data");
    const empty = source([]);
    await expect(setup({ source: () => empty }).state.refresh()).resolves.toBe("no_mail");
    const src = source(one);
    const { state, runStatus } = setup({ source: () => src });
    await expect(state.refresh()).resolves.toBe("no_mail");
    expect(runStatus).not.toHaveBeenCalled();
  });

  it("answers no_mail when the job says no mailbox is connected", async () => {
    const src = source(one);
    const { state } = setup({
      source: () => src,
      connected: () => Promise.resolve(["kai@gratovo.ai"]),
      runStatus: () =>
        Promise.resolve({
          ok: true,
          replies: [],
          exit: {
            kind: "ended",
            end: {
              type: "end",
              state: "failed",
              at: 0,
              found: 0,
              kept: 0,
              error: { code: "mail_not_connected", message: "No Gmail client." },
            },
            result: null,
          },
        }),
    });
    await expect(state.refresh()).resolves.toBe("no_mail");
  });

  it("runs one status at a time", async () => {
    const src = source(one);
    let finish!: (outcome: JobOutcome) => void;
    const runStatus = vi.fn(
      () =>
        new Promise<JobOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const { state } = setup({
      source: () => src,
      runStatus,
      connected: () => Promise.resolve(["kai@gratovo.ai"]),
    });
    const first = state.refresh();
    await expect(state.refresh()).resolves.toBe("busy");
    await vi.waitFor(() => {
      expect(runStatus).toHaveBeenCalledTimes(1);
    });
    finish(status([account("kai@gratovo.ai")]));
    await expect(first).resolves.toBe("ok");
    expect(runStatus).toHaveBeenCalledTimes(1);
  });

  it("reads again after a send, once the status already running ends", async () => {
    const src = source(one);
    const finishes: ((outcome: JobOutcome) => void)[] = [];
    const runStatus = vi.fn(
      () =>
        new Promise<JobOutcome>((resolve) => {
          finishes.push(resolve);
        }),
    );
    const { state } = setup({
      source: () => src,
      runStatus,
      connected: () => Promise.resolve(["kai@gratovo.ai"]),
    });
    const first = state.refresh();
    state.afterSend();
    await vi.waitFor(() => {
      expect(runStatus).toHaveBeenCalledTimes(1);
    });
    finishes[0]?.(status([account("kai@gratovo.ai")]));
    await first;
    await vi.waitFor(() => {
      expect(runStatus).toHaveBeenCalledTimes(2);
    });
    finishes[1]?.(status([account("kai@gratovo.ai")]));
  });

  it("keeps the last numbers when a check fails", async () => {
    const src = source(one);
    const answers: JobOutcome[] = [
      status([
        account("kai@gratovo.ai", {
          limits: { dailyCap: 30, warmupStartedOn: null, sentToday: 7, leftToday: 23 },
        }),
      ]),
      { ok: false, problem: "no_python" },
      { ok: true, replies: [], exit: { kind: "failed", reason: "crash" } },
    ];
    let at = clock;
    const { state } = setup({
      source: () => src,
      now: () => at,
      runStatus: () => Promise.resolve(answers.shift() ?? status([])),
      connected: () => Promise.resolve(["kai@gratovo.ai"]),
    });
    await state.refresh();
    at += 60_000;
    await expect(state.refresh()).resolves.toBe("ok");
    await expect(state.refresh()).resolves.toBe("ok");
    expect(state.views()[0]).toMatchObject({ sentToday: 7, checkedAt: clock });
    expect(at - clock).toBeLessThan(dayMs);
  });
});

describe("pause, slowdown and the rates", () => {
  const open = { address: "outreach3@gratovo.example", dailyCap: 30, warmupStartedOn: null };
  const counts = (sent7: number, bounced7: number, firsts30 = 0, replied30 = 0) => ({
    "outreach3@gratovo.example": { sent7, bounced7, firsts30, replied30 },
  });

  it("reads the pause and the slowdown from the setting and shows both rates", () => {
    const fake = fakeSource([open], [], counts(40, 1, 20, 3), {
      "outreach3@gratovo.example": { paused: true, slowed: true },
    });
    const { state } = setup({ source: () => fake.source, mode: () => "example" });
    expect(state.views()[0]).toMatchObject({
      paused: true,
      status: "paused",
      effectiveCap: limitedCap,
      leftToday: limitedCap,
      bounceRate: 2.5,
      replyRate: 15,
    });
  });

  it("falls back to not paused and not slowed on a bad setting", () => {
    for (const bad of ["x", 7, null, [1], { "outreach3@gratovo.example": {} }]) {
      const fake = fakeSource([open], [], {}, bad);
      const { state } = setup({ source: () => fake.source, mode: () => "example" });
      expect(state.views()[0]).toMatchObject({ paused: false, status: "good", effectiveCap: 30 });
    }
  });

  it("reads a damaged entry of one mailbox as paused: the safe side, one click to resume", () => {
    for (const bad of ["no", 7, { paused: "yes" }]) {
      const fake = fakeSource([open], [], {}, { "outreach3@gratovo.example": bad });
      const { state } = setup({ source: () => fake.source, mode: () => "example" });
      expect(state.views()[0]).toMatchObject({ paused: true, status: "paused" });
    }
  });

  it("slows a mailbox over 3% once, writes the setting and one log line", async () => {
    const fake = fakeSource([open], [], counts(31, 1));
    const { state } = setup({
      source: () => fake.source,
      mode: () => "example",
      newId: () => "log-1",
    });
    await state.refresh();
    expect(fake.settings.get("reach.mailboxes")).toEqual({
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
    expect(fake.write).toHaveBeenCalledTimes(1);
    expect(fake.write).toHaveBeenCalledWith([
      {
        kind: "log.add",
        id: "log-1",
        at: clock,
        text: "outreach3 slowed to 20 sends a day: 3.2% bounced this week",
        ref: null,
        action: null,
        detail: null,
      },
    ]);
    expect(state.views()[0]).toMatchObject({ status: "slowed", effectiveCap: 20 });
    // The state did not change, so a second refresh writes nothing.
    await state.refresh();
    expect(fake.write).toHaveBeenCalledTimes(1);
  });

  it("also tells the person: one notification when it slows, none when it recovers", async () => {
    const fake = fakeSource([open], [], counts(31, 1));
    const notified = vi.fn();
    const { state } = setup({
      source: () => fake.source,
      mode: () => "example",
      newId: () => "n-1",
      notified,
    });
    await state.refresh();
    expect(fake.commit).toHaveBeenCalledTimes(1);
    expect(fake.commit).toHaveBeenCalledWith({
      at: clock,
      notifications: [
        {
          id: "slowed-n-1",
          at: clock,
          icon: "alert",
          text: "outreach3 slowed to 20 sends a day",
          sub: "3.2% bounced this week",
          go: { screen: "reach", tab: "mailboxes" },
          read: false,
        },
      ],
    });
    expect(notified).toHaveBeenCalledTimes(1);
    // Nothing changed: no second notification.
    await state.refresh();
    expect(fake.commit).toHaveBeenCalledTimes(1);
    // Recovering is told in the log only.
    const better = fakeSource([open], [], counts(60, 1), {
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
    const again = setup({ source: () => better.source, mode: () => "example", notified });
    await again.state.refresh();
    expect(better.write).toHaveBeenCalled();
    expect(better.commit).not.toHaveBeenCalled();
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("keeps the slowdown when its notification can't be stored", async () => {
    const fake = fakeSource([open], [], counts(31, 1));
    fake.commit.mockImplementation(() => {
      throw new Error("disk full");
    });
    const lines: string[] = [];
    const notified = vi.fn();
    const { state } = setup({
      source: () => fake.source,
      mode: () => "example",
      notified,
      log: (line) => lines.push(line),
    });
    await state.refresh();
    expect(fake.settings.get("reach.mailboxes")).toEqual({
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
    expect(notified).not.toHaveBeenCalled();
    expect(lines).toEqual(["Reach: the notice of a slowed mailbox couldn't be stored."]);
  });

  it("keeps a slowed mailbox slowed until bounces are under 2%, then says so", async () => {
    const flags = { "outreach3@gratovo.example": { paused: true, slowed: true } };
    const fake = fakeSource([open], [], counts(50, 1), flags);
    const { state } = setup({ source: () => fake.source, mode: () => "example" });
    // 2.0% is not under 2%.
    await state.refresh();
    expect(fake.write).not.toHaveBeenCalled();
    const better = fakeSource([open], [], counts(60, 1), flags);
    const again = setup({ source: () => better.source, mode: () => "example" });
    await again.state.refresh();
    expect(better.write).toHaveBeenCalledWith([
      expect.objectContaining({ text: "outreach3 is back to 30 sends a day" }),
    ]);
    // The pause stays as the owner set it.
    expect(better.settings.get("reach.mailboxes")).toEqual({
      "outreach3@gratovo.example": { paused: true, slowed: false },
    });
  });

  it("names the warm-up cap when a warming mailbox recovers", async () => {
    const started = new Date(clock - 5 * 86_400_000);
    const day = `${String(started.getFullYear())}-${String(started.getMonth() + 1).padStart(2, "0")}-${String(started.getDate()).padStart(2, "0")}`;
    const warming = { ...open, warmupStartedOn: day };
    const flags = { "outreach3@gratovo.example": { paused: false, slowed: true } };
    const fake = fakeSource([warming], [], counts(60, 1), flags);
    const { state } = setup({ source: () => fake.source, mode: () => "example" });
    await state.refresh();
    expect(fake.write).toHaveBeenCalledWith([
      expect.objectContaining({ text: "outreach3 is back to 20 sends a day" }),
    ]);
  });

  it("keeps the flag as it was when the log line can't be written, and tries again", async () => {
    const fake = fakeSource([open], [], counts(31, 1));
    fake.write.mockRejectedValueOnce(new Error("disk full"));
    const { state } = setup({ source: () => fake.source, mode: () => "example" });
    await state.refresh();
    expect(fake.settings.get("reach.mailboxes")).toBeUndefined();
    await state.refresh();
    expect(fake.write).toHaveBeenCalledTimes(2);
    expect(fake.settings.get("reach.mailboxes")).toEqual({
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
  });

  it("changes nothing when there are too few sends for a rate", async () => {
    const fake = fakeSource([open], [], counts(9, 9));
    const { state } = setup({ source: () => fake.source, mode: () => "example" });
    await state.refresh();
    expect(fake.write).not.toHaveBeenCalled();
    expect(state.views()[0]).toMatchObject({ bounceRate: null, status: "good" });
  });
});
