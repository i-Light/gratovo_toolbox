import type { ChannelResponse } from "@gratovo/ipc";
import type { ArchivedChannel, CatalogItem, ToolboxItem, ToolboxList } from "@gratovo/core/find";
import type { Creator } from "@gratovo/core/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { strings } from "../strings";
import { useCatalogTick } from "./find-catalog";
import { bringBack } from "./find-actions";
import { appStore, useApp } from "./store";
import { toast } from "./toast";

const text = strings.toolbox;

/** How many channels the countdown and never-contact lists ask for at a time (main's most). */
export const toolboxPageSize = 120;
/** How many tombstones "Archived for good" asks for at a time. */
export const archivedPageSize = 50;
/** How long the search box waits after the last key before it asks. */
const searchWaitMs = 250;

export type ToolboxLoad = "loading" | "ready" | "failed";
type Counts = ChannelResponse<"toolbox:counts">;

/**
 * The numbers beside the tools. Read on mount, again on each `find:catalog` and whenever the
 * newest activity line changes (the "Changes today" count follows it). Null until the first answer;
 * a failed read keeps the last numbers.
 */
export function useToolboxCounts(): Counts | null {
  const tick = useCatalogTick();
  const newestLine = useApp((s) => s.data.log[0]?.id ?? "");
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("toolbox:counts", {}).then(
      (result) => {
        if (!stopped && result.ok) {
          setCounts(result.value);
        }
      },
      () => undefined,
    );
    return () => {
      stopped = true;
    };
  }, [tick, newestLine]);
  return counts;
}

/** One answer page: the items and the total behind them. */
interface Page<T> {
  readonly total: number;
  readonly items: readonly T[];
}

interface Loaded<T> {
  readonly key: string;
  readonly status: ToolboxLoad;
  readonly items: readonly T[];
  readonly total: number;
  readonly more: "idle" | "loading" | "failed";
}

export interface Pages<T> {
  readonly status: ToolboxLoad;
  readonly items: readonly T[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly moreFailed: boolean;
  readonly loadMore: () => void;
  /** True while a new request loads and the last items are still shown. */
  readonly busy: boolean;
}

/**
 * A list read a page at a time. `key` names the request: a new key starts again at the first page
 * (the last items stay up, `busy`, until it answers). A `find:catalog` asks for every page loaded
 * so far again and swaps them in together. `fetchPage` may change between renders.
 */
function usePages<T extends { readonly id: string }>(
  key: string,
  pageSize: number,
  fetchPage: (offset: number) => Promise<Page<T> | null>,
  tick: number,
): Pages<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({
    key: "",
    status: "loading",
    items: [],
    total: 0,
    more: "idle",
  });
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  // How deep the loaded pages go, for the request `cursor.key` names.
  const cursor = useRef({ key, offset: 0 });
  const busyMore = useRef(false);
  useEffect(() => {
    const run = { stopped: false };
    if (cursor.current.key !== key) {
      cursor.current = { key, offset: 0 };
    }
    const depth = cursor.current.offset;
    void (async () => {
      const all: T[] = [];
      let total = 0;
      for (let offset = 0; offset <= depth; offset += pageSize) {
        const page = await fetchRef.current(offset).catch(() => null);
        if (run.stopped) {
          return;
        }
        if (page === null) {
          // A failed first read of a request is a failure; a later one leaves the list as it is.
          setLoaded((cur) =>
            cur.key === key && cur.status === "ready" ? cur : { ...cur, key, status: "failed" },
          );
          return;
        }
        all.push(...page.items);
        total = page.total;
      }
      setLoaded({ key, status: "ready", items: all, total, more: "idle" });
    })();
    return () => {
      run.stopped = true;
    };
  }, [key, tick, pageSize]);

