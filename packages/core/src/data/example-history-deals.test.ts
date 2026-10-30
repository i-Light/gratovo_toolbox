import { beforeAll, describe, expect, it } from "vitest";

import { DEAL_FLOW } from "../deal-flow";

import { exampleSeed } from "./example";
import { exampleHistory } from "./example-history";
import type { ExampleHistory } from "./example-history";
import { brandStatuses } from "./work-types";

/** 20 October 2026, 10:30 local time (the same fixed day as example-history.test.ts). */
const now = new Date(2026, 9, 20, 10, 30).getTime();
const DAY = 86_400_000;

type Gratovo = ExampleHistory["gratovo"];

let gratovo: Gratovo;

beforeAll(() => {
  const history = exampleHistory(now, "normal");
  if (history === null) throw new Error("The normal scenario has a history");
  gratovo = history.gratovo;
});

const ms = (text: string | null): number | null => (text === null ? null : Date.parse(text));

function near(actual: number, expected: number, share = 0.2): void {
  expect(actual).toBeGreaterThanOrEqual(expected * (1 - share));
  expect(actual).toBeLessThanOrEqual(expected * (1 + share));
}

const sum = (list: Gratovo["deals"]): number => list.reduce((a, d) => a + d.brand_price, 0);

function signedIds(): string[] {
  const seed = exampleSeed(now, "normal");
  return [
    ...seed.creators.filter((c) => c.stage === "signed").map((c) => c.id),
    ...gratovo.creators.filter((c) => c.creator_stage === "signed").map((c) => c.channel_id),
  ];
}

