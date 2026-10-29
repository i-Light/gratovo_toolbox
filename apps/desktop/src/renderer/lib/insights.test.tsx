// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { overviewReport } from "../insights/test-reports";
import { goalReport } from "../insights/test-reports-search";
import { hideAlert, insightsList, setGoal, useInsightsReport } from "./insights";
import { resetAppStoreForTests } from "./store";

type Answer = { ok: true; value: unknown } | { ok: false; reason: string };
let pending: { tab: string; period: string; resolve: (a: Answer) => void }[] = [];
let listeners: (() => void)[] = [];

beforeEach(() => {
  resetAppStoreForTests({ screen: "insights", tab: "overview" });
  pending = [];
  listeners = [];
  (window as unknown as { gratovo: unknown }).gratovo = {
    invoke: (channel: string, input: unknown) => {
      if (channel === "insights:read") {
        const q = input as { tab: string; period: string };
        return new Promise<Answer>((resolve) => pending.push({ ...q, resolve }));
      }
      return Promise.resolve({ ok: true, value: { hidden: {} } });
    },
    on: (_event: string, handler: () => void) => {
      listeners.push(handler);
      return () => undefined;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

describe("useInsightsReport", () => {
  it("is loading, then ready; drops an answer for an old period", async () => {
    const { result, rerender } = renderHook(
      ({ period }: { period: "30d" | "7d" }) => useInsightsReport("overview", period),
      { initialProps: { period: "30d" } },
    );
    expect(result.current.status).toBe("loading");
    rerender({ period: "7d" });
    await flush();
    expect(pending.map((p) => p.period)).toEqual(["30d", "7d"]);
    act(() => {
      pending[1]?.resolve({ ok: true, value: overviewReport });
      pending[0]?.resolve({ ok: true, value: { ...overviewReport, hidden: 99 } });
    });
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.report).toEqual(overviewReport);
  });

  it("keeps the last report when a later read fails, and reads on find:catalog", async () => {
    const { result } = renderHook(() => useInsightsReport("overview", "30d"));
    act(() => {
      pending[0]?.resolve({ ok: true, value: overviewReport });
    });
    await flush();
    act(() => {
      for (const l of listeners) l();
    });
    await flush();
    expect(pending).toHaveLength(2);
    act(() => {
      pending[1]?.resolve({ ok: false, reason: "test" });
    });
    await flush();
    expect(result.current.status).toBe("failed");
    expect(result.current.report).toEqual(overviewReport);
  });

  it("does not show another tab's report", async () => {
    const { result, rerender } = renderHook(
      ({ tab }: { tab: "overview" | "goal" }) => useInsightsReport(tab, "30d"),
      { initialProps: { tab: "overview" } },
    );
    act(() => {
      pending[0]?.resolve({ ok: true, value: overviewReport });
    });
    await flush();
    rerender({ tab: "goal" });
    expect(result.current.report).toBeNull();
    await flush();
    act(() => {
      pending[1]?.resolve({ ok: true, value: goalReport() });
    });
    await flush();
    expect(result.current.report?.tab).toBe("goal");
  });

  it("reads again every 60 seconds", async () => {
    vi.useFakeTimers();
    renderHook(() => useInsightsReport("overview", "30d"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(pending).toHaveLength(2);
  });
});

describe("the Insights calls", () => {
  it("answer null or false when the call fails", async () => {
    (window as unknown as { gratovo: { invoke: unknown } }).gratovo.invoke = () =>
      Promise.reject(new Error("x"));
    expect(await insightsList({ kind: "fuel" }, "30d", 0)).toBeNull();
    expect(await hideAlert("k")).toBe(false);
    expect(await setGoal({ reset: true })).toBe(false);
  });
});