  const hasMore = loaded.key === key && loaded.items.length < loaded.total;
  const loadMore = useCallback((): void => {
    if (busyMore.current || loaded.key !== key || loaded.items.length >= loaded.total) {
      return;
    }
    busyMore.current = true;
    const offset = cursor.current.offset + pageSize;
    setLoaded((cur) => ({ ...cur, more: "loading" }));
    const fail = (): void => {
      busyMore.current = false;
      setLoaded((cur) => (cur.key === key ? { ...cur, more: "failed" } : cur));
    };
    void fetchRef.current(offset).then((page) => {
      if (page === null) {
        fail();
        return;
      }
      busyMore.current = false;
      if (cursor.current.key !== key) {
        return;
      }
      cursor.current = { key, offset };
      setLoaded((cur) => {
        if (cur.key !== key) {
          return cur;
        }
        const seen = new Set(cur.items.map((i) => i.id));
        return {
          ...cur,
          items: [...cur.items, ...page.items.filter((i) => !seen.has(i.id))],
          total: page.total,
          more: "idle",
        };
      });
    }, fail);
  }, [key, loaded.key, loaded.items.length, loaded.total, pageSize]);

  return {
    status: loaded.status,
    items: loaded.items,
    total: loaded.total,
    hasMore,
    moreFailed: loaded.key === key && loaded.more === "failed",
    loadMore,
    busy: loaded.key !== key && loaded.status === "ready",
  };
}

const stageOfList = { archive: "rejected", never: "never" } as const;

/**
 * One of the two lists (D36, D39), 120 at a time. The page's own creator state lies over main's
 * answer, as in the gallery: a channel brought back leaves the Archive list at once, and a reject
 * shows its new reason, without waiting for the catalog to rebuild.
 */
export function useToolboxList(
  list: ToolboxList,
): Pages<ToolboxItem> & { readonly dropped: number } {
  const tick = useCatalogTick();
  const pages = usePages<ToolboxItem>(
    list,
    toolboxPageSize,
    async (offset) => {
      const result = await window.gratovo.invoke("toolbox:list", {
        list,
        offset,
        limit: toolboxPageSize,
      });
      return result.ok ? { total: result.value.total, items: result.value.items } : null;
    },
    tick,
  );
  const creators = useApp((s) => s.data.creators);
  const { items, dropped } = useMemo(() => {
    const mine = new Map(creators.map((c) => [c.id, c]));
    const out: ToolboxItem[] = [];
    let gone = 0;
    for (const item of pages.items) {
      const creator = mine.get(item.id);
      if (creator !== undefined && creator.stage !== stageOfList[list]) {
        gone += 1;
        continue;
      }
      out.push(
        creator === undefined || creator.rejectReason === item.rejectReason
          ? item
          : { ...item, rejectReason: creator.rejectReason },
      );
    }
    return { items: out, dropped: gone };
  }, [pages.items, creators, list]);
  // A channel this page blocked since main's last catalog build is at `never` here before main's
  // list has it: it leads. Older ones are main's to list (they sit on later pages), so they are
  // left out, and the next build clears this overlay.
  const [since, setSince] = useState(() => Date.now());
  useEffect(
    () =>
      window.gratovo.on("find:catalog", () => {
        setSince(Date.now());
      }),
    [],
  );
  const fresh = useMemo(() => {
    if (list !== "never") {
      return [];
    }
    const listed = new Set(pages.items.map((i) => i.id));
    return creators
      .filter(
        (c) =>
          c.stage === "never" &&
          !listed.has(c.id) &&
          c.rejectedAt !== null &&
          c.rejectedAt >= since,
      )
      .sort((a, b) => (b.rejectedAt ?? 0) - (a.rejectedAt ?? 0))
      .map((c): ToolboxItem => ({ ...itemFromCreator(c), dueAt: null }));
  }, [pages.items, creators, list, since]);
  const shown = fresh.length === 0 ? items : [...fresh, ...items];
  return {
    ...pages,
    items: shown,
    total: pages.hasMore ? Math.max(0, pages.total - dropped) + fresh.length : shown.length,
    dropped,
  };
}

/**
 * "Archived for good" (D36): the tombstones matching `q` on the handle or name, 50 a page. The
 * search waits 250 ms after the last key. `drop` hides rows at once (a restored one) until the
 * catalog next rebuilds.
 */
