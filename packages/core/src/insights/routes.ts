import type {
  KindRouteRow,
  RouteFact,
  RouteKind,
  RouteRow,
  RoutesReport,
  RouteStats,
  Span,
} from "./types";
import { routeKinds } from "./types";

/**
 * Search › Routes (S5, P8): `run_routes` rows (one per run, kind and route) added up over the
 * period. Every ratio is null when its divisor is 0, never 0 (design rule: not known is null).
 */

interface Sum {
  requests: number;
  successes: number;
  blocks: number;
  bytes: number;
  keywords: number;
  inRange: number;
}

const zero = (): Sum => ({
  requests: 0,
  successes: 0,
  blocks: 0,
  bytes: 0,
  keywords: 0,
  inRange: 0,
});

function add(sum: Sum, f: RouteFact): void {
  sum.requests += f.requests;
  sum.successes += f.successes;
  sum.blocks += f.blocks;
  sum.bytes += f.bytes;
  sum.keywords += f.keywordsFinished;
  sum.inRange += f.inRangeFound;
}

function statsOf(s: Sum): RouteStats {
  return {
    requests: s.requests,
    successes: s.successes,
    blocks: s.blocks,
    blockRate: s.requests > 0 ? s.blocks / s.requests : null,
    inRange: s.inRange,
    inRangePer100: s.requests > 0 ? (s.inRange / s.requests) * 100 : null,
    mbPerKeyword: s.keywords > 0 ? s.bytes / s.keywords / 1e6 : null,
  };
}

/** The most routes a report lists (the IPC schema's cap); the rest fold into one row per kind. */
export const routesMax = 1000;

/** The label of a kind's folded row; the renderer shows its own words for it. */
export const otherRoutesLabel = "~other";

/** The period's routes; null when the table is not there (no route data yet). */
export function routesReport(facts: readonly RouteFact[] | null, span: Span): RoutesReport | null {
  if (facts === null) return null;
  const kinds = new Map<RouteKind, Sum>();
  const routes = new Map<string, { kind: RouteKind; label: string; sum: Sum }>();
  for (const f of facts) {
    if (f.runStartedAt < span.from || f.runStartedAt > span.to) continue;
    let k = kinds.get(f.kind);
    if (k === undefined) {
      k = zero();
      kinds.set(f.kind, k);
    }
    add(k, f);
    const key = `${f.kind}\u0000${f.label}`;
    let r = routes.get(key);
    if (r === undefined) {
      r = { kind: f.kind, label: f.label, sum: zero() };
      routes.set(key, r);
    }
    add(r.sum, f);
  }
  const byKind: KindRouteRow[] = routeKinds.flatMap((kind) => {
    const sum = kinds.get(kind);
    if (sum === undefined) return [];
    let n = 0;
    for (const r of routes.values()) if (r.kind === kind) n += 1;
    return [{ kind, routes: n, ...statsOf(sum) }];
  });
  const all = [...routes.values()].sort(
    (a, b) => b.sum.requests - a.sum.requests || a.label.localeCompare(b.label),
  );
  // Leave room for one folded row per kind.
  const keep = all.length > routesMax ? routesMax - routeKinds.length : all.length;
  const folded = new Map<RouteKind, Sum>();
  for (const r of all.slice(keep)) {
    let sum = folded.get(r.kind);
    if (sum === undefined) {
      sum = zero();
      folded.set(r.kind, sum);
    }
    sum.requests += r.sum.requests;
    sum.successes += r.sum.successes;
    sum.blocks += r.sum.blocks;
    sum.bytes += r.sum.bytes;
    sum.keywords += r.sum.keywords;
    sum.inRange += r.sum.inRange;
  }
  const rows: RouteRow[] = all
    .slice(0, keep)
    .map((r) => ({ kind: r.kind, label: r.label, ...statsOf(r.sum) }));
  for (const kind of routeKinds) {
    const sum = folded.get(kind);
    if (sum !== undefined) rows.push({ kind, label: otherRoutesLabel, ...statsOf(sum) });
  }
  return { byKind, routes: rows };
}
