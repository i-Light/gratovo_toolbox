// @vitest-environment happy-dom
import {
  emptyFacets,
  emptyFindFilter,
  type CatalogItem,
  type FindFilter,
} from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { undo } from "./actions";
import { ensureCreators, shortlist } from "./find-actions";
import { useCatalogItem, useCatalogQuery, useRuns } from "./find-catalog";
import { resetAppStoreForTests } from "./store";

function item(id: string, name: string): CatalogItem {
  return {
    id,
    name,
    handle: `@${name.toLowerCase()}`,
    pic: null,
    stage: "new",
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: 100_000,
    medianViews: 30_000,
    uploads30: 5,
    country: "US",
    sponsors: [],
    emails: [],
    latestUploadAt: null,
    foundAt: null,
    run: 1,
    keyword: "ai news",
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
  };
}

const fit = { score: 50, parts: [] };
const row = (i: CatalogItem) => ({ ...i, fit });
const filter: FindFilter = { ...emptyFindFilter, stages: ["new"] };
const params = { filter, sort: "triage" as const, offset: 0, limit: 50 };

interface Pending {
  readonly channel: string;
  readonly input: unknown;
  readonly answer: (value: unknown) => void;
}

let pending: Pending[] = [];
let listeners: ((p: { version: number }) => void)[] = [];

const fire = (version: number): void => {
  listeners.forEach((l) => {
    l({ version });
  });
};

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "triage" });
  pending = [];
  listeners = [];
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: ((channel: string, input: unknown) =>
      new Promise<unknown>((resolve) => {
        pending.push({
          channel,
          input,
          answer: (value) => {
            resolve({ ok: true, value });
          },
        });
      })) as Bridge["invoke"],
    on: ((_event: string, listener: (p: { version: number }) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    }) as Bridge["on"],
  };
});

afterEach(cleanup);

const result = (version: number, items: CatalogItem[]) => ({
  version,
  total: items.length,
  items: items.map(row),
  facets: emptyFacets,
});

async function answer(index: number, value: unknown): Promise<void> {
  await act(async () => {
    pending[index]?.answer(value);
    await Promise.resolve();
  });
}

describe("useCatalogQuery", () => {
  it("is loading, then ready with the items", async () => {
    const { result: out } = renderHook(() => useCatalogQuery(params));
    expect(out.current.status).toBe("loading");
    expect(pending[0]?.channel).toBe("find:query");
    await answer(0, result(1, [item("UC-a", "Ada")]));
    expect(out.current.status).toBe("ready");
    expect(out.current.items.map((i) => i.id)).toEqual(["UC-a"]);
    expect(out.current.version).toBe(1);
  });

  it("lays the creator state over an item and drops one that no longer passes", async () => {
    const { result: out } = renderHook(() => useCatalogQuery(params));
    await answer(0, result(1, [item("UC-a", "Ada"), item("UC-b", "Bo")]));
    expect(out.current.total).toBe(2);
    act(() => {
      shortlist([item("UC-a", "Ada")]);
    });
    expect(out.current.items.map((i) => i.id)).toEqual(["UC-b"]);
    expect(out.current.total).toBe(1);
  });

  it("shows the creator's stage on an item that still passes", async () => {
    const all = { ...params, filter: { ...filter, stages: ["new", "shortlisted"] as const } };
    const { result: out } = renderHook(() => useCatalogQuery(all));
    await answer(0, result(1, [item("UC-a", "Ada")]));
    act(() => {
      ensureCreators([item("UC-a", "Ada")]);
      shortlist([item("UC-a", "Ada")]);
    });
    expect(out.current.items[0]?.stage).toBe("shortlisted");
  });

  it("asks again when the catalog changes, and drops an older answer", async () => {
    const { result: out } = renderHook(() => useCatalogQuery(params));
    await answer(0, result(2, [item("UC-a", "Ada")]));
    act(() => {
      fire(3);
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    act(() => {
      fire(4);
    });
    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });
    await answer(2, result(4, [item("UC-c", "Cy")]));
    await answer(1, result(3, [item("UC-b", "Bo")]));
    expect(out.current.items.map((i) => i.id)).toEqual(["UC-c"]);
    expect(out.current.version).toBe(4);
  });

  it("goes back to loading when the request changes", async () => {
    const { result: out, rerender } = renderHook((p) => useCatalogQuery(p), {
      initialProps: params,
    });
    await answer(0, result(1, [item("UC-a", "Ada")]));
    rerender({ ...params, offset: 50 });
    expect(out.current.status).toBe("loading");
  });
});

describe("useCatalogItem and useRuns", () => {
  it("overlays the creator on the item and asks again on the event", async () => {
    const { result: out } = renderHook(() => useCatalogItem("UC-a"));
    expect(out.current.status).toBe("loading");
    await answer(0, { item: { ...row(item("UC-a", "Ada")), description: "", videos: [] } });
    expect(out.current.item?.stage).toBe("new");
    act(() => {
      shortlist([item("UC-a", "Ada")]);
    });
    expect(out.current.item?.stage).toBe("shortlisted");
    act(() => {
      fire(2);
    });
    await waitFor(() => {
      expect(pending.filter((p) => p.channel === "find:item")).toHaveLength(2);
    });
  });

  it("lists the runs and asks again on the event", async () => {
    const { result: out } = renderHook(() => useRuns());
    await answer(0, {
      runs: [
        {
          id: 1,
          startedAt: 1,
          finishedAt: 2,
          status: "done",
          keywords: 3,
          found: 10,
          kept: 4,
          gold: 1,
        },
      ],
    });
    expect(out.current.runs).toHaveLength(1);
    act(() => {
      fire(2);
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
  });
});

describe("Undo after a rebuild", () => {
  it("puts a shortlisted channel back when the overlay passes again, though main dropped it", async () => {
    const { result: out } = renderHook(() => useCatalogQuery(params));
    await answer(0, result(1, [item("UC-a", "Ada"), item("UC-b", "Bo")]));
    act(() => {
      shortlist([item("UC-a", "Ada")]);
    });
    act(() => {
      fire(2);
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await answer(1, result(2, [item("UC-b", "Bo")]));
    expect(out.current.items.map((i) => i.id)).toEqual(["UC-b"]);
    act(() => {
      undo();
    });
    expect(out.current.items.map((i) => i.id).sort()).toEqual(["UC-a", "UC-b"]);
    expect(out.current.total).toBe(2);
  });

  it("overlays only the stage and the reject reason", async () => {
    const all = { ...params, filter: { ...filter, stages: ["new", "shortlisted"] as const } };
    const { result: out } = renderHook(() => useCatalogQuery(all));
    await answer(0, result(1, [{ ...item("UC-a", "Ada"), email: "a@x.ai", emailConfirmed: true }]));
    act(() => {
      ensureCreators([item("UC-a", "Ada")]);
      shortlist([item("UC-a", "Ada")]);
    });
    expect(out.current.items[0]).toMatchObject({
      stage: "shortlisted",
      email: "a@x.ai",
      emailConfirmed: true,
    });
  });
});
