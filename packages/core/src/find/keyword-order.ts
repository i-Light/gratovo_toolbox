import { keywordKey } from "./keyword-lists";

export const judgedMin = 5;

export interface KeywordOrigin {
  tool: string;
  angle: string;
}

/** A finished keyword with its yield; `inRange` null means it was never judged. */
export interface YieldSample {
  origin: KeywordOrigin | null;
  inRange: number | null;
}

export type KeywordRank = "up" | "back" | null;

export interface KeywordScorer {
  /** Mean in-range channels per keyword over all usable samples. */
  mean: number;
  score(origin: KeywordOrigin | null): number;
  rank(origin: KeywordOrigin | null): KeywordRank;
}

interface Group {
  sum: number;
  n: number;
}

export function buildScorer(samples: readonly YieldSample[]): KeywordScorer {
  const used: { origin: KeywordOrigin; inRange: number }[] = [];
  for (const s of samples) {
    if (s.origin !== null && s.inRange !== null) {
      used.push({ origin: s.origin, inRange: s.inRange });
    }
  }
  const mean = used.length === 0 ? 0 : used.reduce((n, u) => n + u.inRange, 0) / used.length;
  const group = (pick: (o: KeywordOrigin) => string): Map<string, Group> => {
    const m = new Map<string, Group>();
    for (const u of used) {
      const k = keywordKey(pick(u.origin));
      const g = m.get(k) ?? { sum: 0, n: 0 };
      g.sum += u.inRange;
      g.n += 1;
      m.set(k, g);
    }
    return m;
  };
  const tools = group((o) => o.tool);
  const angles = group((o) => o.angle);
  const one = (m: Map<string, Group>, name: string): { s: number; judged: boolean } => {
    const g = m.get(keywordKey(name));
    if (g === undefined || g.n < judgedMin) return { s: mean, judged: false };
    return { s: (g.sum + judgedMin * mean) / (g.n + judgedMin), judged: true };
  };
  const both = (origin: KeywordOrigin | null): { score: number; judged: boolean } => {
    if (origin === null) return { score: mean, judged: false };
    const t = one(tools, origin.tool);
    const a = one(angles, origin.angle);
    return { score: (t.s + a.s) / 2, judged: t.judged || a.judged };
  };
  return {
    mean,
    score: (origin) => both(origin).score,
    rank: (origin) => {
      const { score, judged } = both(origin);
      if (!judged) return null;
      if (score > mean) return "up";
      return score < mean ? "back" : null;
    },
  };
}

export interface OrderEntry {
  state: "queued" | "running" | "done" | "failed";
  /** keywordKey of the keyword. */
  key: string;
  origin: KeywordOrigin | null;
}

/**
 * Stable re-sort of the queued entries after index `at` by score (high first), into the
 * slots those entries already hold. Everything else keeps its place.
 */
export function reorderQueue<T extends OrderEntry>(
  entries: readonly T[],
  at: number,
  scorer: KeywordScorer,
): T[] {
  const slots: number[] = [];
  entries.forEach((entry, i) => {
    if (i > at && entry.state === "queued") slots.push(i);
  });
  const sorted = slots
    .map((i, order) => {
      const e = entries[i] as T;
      return { e, order, score: scorer.score(e.origin) };
    })
    .sort((x, y) => y.score - x.score || x.order - y.order);
  const out = entries.slice();
  slots.forEach((slot, n) => {
    out[slot] = (sorted[n] as { e: T }).e;
  });
  return out;
}
