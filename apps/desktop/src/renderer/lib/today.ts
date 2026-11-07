import { DEAL_FLOW } from "@gratovo/core";
import { todayItems } from "@gratovo/core/today";
import type { DayState, TodayInput, TodayItem } from "@gratovo/core/today";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import { useReviewCount } from "../find/triage";
import { strings } from "../strings";
import { ago, money } from "./format";
import { dayWords, kindLabel } from "./reach-actions";
import { appStore, dealName, useApp } from "./store";
import type { AppData } from "./store";
import { forgetDone, recordDone } from "./today-actions";
import { useNow } from "./use-now";
import { isPartShown } from "./wired";

const t = strings.today;

/** Snoozed keys still snoozed at `now`, with the time each comes back. */
export function activeSnoozed(day: DayState, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(day.snoozed)) {
    if (entry.until > now) {
      out[key] = entry.until;
    }
  }
  return out;
}

/**
 * The keys that left the list and are not snoozed: those are done. A snoozed key (any key in
 * `snoozed`) left on purpose and is not done.
 */
export function doneDiff(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
  snoozed: Readonly<Record<string, number>>,
): string[] {
  const next = new Set(nextKeys);
  return prevKeys.filter((key) => !next.has(key) && !Object.hasOwn(snoozed, key));
}

/** The new-finds count: null until the catalog answers (never, without the main-process bridge). */
function useNewFinds(): number | null {
  return useReviewCount();
}

export interface TodayState {
  readonly input: TodayInput;
  readonly items: readonly TodayItem[];
  /** False while the new-finds count is still loading, so the list is not trusted yet. */
  readonly ready: boolean;
  readonly now: number;
}

const TodayContext = createContext<TodayState | null>(null);

/** Gives the screens one Today engine; mount it once in the app shell. */
export const TodayProvider = TodayContext.Provider;

/** Computes Today from the store. The shell does this once; everything else uses `useTodayState`. */
export function useComputeToday(): TodayState {
  const now = useNow();
  const source = useApp((s) => s.data.source);
  const seesMoney = useApp((s) => s.data.seesMoney);
  const creators = useApp((s) => s.data.creators);
  const brands = useApp((s) => s.data.brands);
  const deals = useApp((s) => s.data.deals);
  const drafts = useApp((s) => s.data.reach.drafts);
  const threads = useApp((s) => s.data.reach.threads);
  const sequences = useApp((s) => s.data.reach.sequences);
  const day = useApp((s) => s.data.settings.day);
  const review = useNewFinds();
  const newFinds = review ?? 0;
  const dealsShown = isPartShown("today.deals", source);
  return useMemo(() => {
    const input: TodayInput = {
      now,
      seesMoney,
      parts: { deals: dealsShown },
      creators,
      brands,
      deals,
      reach: { drafts, threads, sequences },
      newFinds,
      snoozed: activeSnoozed(day, now),
    };
    return { input, items: todayItems(input), ready: review !== null, now };
  }, [
    now,
    seesMoney,
    dealsShown,
    creators,
    brands,
    deals,
    drafts,
    threads,
    sequences,
    newFinds,
    review,
    day,
  ]);
}

/**
 * The shared Today state. Without a provider (a part rendered alone) it computes locally; whether
 * there is a provider does not change while a component is mounted, so the hook order is stable.
 */