describe("the example history's brands and deals", () => {
  it("is null for the first scenario and the same for the same anchor", () => {
    expect(exampleHistory(now, "first")).toBeNull();
    const again = exampleHistory(now, "normal");
    expect(again?.gratovo.deals).toEqual(gratovo.deals);
    expect(again?.gratovo.dealDetails).toEqual(gratovo.dealDetails);
    expect(again?.gratovo.dealEvents).toEqual(gratovo.dealEvents);
    expect(again?.gratovo.brands).toEqual(gratovo.brands);
    expect(again?.gratovo.brandEvents).toEqual(gratovo.brandEvents);
  });

  it("has about 30 brands and 50 to 60 deals, with unique ids and names", () => {
    expect(gratovo.brands).toHaveLength(30);
    expect(gratovo.deals.length).toBeGreaterThanOrEqual(48);
    expect(gratovo.deals.length).toBeLessThanOrEqual(72);
    expect(gratovo.brandDetails).toHaveLength(gratovo.brands.length);
    expect(gratovo.dealDetails).toHaveLength(gratovo.deals.length);
    expect(new Set(gratovo.brands.map((b) => b.id)).size).toBe(gratovo.brands.length);
    expect(new Set(gratovo.deals.map((d) => d.id)).size).toBe(gratovo.deals.length);
    const seed = exampleSeed(now, "normal");
    const taken = new Set(seed.brands.map((b) => b.name.toLowerCase()));
    const seedBrandIds = new Set(seed.brands.map((b) => b.id));
    for (const b of gratovo.brands) {
      expect(taken.has(b.name.toLowerCase())).toBe(false);
      expect(seedBrandIds.has(b.id)).toBe(false);
      taken.add(b.name.toLowerCase());
    }
    const seedDealIds = new Set(seed.deals.map((d) => d.id));
    for (const d of gratovo.deals) expect(seedDealIds.has(d.id)).toBe(false);
  });

  it("links every deal to a brand and a signed creator", () => {
    const brands = new Set(gratovo.brands.map((b) => b.id));
    const signed = new Set(signedIds());
    for (const d of gratovo.deals) {
      expect(brands.has(d.brand_id)).toBe(true);
      expect(signed.has(d.channel_id)).toBe(true);
    }
    const dealBrands = new Set(gratovo.deals.map((d) => d.brand_id));
    for (const b of gratovo.brands) {
      expect(b.status === "won").toBe(dealBrands.has(b.id));
    }
  });

  it("walks every deal through consecutive steps in time order", () => {
    const byDeal = new Map<string, Gratovo["dealEvents"]>();
    for (const e of gratovo.dealEvents) {
      expect(e.source).toBe("example");
      expect(Number.isInteger(e.at)).toBe(true);
      byDeal.set(e.deal_id, [...(byDeal.get(e.deal_id) ?? []), e]);
    }
    for (const d of gratovo.deals) {
      const list = (byDeal.get(d.id) ?? []).sort((a, b) => a.step - b.step);
      expect(list.length).toBe(d.flow_step + 1);
      list.forEach((e, i) => {
        expect(e.step).toBe(i);
        expect(e.at).toBeLessThanOrEqual(now);
        if (i > 0) expect(e.at).toBeGreaterThan(list[i - 1]?.at ?? Infinity);
      });
      expect(list[0]?.at).toBe(Date.parse(d.created_at));
      expect(d.flow_step).toBeLessThan(DEAL_FLOW.length);
    }
  });

  it("has money in time order: invoice at go-live, due in 30 days, paid, then the payout", () => {
    for (const d of gratovo.deals) {
      const sent = ms(d.brand_invoice_sent_at);
      const paid = ms(d.brand_invoice_paid_at);
      const payout = ms(d.creator_payout_paid_at);
      const detail = gratovo.dealDetails.find((x) => x.deal_id === d.id);
      expect(detail).toBeDefined();
      if (sent !== null) {
        const goLive = detail?.go_live_at ?? 0;
        expect(sent).toBeGreaterThanOrEqual(goLive);
        expect(sent - goLive).toBeLessThan(DAY);
        expect(detail?.invoice_due_at).toBe(sent + 30 * DAY);
        expect(sent).toBeLessThanOrEqual(now);
      }
      if (paid !== null) {
        expect(sent).not.toBeNull();
        expect(paid).toBeGreaterThanOrEqual(sent ?? Infinity);
        expect(paid).toBeLessThanOrEqual(now);
      }
      if (payout !== null) {
        expect(paid).not.toBeNull();
        expect(payout).toBeGreaterThanOrEqual(paid ?? Infinity);
        expect(payout).toBeLessThanOrEqual(now);
      }
      expect(d.influencer_payout).toBeLessThan(d.brand_price);
    }
  });

  it("writes 30-day reports with views against the creator's usual", () => {
    let sent = 0;
    for (const d of gratovo.deals) {
      const detail = gratovo.dealDetails.find((x) => x.deal_id === d.id);
      const report = JSON.parse(detail?.report ?? "null") as {
        dueAt: number;
        sentAt: number | null;
        views: number | null;
        targetViews: number | null;
      };
      expect(report.dueAt).toBe((detail?.go_live_at ?? 0) + 30 * DAY);
      expect(report.targetViews).toBeGreaterThan(0);
      if (report.sentAt !== null) {
        sent += 1;
        expect(report.sentAt).toBeLessThanOrEqual(now);
        expect(report.views).toBeGreaterThan(0);
      } else {
        expect(report.views).toBeNull();
      }
    }
    expect(sent).toBeGreaterThan(25);
  });

  it("orders brand statuses in time, ends on the brand's own, and wins before the first deal", () => {
    const order: readonly string[] = brandStatuses;
    const byBrand = new Map<string, Gratovo["brandEvents"]>();
    for (const e of gratovo.brandEvents) {
      expect(e.at).toBeLessThanOrEqual(now);
      byBrand.set(e.brand_id, [...(byBrand.get(e.brand_id) ?? []), e]);
    }
    for (const b of gratovo.brands) {
      const list = byBrand.get(b.id) ?? [];
      expect(list.length).toBeGreaterThan(0);
      list.forEach((e, i) => {
        const before = list[i - 1];
        if (before === undefined) return;
        expect(e.at).toBeGreaterThan(before.at);
        if (e.status !== "lost") {
          expect(order.indexOf(e.status)).toBeGreaterThan(order.indexOf(before.status));
        }
      });
      expect(list[list.length - 1]?.status).toBe(b.status);
      const detail = gratovo.brandDetails.find((x) => x.brand_id === b.id);
      expect(detail?.status).toBe(b.status);
      expect(detail?.since).toBe(list[0]?.at);
    }
    for (const b of gratovo.brands.filter((x) => x.status === "won")) {
      const won = byBrand.get(b.id)?.find((e) => e.status === "won")?.at ?? Infinity;
      const first = Math.min(
        ...gratovo.deals.filter((d) => d.brand_id === b.id).map((d) => Date.parse(d.created_at)),
      );
      expect(won).toBeLessThanOrEqual(first);
    }
  });

  it("tells the money story within 20% of the plan's numbers", () => {
    const paidIn = (from: number, to: number): Gratovo["deals"] =>
      gratovo.deals.filter((d) => {
        const p = ms(d.brand_invoice_paid_at);
        return p !== null && p >= from && p < to;
      });
    const startOf = (k: number): number => {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth() - k, 1).getTime();
    };
    const months = [5, 4, 3, 2, 1].map((k) => sum(paidIn(startOf(k), startOf(k - 1))));
    // Paid by month rises to about $25K.
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i] ?? 0).toBeGreaterThan(months[i - 1] ?? 0);
    }
    near(months[4] ?? 0, 25_000);
    // This month is on pace for a little under it.
    const elapsed = Math.floor((now - startOf(0)) / DAY);
    const projected = (sum(paidIn(startOf(0), now + 1)) / elapsed) * 31;
    expect(projected).toBeLessThan(25_000);
    expect(projected).toBeGreaterThan(0.75 * 25_000);

    // Late invoices, one 31 to 60 days late; a few payouts due.
    const late = gratovo.deals
      .filter((d) => d.brand_invoice_sent_at !== null && d.brand_invoice_paid_at === null)
      .map((d) => Math.floor((now - (ms(d.brand_invoice_sent_at) ?? now) - 30 * DAY) / DAY))
      .filter((days) => days >= 1);
    expect(late.length).toBeGreaterThanOrEqual(2);
    expect(late.some((days) => days >= 31 && days <= 60)).toBe(true);
    const due = gratovo.deals.filter(
      (d) => d.brand_invoice_paid_at !== null && d.creator_payout_paid_at === null,
    );
    expect(due.length).toBeGreaterThanOrEqual(1);
    expect(due.length).toBeLessThanOrEqual(4);

    // Margin about 40% with one deal under the 25% floor; the average deal up.
    const recent = gratovo.deals.filter((d) => Date.parse(d.created_at) >= now - 90 * DAY);
    const before = gratovo.deals.filter((d) => {
      const made = Date.parse(d.created_at);
      return made < now - 90 * DAY && made >= now - 180 * DAY;
    });
    const margins = recent.map((d) => (d.brand_price - d.influencer_payout) / d.brand_price);
    near(margins.reduce((a, b) => a + b, 0) / margins.length, 0.4, 0.1);
    expect(margins.filter((m) => m < 0.25)).toHaveLength(1);
    near(sum(recent) / recent.length, 3_100);
    near(sum(before) / before.length, 2_600);

    // One brand over 40% of the last 90 days' revenue.
    const last90 = paidIn(now - 90 * DAY, now + 1);
    const totals = new Map<string, number>();
    for (const d of last90) totals.set(d.brand_id, (totals.get(d.brand_id) ?? 0) + d.brand_price);
    expect(Math.max(...totals.values()) / sum(last90)).toBeGreaterThan(0.4);
  });

  it("has a few open deals at every step, two stuck in Draft", () => {
    const perStep = new Array<number>(DEAL_FLOW.length).fill(0);
    for (const d of gratovo.deals) perStep[d.flow_step] = (perStep[d.flow_step] ?? 0) + 1;
    for (let step = 0; step < DEAL_FLOW.length; step += 1) {
      expect(perStep[step] ?? 0).toBeGreaterThanOrEqual(1);
    }
    const stuck = gratovo.deals.filter((d) => {
      if (d.flow_step !== 3) return false;
      const at = gratovo.dealEvents.find((e) => e.deal_id === d.id && e.step === 3)?.at ?? now;
      return now - at > 12 * DAY;
    });
    expect(stuck).toHaveLength(2);
  });

  it("keeps all but one signed creator busy, and leaves two reports without a next deal", () => {
    const lastDeal = new Map<string, number>();
    for (const d of gratovo.deals) {
      const made = Date.parse(d.created_at);
      lastDeal.set(d.channel_id, Math.max(lastDeal.get(d.channel_id) ?? 0, made));
    }
    const signedAt = new Map<string, number>();
    for (const e of gratovo.events) if (e.stage === "signed") signedAt.set(e.channel_id, e.at);
    const idle = signedIds().filter(
      (id) => now - (lastDeal.get(id) ?? signedAt.get(id) ?? 0) > 60 * DAY,
    );
    expect(idle).toHaveLength(1);

    let noNext = 0;
    for (const d of gratovo.deals) {
      const detail = gratovo.dealDetails.find((x) => x.deal_id === d.id);
      const report = JSON.parse(detail?.report ?? "null") as { sentAt: number | null };
      if (report.sentAt === null) continue;
      const newer = gratovo.deals.some(
        (o) => o.brand_id === d.brand_id && Date.parse(o.created_at) > (report.sentAt ?? 0),
      );
      if (!newer) noNext += 1;
    }
    expect(noNext).toBe(2);
  });

  it("is quick and moves with the anchor", () => {
    const started = performance.now();
    const later = exampleHistory(now, "later");
    expect(performance.now() - started).toBeLessThan(3000);
    expect(later?.gratovo.deals.length).toBeGreaterThan(40);
    for (const d of later?.gratovo.deals ?? []) {
      expect(Date.parse(d.updated_at)).toBeLessThanOrEqual(now - 7 * DAY);
    }
  });
});
