import { describe, expect, it } from "vitest";

import { buildScorer, reorderQueue } from "./keyword-order";
import type { OrderEntry, YieldSample } from "./keyword-order";

const many = (tool: string, angle: string, n: number, inRange: number | null): YieldSample[] =>
  Array.from({ length: n }, () => ({ origin: { tool, angle }, inRange }));

describe("buildScorer", () => {
  it("does not judge a group under 5 keywords", () => {
    const s = buildScorer([...many("a", "x", 4, 10), ...many("b", "y", 6, 0)]);
    expect(s.score({ tool: "a", angle: "zz" })).toBeCloseTo(s.mean);
    expect(s.rank({ tool: "a", angle: "zz" })).toBeNull();
  });

  it("ranks strong up, weak back, no origin neutral; ignores unjudged rows", () => {
    const s = buildScorer([
      ...many("a", "x", 6, 10),
      ...many("b", "y", 6, 0),
      ...many("c", "z", 9, null),
    ]);
    expect(s.mean).toBe(5);
    expect(s.rank({ tool: "a", angle: "x" })).toBe("up");
    expect(s.rank({ tool: "b", angle: "y" })).toBe("back");
    expect(s.score(null)).toBe(5);
    expect(s.rank(null)).toBeNull();
  });
});

describe("reorderQueue", () => {
  const scorer = buildScorer([...many("a", "x", 6, 10), ...many("b", "y", 6, 0)]);
  const e = (key: string, state: OrderEntry["state"], tool?: string, angle = ""): OrderEntry => ({
    key,
    state,
    origin: tool === undefined ? null : { tool, angle },
  });
  const strong = (key: string, state: OrderEntry["state"] = "queued") => e(key, state, "a", "x");
  const weak = (key: string, state: OrderEntry["state"] = "queued") => e(key, state, "b", "y");

  it("puts strong first, weak last, ties in added order, keeps count", () => {
    const q = [
      weak("w1"),
      e("n1", "queued"),
      strong("s1"),
      e("n2", "queued"),
      weak("w2"),
      strong("s2"),
    ];
    const out = reorderQueue(q, -1, scorer);
    expect(out.map((x) => x.key)).toEqual(["s1", "s2", "n1", "n2", "w1", "w2"]);
    expect(out).toHaveLength(q.length);
  });

  it("keeps done, failed, running and the at entry in place", () => {
    const q = [
      weak("d", "done"),
      weak("at"),
      weak("w"),
      strong("f", "failed"),
      weak("r", "running"),
      strong("s"),
    ];
    const out = reorderQueue(q, 1, scorer);
    expect(out.map((x) => x.key)).toEqual(["d", "at", "s", "f", "r", "w"]);
  });
});
