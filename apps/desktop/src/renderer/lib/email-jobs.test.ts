import type { AppEventName, AppEventPayload } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emailJobStaysMs, installEmailJobs } from "./email-jobs";
import { appStore, resetAppStoreForTests } from "./store";

let fire: (event: AppEventPayload<"find:emails">) => void = () => undefined;
let stop: () => void = () => undefined;
const jobs = () => appStore().getState().ui.jobs;

beforeEach(() => {
  vi.useFakeTimers();
  resetAppStoreForTests({ screen: "find", tab: "search" });
  stop = installEmailJobs({
    on: <E extends AppEventName>(name: E, listener: (payload: AppEventPayload<E>) => void) => {
      expect(name).toBe("find:emails");
      fire = listener as typeof fire;
      return () => undefined;
    },
  });
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("the email lookup in the jobs tray", () => {
  it("shows a running row, then a finished one that clears", () => {
    fire({
      state: "running",
      channels: 3,
      found: 0,
      label: "Finding emails for 3 channels",
      detail: null,
    });
    expect(jobs()).toEqual([
      expect.objectContaining({
        kind: "contacts",
        label: "Finding emails for 3 channels",
        done: false,
      }),
    ]);
    fire({ state: "done", channels: 3, found: 2, label: "2 emails found", detail: null });
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ label: "2 emails found", done: true });
    expect(jobs()[0]?.failed).toBeUndefined();
    vi.advanceTimersByTime(emailJobStaysMs);
    expect(jobs()).toEqual([]);
  });

  it("shows why a lookup failed", () => {
    fire({
      state: "failed",
      channels: 2,
      found: 0,
      label: "Couldn’t look up emails",
      detail: "Offline.",
    });
    expect(jobs()[0]).toMatchObject({ done: true, failed: true, note: "Offline." });
  });

  it("a new lookup replaces the finished row and cancels its clearing", () => {
    fire({ state: "done", channels: 1, found: 1, label: "1 email found", detail: null });
    fire({
      state: "running",
      channels: 2,
      found: 0,
      label: "Finding emails for 2 channels",
      detail: null,
    });
    vi.advanceTimersByTime(emailJobStaysMs);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]?.done).toBe(false);
  });
});
