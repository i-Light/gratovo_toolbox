import { DEAL_FLOW } from "@gratovo/core";
import { todayItems } from "@gratovo/core/today";
import type { DayState, TodayInput, TodayItem } from "@gratovo/core/today";
import { useEffect, useMemo, useRef } from "react";

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

export function useTodayState(): TodayState {
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

const refName = (data: AppData, item: TodayItem): string => {
  const ref = item.ref;
  if (ref === null) {
    return strings.record.unknownName;
  }
  const list: readonly { readonly id: string; readonly name: string }[] =
    ref.kind === "creator" ? data.creators : data.brands;
  return list.find((r) => r.id === ref.id)?.name ?? strings.record.unknownName;
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
  const deal =
    item.ref?.kind === "deal" ? data.deals.find((d) => d.id === item.ref?.id) : undefined;
  const brandOfDeal = deal === undefined ? undefined : data.brands.find((b) => b.id === deal.brand);
  const creatorOfDeal =
    deal === undefined ? undefined : data.creators.find((c) => c.id === deal.creator);
  const draft = data.reach.drafts.find((d) => d.id === item.draft);
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
      const thread = data.reach.threads.find((th) => th.creator === item.ref?.id);
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
        title: t.titles.send(draft === undefined ? "Email" : kindLabel(draft), name),
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
        title: t.titles.followup(draft === undefined ? "Follow-up" : kindLabel(draft), name),
        sub: t.subs.followup(draft === undefined ? "" : dayWords(draft.createdAt)),
        why: t.why.followup,
      };
    case "bnudge": {
      const brand = data.brands.find((b) => b.id === item.ref?.id);
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
      const brand = data.brands.find((b) => b.id === item.ref?.id);
      const sells = brand?.sells ?? "";
      return item.kind === "qualify"
        ? { title: t.titles.qualify(name), sub: t.subs.qualify(sells), why: t.why.qualify }
        : { title: t.titles.pitch(name), sub: t.subs.pitch(sells), why: t.why.pitch };
    }
    case "contact": {
      const creator = data.creators.find((c) => c.id === item.ref?.id);
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
 * Records "done" as the list changes (decision T5): a key that leaves the list and is not snoozed
 * is done; a key that is back on the list comes off the done list. Mount once in the app shell.
 * It starts after the first list for a source and person, and starts over when either changes.
 */
export function useDoneTracker(): void {
  const { items, ready, now, input } = useTodayState();
  const source = useApp((s) => s.data.source);
  const me = useApp((s) => s.data.me);
  const prev = useRef<{
    sig: string;
    items: readonly TodayItem[];
    titles: ReadonlyMap<string, string>;
    newFinds: number;
  } | null>(null);

  useEffect(() => {
    const sig = `${source}:${me}`;
    if (me === "" || !ready) {
      if (me === "") {
        prev.current = null;
      }
      return;
    }
    const data = appStore().getState().data;
    const before = prev.current;
    const titles = new Map<string, string>();
    for (const item of items) {
      titles.set(item.key, itemWords(item, data, { newFinds: input.newFinds, now }).title);
    }
    prev.current = { sig, items, titles, newFinds: input.newFinds };
    if (before === null || before.sig !== sig) {
      return;
    }
    const gone = doneDiff(
      before.items.map((i) => i.key),
      items.map((i) => i.key),
      input.snoozed,
    );
    const byKey = new Map(before.items.map((i) => [i.key, i]));
    for (const key of gone) {
      const was = byKey.get(key);
      if (was !== undefined) {
        recordDone({
          key,
          title: before.titles.get(key) ?? "",
          bucket: was.bucket,
          at: now,
          minutes: was.minutes,
        });
      }
    }
    const done = new Set(data.settings.day.done.map((e) => e.key));
    for (const item of items) {
      if (done.has(item.key)) {
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