export function useArchived(q: string): Pages<ArchivedChannel> & {
  readonly drop: (ids: readonly string[]) => void;
  /** The text the list answers, which trails `q` by the wait. */
  readonly asked: string;
} {
  const tick = useCatalogTick();
  const [asked, setAsked] = useState(q.trim());
  useEffect(() => {
    const next = q.trim();
    if (next === asked) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setAsked(next);
    }, searchWaitMs);
    return () => {
      clearTimeout(timer);
    };
  }, [q, asked]);
  const pages = usePages<ArchivedChannel>(
    JSON.stringify(["archived", asked]),
    archivedPageSize,
    async (offset) => {
      const result = await window.gratovo.invoke("toolbox:archived", {
        q: asked,
        offset,
        limit: archivedPageSize,
      });
      return result.ok ? { total: result.value.total, items: result.value.items } : null;
    },
    tick,
  );
  const [gone, setGone] = useState<{ tick: number; ids: ReadonlySet<string> }>({
    tick,
    ids: new Set(),
  });
  const drop = useCallback(
    (ids: readonly string[]): void => {
      setGone((cur) => ({
        tick,
        ids: new Set([...(cur.tick === tick ? cur.ids : []), ...ids]),
      }));
    },
    [tick],
  );
  const hidden = gone.tick === tick ? gone.ids : null;
  const items = useMemo(
    () => (hidden === null ? pages.items : pages.items.filter((i) => !hidden.has(i.id))),
    [pages.items, hidden],
  );
  const removed = pages.items.length - items.length;
  return { ...pages, items, total: Math.max(0, pages.total - removed), drop, asked };
}

/** A catalog item built from the creator the page holds, for the acts (they read only the id when it is held). */
function itemFromCreator(c: Creator): CatalogItem {
  return {
    id: c.id,
    name: c.name,
    handle: c.handle,
    pic: null,
    stage: c.stage,
    emailConfirmed: c.emailConfirmed,
    email: c.email,
    contactName: c.contactName,
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
    rejectReason: c.rejectReason,
    rejectedAt: c.rejectedAt,
    neverReason: c.neverReason,
    archiveDueAt: c.archiveDueAt,
    archivedAt: null,
    hasNumbers: false,
    uploadsRead: false,
    readFailed: false,
    trimmedAverage: null,
    viewStability: null,
    stars: null,
    format: null,
    botRisk: null,
  };
}

/** What "Bring back" needs to know about a channel archived for good (a tombstone row or a catalog item). */
export interface RestoreTarget {
  readonly id: string;
  readonly name: string | null;
  readonly handle: string | null;
  /** The creator's stage when known; the page's own copy wins. */
  readonly stage: Creator["stage"] | null;
}

/** How a restore went: the tombstone is gone, a search holds the lane, or it could not be done. */
export type RestoreOutcome = "restored" | "busy" | "failed";

/**
 * Brings a channel back from "Archived for good" (D38). Main deletes the tombstone first (and, on
 * live data, reads the channel's numbers again). Only when that worked does a creator still at
 * Rejected go to Review new, with the undoable `bringBack` act; its toast says how the restore went.
 * A problem leaves the stage alone and shows one problem toast.
 */
export async function restoreForGood(target: RestoreTarget): Promise<RestoreOutcome> {
  const result = await window.gratovo
    .invoke("toolbox:restore", { ids: [target.id] })
    .catch(() => null);
  if (result === null || !result.ok) {
    toast({ msg: text.restore.failed, icon: "alert" });
    return "failed";
  }
  const answer = result.value;
  if (!answer.ok) {
    toast({
      msg:
        answer.problem === "busy"
          ? text.restore.busy
          : answer.problem === "failed"
            ? text.restore.failed
            : strings.findSearch.startProblems.no_python,
      icon: "alert",
    });
    return answer.problem === "busy" ? "busy" : "failed";
  }
  const refetch = answer.refetch && answer.restored > 0 && target.handle !== null;
  const sub = refetch ? text.restore.comingBackSub : text.restore.returnsLater;
  const held = appStore()
    .getState()
    .data.creators.find((c) => c.id === target.id);
  if ((held?.stage ?? target.stage) === "rejected") {
    let item: CatalogItem | null = held === undefined ? null : itemFromCreator(held);
    if (item === null) {
      const found = await window.gratovo.invoke("find:item", { id: target.id }).catch(() => null);
      item = found?.ok === true ? (found.value.item ?? null) : null;
    }
    if (item !== null && bringBack(item, sub)) {
      return "restored";
    }
  }
  // No creator row to move (a rules-swept channel), so one plain toast.
  const name = target.name ?? target.handle ?? text.restore.fallbackName;
  if (refetch) {
    toast({ msg: text.restore.comingBack(name), sub, tone: "good" });
  } else {
    toast({ msg: sub, tone: "info" });
  }
  return "restored";
}
