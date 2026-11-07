// @vitest-environment happy-dom
import { todayBuckets, todayItems } from "@gratovo/core/today";
import type { TodayItem } from "@gratovo/core/today";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { strings } from "../strings";
import { act as doAct } from "./actions";
import {
  doneDiff,
  itemWords,
  startFocus,
  startWrap,
  canUndoDone,
  stillThere,
  useDoneTracker,
  useTodayInput,
  useTodayItems,
} from "./today";
import { appStore, resetAppStoreForTests } from "./store";

const t = strings.today;
const data = () => appStore().getState().data;

beforeEach(() => {
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(cleanup);

const items = (): readonly TodayItem[] => renderHook(() => useTodayItems()).result.current;
const first = (kind: TodayItem["kind"]): TodayItem => {
  const found = items().find((i) => i.kind === kind);
  if (found === undefined) {
    throw new Error(`no ${kind} item in the example`);
  }
  return found;
};

describe("doneDiff", () => {
  it("returns the keys that left the list", () => {
    expect(doneDiff(["a", "b", "c"], ["b"], {})).toEqual(["a", "c"]);
  });
  it("leaves out snoozed keys, and keys that stayed or are new", () => {
    expect(doneDiff(["a", "b"], ["b", "z"], { a: 5 })).toEqual([]);
  });
  it("is empty when nothing left", () => {
    expect(doneDiff(["a"], ["a", "b"], {})).toEqual([]);
  });
});

describe("useTodayItems", () => {
  it("gives the example's items in bucket order", () => {
    const list = items();
    expect(list.length).toBeGreaterThan(0);
    const ranks = list.map((i) => todayBuckets.indexOf(i.bucket));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("matches the engine over the same input", () => {
    const { result } = renderHook(() => ({ input: useTodayInput(), list: useTodayItems() }));
    expect(result.current.list).toEqual(todayItems(result.current.input));
    expect(result.current.input.parts.deals).toBe(true);
  });

  it("leaves out a snoozed item", () => {
    const one = items()[0];
    expect(one).toBeDefined();
    const key = (one as TodayItem).key;
    appStore().bg((d) => {
      d.settings.day = {
        ...d.settings.day,
        snoozed: { [key]: { until: Date.now() + 3_600_000, title: "x" } },
      };
    });
    expect(items().some((i) => i.key === key)).toBe(false);
  });
});

describe("itemWords", () => {
  it("words a reply with the creator and the reading", () => {
    const item = first("reply");
    const w = itemWords(item, data());
    const name = data().creators.find((c) => c.id === item.ref?.id)?.name ?? "";
    expect(w.title).toBe(t.titles.reply(name));
    expect(w.sub).not.toBe("");
    expect(w.why).not.toBe("");
  });

  it("words a send with the draft's kind", () => {
    const item = first("send");
    const w = itemWords(item, data());
    const name = data().creators.find((c) => c.id === item.ref?.id)?.name ?? "";
    expect(w.title.endsWith(` to ${name}`)).toBe(true);
    expect([t.subs.sendReady, t.subs.sendNeedsYou, t.subs.sendFailed]).toContain(w.sub);
  });

  it("words a contact with the name and the address", () => {
    const item = first("contact");
    const w = itemWords(item, data());
    const c = data().creators.find((x) => x.id === item.ref?.id);
    expect(w.title).toBe(t.titles.contact(c?.name ?? ""));
    expect(w.sub).toBe(c?.email == null ? t.subs.contactNone : t.subs.contactHas(c.email));
  });

  it("words the finds item with the count", () => {
    const item: TodayItem = {
      key: "finds",
      bucket: "finds",
      kind: "finds",
      ref: null,
      draft: null,
      due: null,
      age: false,
      minutes: 3,
      quick: false,
      owner: null,
    };
    expect(itemWords(item, data(), { newFinds: 6 }).title).toBe("6 new channels to review");
    expect(itemWords(item, data(), { newFinds: 1 }).title).toBe("1 new channel to review");
  });

  it("shows money only to a person who sees money", () => {
    const item = items().find((i) => i.kind === "collect" || i.kind === "payout");
    expect(item).toBeDefined();
    const withMoney = itemWords(item as TodayItem, { ...data(), seesMoney: true });
    const without = itemWords(item as TodayItem, { ...data(), seesMoney: false });
    expect(withMoney.title).toMatch(/\$/);
    expect(without.title).not.toMatch(/\$/);
  });
});

describe("the Today UI flags", () => {
  it("startFocus sets the time and startWrap opens the wrap-up", () => {
    startFocus();
    expect(appStore().getState().ui.today.focusAt).not.toBeNull();
    startWrap();
    expect(appStore().getState().ui.today.wrap).toBe(true);
    expect(appStore().getState().ui.today.focusAt).toBeNull();
  });
});

describe("stillThere", () => {
  it("is true while the item's records are in the data", () => {
    expect(stillThere(first("send"), data())).toBe(true);
    expect(stillThere(first("deal"), data())).toBe(true);
  });

  it("is false once the creator, deal or draft left the data (a scenario pick, not work done)", () => {
    const send = first("send");
    const deal = first("deal");
    appStore().bg((d) => {
      d.creators = [];
      d.deals = [];
      d.reach.drafts = [];
    });
    expect(stillThere(send, data())).toBe(false);
    expect(stillThere(deal, data())).toBe(false);
    expect(
      stillThere({ ...send, key: "finds", kind: "finds", ref: null, draft: null }, data()),
    ).toBe(false);
  });
});

describe("useDoneTracker", () => {
  const day = () => data().settings.day;
  let base: readonly unknown[] = [];
  beforeEach(() => {
    base = data().settings.day.done;
  });
  const change = (recipe: (d: ReturnType<typeof data>) => void): void => {
    act(() => {
      appStore().bg((d) => {
        recipe(d);
      });
    });
  };
  const setState = (draft: string, state: string): void => {
    change((d) => {
      (d.reach as { drafts: unknown }).drafts = d.reach.drafts.map((x) =>
        x.id === draft ? { ...x, state } : x,
      );
    });
  };
  const sendItem = (): TodayItem => first("send");

  it("records nothing on the first list", () => {
    renderHook(() => {
      useDoneTracker();
    });
    expect(day().done).toEqual(base);
  });

  it("does not take a source switch for work done", () => {
    const draft = sendItem().draft as string;
    renderHook(() => {
      useDoneTracker();
    });
    change((d) => {
      (d as { source: string }).source = "live";
      (d.reach as { drafts: unknown }).drafts = d.reach.drafts.map((x) =>
        x.id === draft ? { ...x, state: "sent" } : x,
      );
    });
    expect(day().done).toEqual(base);
  });

  it("does not take a change of person for work done", () => {
    const draft = sendItem().draft as string;
    renderHook(() => {
      useDoneTracker();
    });
    change((d) => {
      (d as { me: string }).me = "someone-else";
      (d.reach as { drafts: unknown }).drafts = d.reach.drafts.map((x) =>
        x.id === draft ? { ...x, state: "sent" } : x,
      );
    });
    expect(day().done).toEqual(base);
  });

  it("does not count a snoozed item that left", () => {
    const send = sendItem();
    renderHook(() => {
      useDoneTracker();
    });
    change((d) => {
      (d.settings as { day: unknown }).day = {
        ...d.settings.day,
        snoozed: { [send.key]: { until: Date.now() + 3_600_000, title: "x" } },
      };
    });
    expect(day().done).toEqual(base);
  });

  it("records an item whose draft went to sent, then forgets it when it comes back", () => {
    const send = sendItem();
    const draft = send.draft as string;
    const before = data().reach.drafts.find((x) => x.id === draft)?.state as string;
    const title = itemWords(send, data()).title;
    renderHook(() => {
      useDoneTracker();
    });
    setState(draft, "sent");
    const entry = day().done.find((e) => e.key === send.key);
    expect(entry).toMatchObject({ title, bucket: "sends", minutes: send.minutes });
    setState(draft, before);
    expect(day().done.some((e) => e.key === send.key)).toBe(false);
  });

  it("offers Undo for the newest done entry only while its change is the newest", () => {
    const send = sendItem();
    const draft = send.draft as string;
    renderHook(() => {
      useDoneTracker();
    });
    act(() => {
      doAct("Send it", (d) => {
        (d.reach as { drafts: unknown }).drafts = d.reach.drafts.map((x) =>
          x.id === draft ? { ...x, state: "sent" } : x,
        );
      });
    });
    expect(canUndoDone(send.key)).toBe(true);
    act(() => {
      doAct("Another change", (d) => {
        d.settings.day = { ...d.settings.day, note: "n" };
      });
    });
    expect(canUndoDone(send.key)).toBe(false);
  });

  it("does not count an item whose creator left the data", () => {
    const send = sendItem();
    renderHook(() => {
      useDoneTracker();
    });
    change((d) => {
      (d as { creators: unknown }).creators = d.creators.filter((c) => c.id !== send.ref?.id);
    });
    expect(day().done.some((e) => e.key === send.key)).toBe(false);
  });
});