export function useTodayState(): TodayState {
  const shared = useContext(TodayContext);
  if (shared !== null) {
    return shared;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useComputeToday();
}

/** What Today is computed from, read from the store. */
export function useTodayInput(): TodayInput {
  return useTodayState().input;
}

/** Everything that needs the person now, in bucket order. */
export function useTodayItems(): readonly TodayItem[] {
  return useTodayState().items;
}

/** The words for one item: a title, a sub line and why it is there. */
export interface ItemWords {
  readonly title: string;
  readonly sub: string;
  readonly why: string;
}

const idIndexes = new WeakMap<object, Map<string, unknown>>();

/** An id -> record map for a list, built once per array (the store replaces an array when it changes). */
function byId<T extends { readonly id: string }>(list: readonly T[]): ReadonlyMap<string, T> {
  let map = idIndexes.get(list) as Map<string, T> | undefined;
  if (map === undefined) {
    map = new Map(list.map((r) => [r.id, r]));
    idIndexes.set(list, map);
  }
  return map;
}

type Thread = AppData["reach"]["threads"][number];
const threadIndexes = new WeakMap<object, Map<string, Thread>>();

/** The threads by creator, built once per array. */
function threadByCreator(data: AppData): ReadonlyMap<string, Thread> {
  let map = threadIndexes.get(data.reach.threads);
  if (map === undefined) {
    map = new Map();
    for (const th of data.reach.threads) {
      if (!map.has(th.creator)) {
        map.set(th.creator, th);
      }
    }
    threadIndexes.set(data.reach.threads, map);
  }
  return map;
}

const refName = (data: AppData, item: TodayItem): string => {
  const ref = item.ref;
  if (ref === null) {
    return strings.record.unknownName;
  }
  const list: readonly { readonly id: string; readonly name: string }[] =
    ref.kind === "creator" ? data.creators : data.brands;
  return byId(list).get(ref.id)?.name ?? strings.record.unknownName;
};

/**
 * Words an item from the data it was found in. `newFinds` is the count the finds item stands for;
 * money shows only to a person who sees money.
 */
export function itemWords(
  item: TodayItem,
  data: AppData,
  opts: { readonly newFinds?: number; readonly now?: number } = {},
): ItemWords {
  const now = opts.now ?? Date.now();
  const deal = item.ref?.kind === "deal" ? byId(data.deals).get(item.ref.id) : undefined;
  const brandOfDeal = deal === undefined ? undefined : byId(data.brands).get(deal.brand);
  const creatorOfDeal = deal === undefined ? undefined : byId(data.creators).get(deal.creator);
  const draft = item.draft === null ? undefined : byId(data.reach.drafts).get(item.draft);
  const name = refName(data, item);
  const dealBrand = brandOfDeal?.name ?? strings.record.unknownName;
  const dealCreator = creatorOfDeal?.name ?? strings.record.unknownName;
  const amount = (n: number | null | undefined): string | null =>
    data.seesMoney && n !== null && n !== undefined ? money(n) : null;
  const due = item.due === null ? "" : dayWords(item.due);

  switch (item.kind) {
    case "invoice":
      return {
        title: t.titles.invoice(dealBrand),
        sub: t.subs.invoice(dealCreator, amount(deal?.price)),
        why: t.why.invoice,
      };
    case "collect":
      return {
        title: t.titles.collect(dealBrand, amount(deal?.price)),
        sub: t.subs.collect(deal?.invoice.number ?? null, due),
        why: t.why.collect,
      };
    case "payout":
      return {
        title: t.titles.payout(dealCreator, amount(deal?.payout)),
        sub: t.subs.payout(
          dealBrand,
          deal?.invoice.paidAt == null ? "" : dayWords(deal.invoice.paidAt),
        ),
        why: t.why.payout,
      };
    case "deal":
    case "nextdeal": {
      if (deal === undefined) {
        return { title: t.titles.unknown, sub: "", why: "" };
      }
      const step = DEAL_FLOW[deal.step];
      const open = deal.checks.indexOf(false);
      const task = step?.items[open] ?? t.subs.dealReady;
      return item.kind === "nextdeal"
        ? { title: t.titles.nextdeal(dealBrand), sub: t.subs.nextdeal, why: t.why.nextdeal }
        : {
            title: t.titles.deal(dealName(data, deal)),
            sub: t.subs.deal(step?.name ?? "", open >= 0 ? task : t.subs.dealReady),
            why: t.why.deal(step?.name ?? "", due),
          };
    }
    case "reply": {
      const thread = item.ref === null ? undefined : threadByCreator(data).get(item.ref.id);
      const reading = thread?.lastIn?.reading ?? null;
      return {
        title: t.titles.reply(name),
        sub:
          reading !== null
            ? (reading.label.split(" · ")[0] ?? reading.label)
            : item.draft === null
              ? t.subs.replyWaiting
              : t.subs.replyDrafted,
        why: reading?.summary ?? t.why.replyNone,
      };
    }
    case "send":
      return {
        title: t.titles.send(draft === undefined ? t.titles.emailFallback : kindLabel(draft), name),
        sub:
          draft?.state === "failed"
            ? t.subs.sendFailed
            : item.quick
              ? t.subs.sendReady
              : t.subs.sendNeedsYou,
        why: t.why.send,
      };
    case "followup":
      return {
        title: t.titles.followup(
          draft === undefined ? t.titles.followupFallback : kindLabel(draft),
          name,
        ),
        sub: t.subs.followup(draft === undefined ? "" : dayWords(draft.createdAt)),
        why: t.why.followup,
      };
    case "bnudge": {
      const brand = item.ref === null ? undefined : byId(data.brands).get(item.ref.id);
      return {
        title: t.titles.bnudge(name),
        sub: t.subs.bnudge(brand?.pitched == null ? "" : ago(brand.pitched.at, now)),
        why: t.why.bnudge,
      };
    }
    case "audience":
      return { title: t.titles.audience(name), sub: t.subs.audience, why: t.why.audience };
    case "qualify":
    case "pitch": {
      const brand = item.ref === null ? undefined : byId(data.brands).get(item.ref.id);
      const sells = brand?.sells ?? "";
      return item.kind === "qualify"
        ? { title: t.titles.qualify(name), sub: t.subs.qualify(sells), why: t.why.qualify }
        : { title: t.titles.pitch(name), sub: t.subs.pitch(sells), why: t.why.pitch };
    }
    case "contact": {
      const creator = item.ref === null ? undefined : byId(data.creators).get(item.ref.id);
      return {
        title: t.titles.contact(name),
        sub: creator?.email == null ? t.subs.contactNone : t.subs.contactHas(creator.email),
        why: t.why.contact,
      };
    }
    case "finds":
      return { title: t.titles.finds(opts.newFinds ?? 0), sub: t.subs.finds, why: t.why.finds };
  }
}

/**
 * Whether what an item points at is still in the data. An item that left the list because its
 * creator, brand, deal or draft left the data (a scenario pick, a smaller frame) was not done.
 */
export function stillThere(item: TodayItem, data: AppData): boolean {
  if (item.draft !== null && !byId(data.reach.drafts).has(item.draft)) {
    return false;
  }
  if (item.ref === null) {
    return data.creators.length > 0;
  }
  const { kind, id } = item.ref;
  return kind === "creator"
    ? byId(data.creators).has(id)
    : kind === "brand"
      ? byId(data.brands).has(id)
      : byId(data.deals).has(id);
}

/** How long before a done entry the change that finished it may have been made, for Undo. */
const undoWindowMs = 2000;

/** The newest change Undo would take back, when it was made within the last 2 s; else null. */
export function recentUndoStep(): number | null {
  const top = appStore().peekUndo();
  return top !== undefined && Date.now() - top.at <= undoWindowMs ? top.id : null;
}

/** The change behind the newest done entry; renderer-side, not part of the day state. */
let lastDone: { readonly key: string; readonly step: number | null } | null = null;

/** Whether Undo on this done entry would take back the change that finished it. */
export function canUndoDone(key: string): boolean {
  return (
    lastDone !== null &&
    lastDone.key === key &&
    lastDone.step !== null &&
    appStore().peekUndo()?.id === lastDone.step
  );
}

/** `canUndoDone`, read again when the undo stack changes. */
export function useCanUndoDone(key: string): boolean {
  useApp(() => appStore().peekUndo()?.id ?? null);
  return canUndoDone(key);
}

/** Forgets the change behind the newest done entry (tests). */
export function resetDoneUndo(): void {
  lastDone = null;
}

/**
 * Records "done" as the list changes (decision T5): a key that leaves the list and is not snoozed
 * is done; a key that is back on the list comes off the done list. Mount once in the app shell.
 * It starts after the first list for a source and person, and starts over when either changes.
 * It does not wait for the catalog: only the finds key waits for the new-finds count.
 */
export function useDoneTracker(): void {
  const { items, ready, now, input } = useTodayState();
  const source = useApp((s) => s.data.source);
  const me = useApp((s) => s.data.me);
  const prev = useRef<{
    sig: string;
    items: readonly TodayItem[];
    data: AppData;
    newFinds: number;
  } | null>(null);

  useEffect(() => {
    const sig = `${source}:${me}`;
    if (me === "") {
      prev.current = null;
      return;
    }
    const data = appStore().getState().data;
    const before = prev.current;
    prev.current = { sig, items, data, newFinds: input.newFinds };
    if (before === null || before.sig !== sig || before.items === items) {
      return;
    }
    // Only the keys that left the list are worded, from the data they were last seen in.
    const gone = doneDiff(
      before.items.map((i) => i.key),
      items.map((i) => i.key),
      input.snoozed,
    ).filter((key) => key !== "finds" || ready);
    const byKey = new Map(before.items.map((i) => [i.key, i]));
    for (const key of gone) {
      const was = byKey.get(key);
      if (was !== undefined && stillThere(was, data)) {
        lastDone = { key, step: recentUndoStep() };
        recordDone({
          key,
          title: itemWords(was, before.data, { newFinds: before.newFinds, now }).title,
          bucket: was.bucket,
          at: Date.now(),
          minutes: was.minutes,
        });
      }
    }
    const done = new Set(data.settings.day.done.map((e) => e.key));
    for (const item of items) {
      if (done.has(item.key) && (item.key !== "finds" || ready)) {
        forgetDone(item.key);
      }
    }
  }, [items, ready, now, input, source, me]);
}

/** Opens focus on Today: the bar with the clock starts now. */
export function startFocus(): void {
  appStore().ui((ui) => {
    ui.today.focusAt = Date.now();
    ui.today.wrap = false;
  });
}

/** Opens the wrap-up on Today. */
export function startWrap(): void {
  appStore().ui((ui) => {
    ui.today.wrap = true;
    ui.today.focusAt = null;
  });
}
