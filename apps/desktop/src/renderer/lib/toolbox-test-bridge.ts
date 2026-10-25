import type { LogEntry } from "@gratovo/core/data";
import {
  queryCatalog,
  type ArchivedChannel,
  type CatalogItem,
  type FindFilter,
  type ToolboxItem,
  type ToolboxList,
} from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";

import { aiChannel } from "./find-test-bridge";

/** What the fake Toolbox bridge answers with. */
export interface ToolboxFixture {
  readonly archive?: readonly ToolboxItem[];
  readonly never?: readonly ToolboxItem[];
  /** Every tombstone; `toolbox:archived` filters them by `q` on handle or name and pages them. */
  readonly archived?: readonly ArchivedChannel[];
  readonly counts?: { archive: number; never: number; archived: number; logToday: number };
  /** The answer to `toolbox:restore`. */
  readonly restore?: unknown;
  /** What `find:item` answers with. */
  readonly detail?: CatalogItem | null;
  /** The catalog `find:query` searches (Never contact's "Add a channel"). */
  readonly catalog?: readonly CatalogItem[];
  /** The whole activity log; `log:page` sorts, filters by `who`, pages and counts people. */
  readonly log?: readonly LogEntry[];
  /** The name `log:page` gives each person, by id. */
  readonly names?: Readonly<Record<string, string>>;
}

export interface ToolboxBridge {
  readonly calls: [string, unknown][];
  /** Sends an event to its listeners, as main does. */
  readonly emit: (name: string) => void;
}

/** A toolbox row: an AI channel with the archive fields and the day it is archived for good. */
export function toolboxItem(
  id: string,
  name: string,
  dueAt: number | null,
  over: Partial<CatalogItem> = {},
): ToolboxItem {
  return {
    ...aiChannel(id, name, {
      stage: "rejected",
      rejectReason: "views",
      rejectedAt: Date.now() - 86_400_000,
      ...over,
    }),
    dueAt,
  };
}

/**
 * For tests of the Toolbox: a bridge answering the five `toolbox:` channels from the fixture, with
 * a find state that fails, and events a test can send. Returns the calls and the sender.
 */
export function stubToolboxBridge(fixture: ToolboxFixture = {}): ToolboxBridge {
  const calls: [string, unknown][] = [];
  const listeners = new Map<string, Set<() => void>>();
  const lists: Record<ToolboxList, readonly ToolboxItem[]> = {
    archive: fixture.archive ?? [],
    never: fixture.never ?? [],
  };
  const invoke = (channel: string, input: unknown) => {
    calls.push([channel, input]);
    switch (channel) {
      case "toolbox:list": {
        const q = input as { list: ToolboxList; offset: number; limit: number };
        const all = lists[q.list];
        return Promise.resolve({
          ok: true,
          value: { version: 1, total: all.length, items: all.slice(q.offset, q.offset + q.limit) },
        });
      }
      case "toolbox:archived": {
        const q = input as { q: string; offset: number; limit: number };
        const needle = q.q.toLowerCase();
        const all = (fixture.archived ?? []).filter(
          (a) =>
            needle === "" ||
            (a.handle ?? "").toLowerCase().includes(needle) ||
            (a.name ?? "").toLowerCase().includes(needle),
        );
        return Promise.resolve({
          ok: true,
          value: { total: all.length, items: all.slice(q.offset, q.offset + q.limit) },
        });
      }
      case "toolbox:counts":
        return Promise.resolve({
          ok: true,
          value: fixture.counts ?? {
            archive: lists.archive.length,
            never: lists.never.length,
            archived: fixture.archived?.length ?? 0,
            logToday: 0,
          },
        });
      case "toolbox:sweep":
        return Promise.resolve({ ok: true, value: {} });
      case "toolbox:restore":
        return Promise.resolve({
          ok: true,
          value: fixture.restore ?? { ok: true, restored: 1, refetch: false },
        });
      case "find:query": {
        const q = input as { filter: FindFilter; sort: "fit"; offset: number; limit: number };
        const page = queryCatalog(fixture.catalog ?? [], q.filter, q.sort, q.offset, q.limit);
        return Promise.resolve({ ok: true, value: { version: 1, ...page } });
      }
      case "log:page": {
        const q = input as {
          before: { at: number; id: string } | null;
          limit: number;
          who: string | null;
        };
        const sorted = [...(fixture.log ?? [])].sort((a, b) =>
          a.at === b.at ? (a.id < b.id ? 1 : -1) : b.at - a.at,
        );
        const mine = sorted.filter((l) => q.who === null || l.who === q.who);
        const from =
          q.before === null
            ? 0
            : mine.findIndex((l) => l.id === q.before?.id && l.at === q.before.at) + 1;
        const counts = new Map<string, number>();
        for (const l of sorted) {
          counts.set(l.who, (counts.get(l.who) ?? 0) + 1);
        }
        return Promise.resolve({
          ok: true,
          value: {
            lines: mine.slice(from, from + q.limit),
            more: from + q.limit < mine.length,
            total: sorted.length,
            people: [...counts].map(([who, count]) => ({
              who,
              name: fixture.names?.[who] ?? who,
              count,
            })),
          },
        });
      }
      case "find:item":
        return Promise.resolve({ ok: true, value: { item: fixture.detail ?? null } });
      default:
        return Promise.resolve({ ok: false, reason: "test" });
    }
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: ((name: string, fn: () => void) => {
      const set = listeners.get(name) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(name, set);
      return () => {
        set.delete(fn);
      };
    }) as unknown as Bridge["on"],
  };
  return {
    calls,
    emit: (name) => {
      for (const fn of listeners.get(name) ?? []) {
        fn();
      }
    },
  };
}
