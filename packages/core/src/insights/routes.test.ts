import { describe, expect, it } from "vitest";

import { otherRoutesLabel, routesMax, routesReport } from "./routes";
import type { RouteFact } from "./types";

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 28);

function fact(over: Partial<RouteFact>): RouteFact {
  return {
    runStartedAt: T,
    kind: "aws",
    label: "us-east-1",
    requests: 100,
    successes: 90,
    blocks: 10,
    connectionFailures: 0,
    bytes: 20_000_000,
    keywordsFinished: 4,
    channelsFound: 12,
    inRangeFound: 8,
    secondsUsed: 100,
    secondsResting: 0,
    ...over,
  };
}

const span = { from: T - 7 * DAY, to: T + DAY };

describe("routesReport", () => {
  it("is null while there is no table", () => {
    expect(routesReport(null, span)).toBeNull();
  });

  it("is empty when no run falls in the period", () => {
    const r = routesReport([fact({ runStartedAt: T - 30 * DAY })], span);
    expect(r).toEqual({ byKind: [], routes: [] });
  });

  it("adds a route's runs, and works out the ratios from the sums", () => {
    const r = routesReport(
      [
        fact({}),
        fact({
          runStartedAt: T - DAY,
          requests: 300,
          blocks: 30,
          inRangeFound: 16,
          bytes: 40_000_000,
        }),
        fact({ runStartedAt: T - 20 * DAY, requests: 9999 }),
      ],
      span,
    );
    expect(r?.routes).toHaveLength(1);
    const row = r?.routes[0];
    expect(row).toMatchObject({ kind: "aws", label: "us-east-1", requests: 400, blocks: 40 });
    expect(row?.blockRate).toBeCloseTo(0.1);
    expect(row?.inRangePer100).toBeCloseTo(6);
    expect(row?.mbPerKeyword).toBeCloseTo(7.5);
    expect(r?.byKind[0]).toMatchObject({ kind: "aws", routes: 1, requests: 400 });
  });

  it("gives null ratios for zero requests and zero finished keywords", () => {
    const r = routesReport(
      [fact({ kind: "free", label: "203.0.113.5", requests: 0, blocks: 0, keywordsFinished: 0 })],
      span,
    );
    expect(r?.routes[0]).toMatchObject({
      blockRate: null,
      inRangePer100: null,
      mbPerKeyword: null,
    });
  });

  it("groups by kind in a fixed order and counts routes, most requests first", () => {
    const r = routesReport(
      [
        fact({ kind: "free", label: "a", requests: 50 }),
        fact({ kind: "free", label: "b", requests: 70 }),
        fact({ kind: "aws", label: "us-east-1", requests: 10 }),
        fact({ kind: "direct", label: "This machine", requests: 5 }),
      ],
      span,
    );
    expect(r?.byKind.map((k) => [k.kind, k.routes, k.requests])).toEqual([
      ["aws", 1, 10],
      ["free", 2, 120],
      ["direct", 1, 5],
    ]);
    expect(r?.routes.map((x) => x.label)).toEqual(["b", "a", "us-east-1", "This machine"]);
  });

  it("folds the routes past the cap into one row per kind", () => {
    const facts = Array.from({ length: 1500 }, (_, i) =>
      fact({ kind: i % 2 === 0 ? "free" : "proxy", label: `h${String(i)}`, requests: 10 + i }),
    );
    const r = routesReport(facts, span);
    expect(r?.routes.length).toBeLessThanOrEqual(routesMax);
    const other = r?.routes.filter((x) => x.label === otherRoutesLabel) ?? [];
    expect(other.map((x) => x.kind).sort()).toEqual(["free", "proxy"]);
    const total = facts.reduce((s, f) => s + f.requests, 0);
    expect(r?.routes.reduce((s, x) => s + x.requests, 0)).toBe(total);
    expect(r?.byKind.reduce((s, k) => s + k.routes, 0)).toBe(1500);
  });
});
