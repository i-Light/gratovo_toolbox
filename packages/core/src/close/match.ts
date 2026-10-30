import type { Brand } from "../data";
import type { Match, MatchCreator, MatchReason, MatchWarning, MatchWorld } from "./engine-types";
import { priceFor } from "./pricing";

const goodCountries = ["US", "GB", "CA", "AU"];

/** The share of the top 3 countries that are US, UK, Canada or Australia, in %. */
function goodShare(c: MatchCreator): number {
  return c.countries
    .slice(0, 3)
    .filter((x) => goodCountries.includes(x.code))
    .reduce((sum, x) => sum + (x.share ?? 0), 0);
}

/** How well a brand fits a creator (ported from v6 `W.match`). */
export function matchOf(brand: Brand, c: MatchCreator, world: MatchWorld): Match {
  const why: MatchReason[] = [];
  const warn: MatchWarning[] = [];
  let pts = Math.round((c.fit ?? 0) * 0.6);

  if (c.sponsors.includes(brand.name)) {
    const past = world.deals.some((d) => d.brand === brand.id && d.creator === c.id);
    if (brand.status === "won" || past) {
      pts += 15;
      why.push({ kind: "repeat" });
    } else {
      pts -= 10;
      warn.push({ kind: "sponsoredDirect" });
    }
  }

  const lock =
    brand.category === null
      ? undefined
      : c.locks.find(
          (l) =>
            l.category === brand.category &&
            l.brand.toLowerCase() !== brand.name.toLowerCase() &&
            l.until > world.now,
        );
  if (lock !== undefined) {
    pts -= 25;
    warn.push({ kind: "lock", category: lock.category, brand: lock.brand, until: lock.until });
  } else if (brand.category !== null) {
    const competitor = c.sponsors.find(
      (name) =>
        name !== brand.name &&
        world.brands.some(
          (b) => b.category === brand.category && b.name.toLowerCase() === name.toLowerCase(),
        ),
    );
    if (competitor !== undefined) {
      pts -= 12;
      warn.push({ kind: "competitor", brand: competitor });
    }
  }

  if (c.dreamBrands.includes(brand.name)) {
    pts += 10;
    why.push({ kind: "dream" });
  }

  const share = goodShare(c);
  if (brand.country === "US" && c.countries[0]?.code === "US") {
    pts += 10;
    why.push({ kind: "usLed" });
  } else if (share >= 50) {
    pts += 6;
    why.push({ kind: "share", pct: share });
  }

  const price = priceFor(c, world.facts);
  if (brand.budget !== null) {
    if (price <= brand.budget.high) {
      pts += 12;
      why.push({ kind: "budgetFits", price, low: brand.budget.low, high: brand.budget.high });
    } else {
      warn.push({ kind: "overBudget", price, high: brand.budget.high });
    }
  }

  const mine = world.deals.filter((d) => d.creator === c.id);
  const clash = mine.find(
    (d) =>
      d.step < 9 &&
      d.brand !== brand.id &&
      brand.category !== null &&
      world.brands.some((b) => b.id === d.brand && b.category === brand.category),
  );
  if (clash !== undefined) {
    pts -= 30;
    warn.push({ kind: "liveClash", brandId: clash.brand });
  }

  const busy = mine.filter((d) => d.step < 6).length;
  if (busy >= 2) {
    warn.push({ kind: "busy", deals: busy });
  }

  return { score: Math.min(100, Math.max(0, pts)), why, warn, price };
}

/** The qualified or won brand that fits best with no warning; the first of equals. */
export function bestBrandFor(
  c: MatchCreator,
  world: MatchWorld,
): { brandId: string; match: Match } | null {
  let best: { brandId: string; match: Match } | null = null;
  for (const brand of world.brands) {
    if (brand.status !== "qualified" && brand.status !== "won") {
      continue;
    }
    const match = matchOf(brand, c, world);
    if (match.warn.length === 0 && (best === null || match.score > best.match.score)) {
      best = { brandId: brand.id, match };
    }
  }
  return best;
}
