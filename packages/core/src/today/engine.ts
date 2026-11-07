import { DEAL_FLOW } from "../deal-flow";
import { isOpenDraft } from "../reach/board";
import { replyItems } from "../reach/replies";
import { isRunning } from "../reach/sequence";

import { dayNoteMax, doneMax, snoozedMax, todayBuckets } from "./types";
import type { DayState, TodayBucket, TodayInput, TodayItem } from "./types";

const DAY = 86_400_000;

const stepOf = (key: string): number => DEAL_FLOW.findIndex((s) => s.key === key);
const invoiceStep = stepOf("invoice");
const payStep = stepOf("pay");
const reportStep = stepOf("report");
const nextStep = stepOf("next");

const bucketRank = new Map<TodayBucket, number>(todayBuckets.map((b, i) => [b, i]));

type RefKind = "creator" | "brand" | "deal";

function item(
  bucket: TodayBucket,
  kind: TodayItem["kind"],
  ref: { kind: RefKind; id: string } | null,
  minutes: number,
  over: Partial<TodayItem> = {},
): TodayItem {
  return {
    key: ref === null ? kind : `${kind}:${ref.id}`,
    bucket,
    kind,
    ref,
    draft: null,
    due: null,
    age: false,
    minutes,
    quick: false,
    owner: null,
    ...over,
  };
}

/** Everything that needs the person now, sorted: bucket, then due (none last), then key. */
export function todayItems(input: TodayInput): TodayItem[] {
  const { now, parts, reach } = input;
  const out: TodayItem[] = [];

  if (input.seesMoney && parts.deals) {
    for (const d of input.deals) {
      const ref = { kind: "deal", id: d.id } as const;
      const inv = d.invoice;
      if (d.step === invoiceStep && inv.sentAt === null) {
        out.push(item("money", "invoice", ref, 3, { due: d.goLiveAt }));
      }
      if (
        inv.sentAt !== null &&
        inv.paidAt === null &&
        inv.dueAt !== null &&
        inv.dueAt <= now + 3 * DAY
      ) {
        out.push(item("money", "collect", ref, 3, { due: inv.dueAt }));
      }
      if (inv.paidAt !== null && d.paidCreatorAt === null && d.step >= invoiceStep) {
        out.push(item("money", "payout", ref, 2, { due: inv.paidAt + 2 * DAY }));
      }
    }
  }

  if (parts.deals) {
    for (const d of input.deals) {
      if (d.step === invoiceStep || d.step === payStep || d.dueAt === null) {
        continue;
      }
      if (d.dueAt <= now + 2 * DAY) {
        const isNext = d.step === nextStep;
        const minutes = isNext ? 5 : d.step === reportStep ? 8 : 4;
        const ref = { kind: "deal", id: d.id } as const;
        out.push(item("deals", isNext ? "nextdeal" : "deal", ref, minutes, { due: d.dueAt }));
      }
    }
  }

  const answerDrafts = new Set<string>();
  for (const r of replyItems(input.creators, reach.threads, reach.drafts)) {
    if (r.draft !== null) {
      answerDrafts.add(r.draft.id);
    }
    if (r.state === "draft" || r.state === "your_move") {
      const ref = { kind: "creator", id: r.creator.id } as const;
      out.push(
        item("replies", "reply", ref, 3, { draft: r.draft?.id ?? null, due: r.at, age: true }),
      );
    }
  }

  for (const dr of reach.drafts) {
    if (!isOpenDraft(dr) || (dr.state !== "ready" && dr.state !== "failed")) {
      continue;
    }
    const ref = { kind: "creator", id: dr.creator } as const;
    if (dr.kind === "followUp") {
      out.push(
        item("followups", "followup", ref, 1, {
          key: `followup:${dr.id}`,
          draft: dr.id,
          due: now,
          quick: true,
        }),
      );
    } else if (!answerDrafts.has(dr.id)) {
      const quick = dr.state === "ready" && dr.problem === null;
      out.push(item("sends", "send", ref, 1.5, { key: `send:${dr.id}`, draft: dr.id, quick }));
    }
  }

  for (const c of input.creators) {
    const ref = { kind: "creator", id: c.id } as const;
    if (c.stage === "kit") {
      out.push(item("close", "audience", ref, 3));
    } else if (c.stage === "shortlisted") {
      out.push(item("contacts", "contact", ref, 2, { quick: c.email !== null }));
    }
  }

  if (parts.deals) {
    for (const b of input.brands) {
      const ref = { kind: "brand", id: b.id } as const;
      if (b.status === "pitched" && b.pitched !== null && b.pitched.at + 5 * DAY <= now) {
        const due = b.pitched.at + 5 * DAY;
        out.push(item("followups", "bnudge", ref, 2, { due, quick: true, owner: b.owner }));
      } else if (b.status === "found") {
        out.push(item("close", "qualify", ref, 4, { owner: b.owner }));
      } else if (b.status === "qualified") {
        out.push(item("close", "pitch", ref, 5, { owner: b.owner }));
      }
    }
  }

  if (input.newFinds > 0) {
    out.push(item("finds", "finds", null, Math.max(2, Math.round(input.newFinds / 2))));
  }

  return out
    .filter((i) => (input.snoozed[i.key] ?? 0) <= now)
    .sort(
      (a, b) =>
        (bucketRank.get(a.bucket) ?? 0) - (bucketRank.get(b.bucket) ?? 0) ||
        (a.due ?? Infinity) - (b.due ?? Infinity) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

/** The rail's counts by phase. */
export function phaseCounts(
  items: readonly TodayItem[],
  newFinds: number,
): { find: number; reach: number; close: number; deliver: number } {
  const n = { find: 0, reach: 0, close: 0, deliver: 0 };
  for (const i of items) {
    switch (i.bucket) {
      case "finds":
        n.find += newFinds;
        break;
      case "contacts":
        n.find += 1;
        break;
      case "replies":
      case "sends":
      case "followups":
        n.reach += 1;
        break;
      case "close":
        n.close += 1;
        break;
      case "money":
      case "deals":
        n.deliver += 1;
        break;
    }
  }
  return n;
}

/** Minutes the items take, rounded. */
export function plannedMinutes(items: readonly TodayItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.minutes, 0));
}

