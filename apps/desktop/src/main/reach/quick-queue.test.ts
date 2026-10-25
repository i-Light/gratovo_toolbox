import { describe, expect, it, vi } from "vitest";

import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";

import { createQuickQueue, quickRetryMs } from "./quick-queue";

const start = (worker: string): Start =>
  ({ type: "start", worker, job: { kind: "mail.status" } }) as unknown as Start;

const done: JobOutcome = {
  ok: true,
  exit: { kind: "failed", reason: "crash" },
  replies: [],
};
const running: JobOutcome = { ok: false, problem: "running" };
const noPython: JobOutcome = { ok: false, problem: "no_python" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("the quick queue", () => {
  it("runs jobs one at a time, in the order they came", async () => {
    const order: string[] = [];
    const gates = [deferred<JobOutcome>(), deferred<JobOutcome>()];
    const run = vi.fn((s: Start) => {
      order.push(s.worker);
      return gates[order.length - 1]?.promise ?? Promise.resolve(done);
    });
    const queue = createQuickQueue({ run });
    const first = queue.enqueue(start("a"));
    const second = queue.enqueue(start("b"));
    const third = queue.enqueue(start("c"));
    await Promise.resolve();
    expect(order).toEqual(["a"]);
    gates[0]?.resolve(done);
    await first;
    await vi.waitFor(() => {
      expect(order).toEqual(["a", "b"]);
    });
    gates[1]?.resolve(done);
    await expect(second).resolves.toBe(done);
    await expect(third).resolves.toBe(done);
    expect(order).toEqual(["a", "b", "c"]);
    await queue.idle();
  });

  it("waits while the lane runs someone else's job, and tries again until it starts", async () => {
    const answers = [running, running, running, done];
    const run = vi.fn(() => Promise.resolve(answers.shift() ?? done));
    const wait = vi.fn(() => Promise.resolve());
    const queue = createQuickQueue({ run, wait });
    await expect(queue.enqueue(start("send"))).resolves.toBe(done);
    expect(run).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(quickRetryMs);
  });

  it("keeps the order behind a job that waits on a busy lane", async () => {
    const order: string[] = [];
    let busy = 2;
    const run = vi.fn((s: Start) => {
      if (s.worker === "a" && busy > 0) {
        busy -= 1;
        return Promise.resolve(running);
      }
      order.push(s.worker);
      return Promise.resolve(done);
    });
    const queue = createQuickQueue({ run, retryMs: 5, wait: () => Promise.resolve() });
    const both = Promise.all([queue.enqueue(start("a")), queue.enqueue(start("b"))]);
    await both;
    expect(order).toEqual(["a", "b"]);
  });

  it("answers no_python as it is, without trying again", async () => {
    const run = vi.fn(() => Promise.resolve(noPython));
    const wait = vi.fn(() => Promise.resolve());
    const queue = createQuickQueue({ run, wait });
    await expect(queue.enqueue(start("a"))).resolves.toBe(noPython);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("goes on after a job whose run threw", async () => {
    const run = vi
      .fn<(s: Start) => Promise<JobOutcome>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(done);
    const queue = createQuickQueue({ run });
    await expect(queue.enqueue(start("a"))).rejects.toThrow("boom");
    await expect(queue.enqueue(start("b"))).resolves.toBe(done);
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});
