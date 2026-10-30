import type { AgencyFacts } from "../data";
import type { Package, PriceFormat, PriceInput, PriceOptions } from "./engine-types";

/** What a creator is priced on when no views are known. */
const defaultViews = 45_000;

const formatMultiplier: Record<PriceFormat, number> = {
  integration: 1,
  shoutout: 0.7,
  dedicated: 2.5,
  short: 0.65,
};

/** Rounds to the nearest $50. */
function round50(value: number): number {
  return Math.round(value / 50) * 50;
}

/** What a brand pays for one integration by this creator (ported from v6 `W.priceFor`). */
export function priceFor(c: PriceInput, facts: AgencyFacts, opts: PriceOptions = {}): number {
  const views = c.views ?? defaultViews;
  const cpmBase = round50((views / 1000) * facts.cpm);
  const rate = c.rate ?? 0;
  let base: number;
  if (c.relationship === "exclusive_25") {
    // The creator's rate is the creator's share of the brand's price: gross = rate / (1 - commission).
    const gross = rate > 0 ? round50(rate / (1 - facts.commissionPct / 100)) : cpmBase;
    base = Math.max(cpmBase, gross);
  } else {
    base = Math.max(cpmBase, round50(rate * (1 + facts.markupPct / 100)));
  }
  let price = round50(base * formatMultiplier[opts.format ?? "integration"]);
  if (opts.whitelisting === true) {
    price = round50(price * 1.25);
  }
  const bundle = opts.bundle ?? 0;
  if (bundle >= 3) {
    price = round50(price * bundle * 0.92);
  }
  return price;
}

/** What the creator gets from a gross price (ported from v6 `W.payoutFor`). */
export function payoutFor(c: PriceInput, gross: number, facts: AgencyFacts): number {
  if (c.relationship === "exclusive_25") {
    return round50(gross * (1 - facts.commissionPct / 100));
  }
  return c.rate ?? round50(gross * 0.62);
}

/** The three packages a pitch offers: single, 3-video bundle and takeover. Empty for no creators. */
export function packagesFor(
  cs: readonly (PriceInput & { readonly id: string })[],
  facts: AgencyFacts,
): Package[] {
  const first = cs[0];
  if (first === undefined) {
    return [];
  }
  const takeover =
    cs.reduce((sum, c) => sum + priceFor(c, facts), 0) +
    round50(priceFor(first, facts, { format: "short" }) * 0.85);
  const known = cs.filter((c) => c.views !== null);
  return [
    { key: "single", price: priceFor(first, facts), creators: [first.id], views: first.views },
    {
      key: "bundle",
      price: priceFor(first, facts, { bundle: 3 }),
      creators: [first.id],
      views: first.views,
    },
    {
      key: "takeover",
      price: takeover,
      creators: cs.map((c) => c.id),
      views: known.length === 0 ? null : known.reduce((sum, c) => sum + (c.views ?? 0), 0),
    },
  ];
}