/** Keys to move to tomorrow, from the end of the list; the first item always stays. */
export function overBudget(
  items: readonly TodayItem[],
  budgetMinutes: number,
  doneMinutes: number,
): string[] {
  let planned = items.reduce((sum, i) => sum + i.minutes, 0);
  const keys: string[] = [];
  for (let i = items.length - 1; i > 0 && planned + doneMinutes > budgetMinutes; i--) {
    const it = items[i];
    if (it !== undefined) {
      keys.push(it.key);
      planned -= it.minutes;
    }
  }
  return keys;
}

/** Local time `dayOffset` days from `at`, at `hour`:00. */
function localAt(at: number, dayOffset: number, hour: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** When a snoozed item can come back, in local time. */
export function snoozeOptions(
  now: number,
  morning: number,
): { later: number | null; tomorrow: number; monday: number; twoWeeks: number } {
  const d = new Date(now);
  const toMonday = (8 - d.getDay()) % 7 || 7;
  return {
    later: d.getHours() < 14 ? localAt(now, 0, 15) : null,
    tomorrow: localAt(now, 1, morning),
    monday: localAt(now, toMonday, morning),
    twoWeeks: localAt(now, 14, morning),
  };
}

/** What waits for tomorrow: coming-back snoozes, follow-ups due, deal steps due. */
export function tomorrowItems(
  input: TodayInput,
  day: DayState,
): { snoozed: number; followUps: number; dealSteps: number } {
  const from = localAt(input.now, 1, 0);
  const to = localAt(input.now, 2, 0);
  const on = (t: number | null): boolean => t !== null && t >= from && t < to;
  let followUps = 0;
  for (const s of input.reach.sequences) {
    if (isRunning(s)) {
      followUps += s.steps.filter((st) => st.state === "planned" && on(st.dueAt)).length;
    }
  }
  return {
    snoozed: Object.values(day.snoozed).filter((s) => on(s.until)).length,
    followUps,
    dealSteps: input.parts.deals ? input.deals.filter((d) => on(d.dueAt)).length : 0,
  };
}

/** Drops what is old and caps the lists. */
export function pruneDay(day: DayState, now: number): DayState {
  const yesterday = localAt(now, -1, 0);
  const done = day.done
    .filter((e) => e.at >= yesterday)
    .sort((a, b) => b.at - a.at)
    .slice(0, doneMax);
  const snoozed = Object.entries(day.snoozed)
    .filter(([, s]) => s.until > now)
    .sort((a, b) => a[1].until - b[1].until)
    .slice(0, snoozedMax);
  return {
    ...day,
    done,
    snoozed: Object.fromEntries(snoozed),
    note: day.note.slice(0, dayNoteMax),
  };
}
