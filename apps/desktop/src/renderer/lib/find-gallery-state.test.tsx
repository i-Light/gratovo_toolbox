// @vitest-environment happy-dom
import { emptyFacets, emptyFindFilter, type FindFilter, type FindSort } from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearFilter,
  filterIsActive,
  galleryPageSize,
  patchGalleryFilter,
  setGalleryShow,
  setGallerySize,
  setGallerySort,
  setGalleryView,
  toggleIn,
  useGalleryFilter,
  useGalleryPages,
  useGalleryShow,
  useGallerySize,
  useGallerySort,
  useGalleryView,
} from "./find-gallery-state";
import { aiChannel, stubFindBridge } from "./find-test-bridge";
import { initPrefs, prefsKey } from "./prefs";
import { resetAppStoreForTests } from "./store";

/** 130 AI channels: one full page and ten more. Half are in the US, the rest in GB. */
const channels = Array.from({ length: 130 }, (_, i) =>
  aiChannel(`UC-${String(i)}`, `Channel ${String(i)}`, {
    country: i % 2 === 0 ? "US" : "GB",
    medianViews: 200_000 - i * 1000,
  }),
);

interface Asked {
  readonly offset: number;
  readonly limit: number;
  readonly facets?: boolean;
  readonly sort?: string;
}

/** The catalog questions the stub saw, in order. */
function queries(calls: [string, unknown][]): Asked[] {
  return calls.filter(([channel]) => channel === "find:query").map(([, input]) => input as Asked);
}

/** Makes the stub answer like main: facets are zeros when the page did not ask for them. */
function answerLikeMain(): void {
  const bridge = (window as unknown as { gratovo: Bridge }).gratovo;
  const inner = bridge.invoke as unknown as (c: string, i: unknown) => Promise<unknown>;
  (window as unknown as { gratovo: Bridge }).gratovo = {
    ...bridge,
    invoke: (async (channel: string, input: unknown) => {
      const out = (await inner(channel, input)) as { ok: boolean; value?: object };
      if (channel === "find:query" && (input as Asked).facets === false && out.ok) {
        return { ok: true, value: { ...out.value, facets: emptyFacets } };
      }
      return out;
    }) as unknown as Bridge["invoke"],
  };
}

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "find", tab: "gallery" });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  initPrefs();
});

function usePrefsView() {
  return {
    filter: useGalleryFilter(),
    sort: useGallerySort(),
    view: useGalleryView(),
    size: useGallerySize(),
    show: useGalleryShow(),
  };
}

describe("the gallery device prefs", () => {
  it("start at the defaults", () => {
    const { result } = renderHook(usePrefsView);
    expect(result.current).toEqual({
      filter: emptyFindFilter,
      sort: "fit",
      view: "gallery",
      size: "m",
      show: { pics: true, latest: true, signals: true },
    });
  });

  it("change through the setters, save, and come back after a restart", () => {
    const { result } = renderHook(usePrefsView);
    act(() => {
      patchGalleryFilter({ stages: ["new"], q: "agents" });
      setGallerySort("median");
      setGalleryView("table");
      setGallerySize("l");
      setGalleryShow("pics", false);
      setGalleryShow("signals", false);
    });
    expect(result.current.filter).toEqual({ ...emptyFindFilter, stages: ["new"], q: "agents" });
    expect(result.current.sort).toBe("median");
    expect(result.current.view).toBe("table");
    expect(result.current.size).toBe("l");
    expect(result.current.show).toEqual({ pics: false, latest: true, signals: false });
    expect(filterIsActive(result.current.filter)).toBe(true);

    act(() => {
      initPrefs();
    });
    expect(result.current.sort).toBe("median");
    expect(result.current.filter.q).toBe("agents");

    act(() => {
      clearFilter();
    });
    expect(result.current.filter).toEqual(emptyFindFilter);
    expect(filterIsActive(result.current.filter)).toBe(false);
  });

  it("fall back to the default when the stored value is bad", () => {
    localStorage.setItem(
      prefsKey,
      JSON.stringify({ findSort: "triage", findView: "cards", findFilter: { stages: 3 } }),
    );
    initPrefs();
    const { result } = renderHook(usePrefsView);
    expect(result.current.filter).toEqual(emptyFindFilter);
    expect(result.current.sort).toBe("fit");
    expect(result.current.view).toBe("gallery");
  });

  it("toggleIn adds and takes out", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("useGalleryPages", () => {
  it("loads a page of 120, then adds the next when asked", async () => {
    const calls = stubFindBridge({ items: channels });
    answerLikeMain();
    const { result } = renderHook(() => useGalleryPages(emptyFindFilter, "fit"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.items).toHaveLength(galleryPageSize);
    expect(result.current.total).toBe(130);
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(130);
    });
    expect(result.current.hasMore).toBe(false);
    expect(result.current.status).toBe("ready");
    expect(new Set(result.current.items.map((i) => i.id)).size).toBe(130);
    expect(queries(calls).map((q) => [q.offset, q.limit, q.facets])).toEqual([
      [0, 120, true],
      [120, 120, false],
    ]);
  });

  it("keeps the first page facets while later pages load", async () => {
    stubFindBridge({ items: channels });
    answerLikeMain();
    const { result } = renderHook(() => useGalleryPages(emptyFindFilter, "fit"));
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.facets.countries).toEqual({ US: 65, GB: 65 });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(130);
    });
    expect(result.current.facets.countries).toEqual({ US: 65, GB: 65 });
  });

  it("starts again at the first page when the filter or the sort changes", async () => {
    const calls = stubFindBridge({ items: channels });
    answerLikeMain();
    const { result, rerender } = renderHook(
      (props: { filter: FindFilter; sort: FindSort }) => useGalleryPages(props.filter, props.sort),
      { initialProps: { filter: emptyFindFilter, sort: "fit" } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(130);
    });

    rerender({ filter: { ...emptyFindFilter, countries: ["GB"] }, sort: "fit" });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.status).toBe("loading");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.items).toHaveLength(65);
    expect(result.current.hasMore).toBe(false);
    expect(queries(calls).at(-1)).toMatchObject({ offset: 0, facets: true });

    rerender({ filter: { ...emptyFindFilter, countries: ["GB"] }, sort: "median" });
    await waitFor(() => {
      expect(queries(calls).at(-1)).toMatchObject({ offset: 0, sort: "median" });
    });
  });

  it("ignores loadMore when there is nothing more", async () => {
    const calls = stubFindBridge({ items: channels.slice(0, 5) });
    const { result } = renderHook(() => useGalleryPages(emptyFindFilter, "fit"));
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.hasMore).toBe(false);
    act(() => {
      result.current.loadMore();
    });
    expect(queries(calls)).toHaveLength(1);
  });
});
