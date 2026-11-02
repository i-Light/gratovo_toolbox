/**
 * The example history's `run_routes` rows (S5, P7): how each example search run's requests left the
 * computer. Four AWS regions carry about half of them, twenty free proxies the rest, and this
 * machine only now and then. AWS is steady and rarely blocked; free proxies are cheap but often
 * blocked, each with a habit of its own. Keys are the table's column names; `run_id` is the run's
 * place in the history's `runs` (the first is 1, the order `example.load` inserts them in).
 */

export interface HistoryRouteRow {
  run_id: number;
  kind: "aws" | "free" | "direct";
  label: string;
  requests: number;
  successes: number;
  blocks: number;
  connection_failures: number;
  bytes: number;
  keywords_finished: number;
  channels_found: number;
  in_range_found: number;
  seconds_used: number;
  seconds_resting: number;
}

const awsRegions = [
  { label: "us-east-1", weight: 4, block: 0.012, inRange: 0.1 },
  { label: "us-west-2", weight: 3, block: 0.018, inRange: 0.095 },
  { label: "eu-west-1", weight: 2, block: 0.025, inRange: 0.085 },
  { label: "ap-southeast-1", weight: 1, block: 0.04, inRange: 0.08 },
] as const;

const freeCount = 20;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The routes of every run, in run order; `keywordsDone` is each run's finished keywords. */
export function exampleRunRoutes(keywordsDone: readonly number[]): HistoryRouteRow[] {
  const next = mulberry32(0x7075e5);
  const int = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
  // Each free proxy has a habit: how often it is blocked and how good its finds are.
  const free = Array.from({ length: freeCount }, (_, i) => ({
    label: `203.0.113.${String(10 + i * 11)}:${String(8000 + ((i * 37) % 1000))}`,
    block: 0.08 + next() * 0.3,
    inRange: 0.035 + next() * 0.04,
  }));
  const rows: HistoryRouteRow[] = [];
  keywordsDone.forEach((keywords, index) => {
    const runId = index + 1;
    if (keywords <= 0) return;
    const total = keywords * int(38, 58);
    const parts: {
      kind: HistoryRouteRow["kind"];
      label: string;
      share: number;
      block: number;
      inRange: number;
      kb: number;
    }[] = [];
    const awsWeight = awsRegions.reduce((s, r) => s + r.weight, 0);
    for (const r of awsRegions) {
      parts.push({
        kind: "aws",
        label: r.label,
        share: (0.55 * r.weight) / awsWeight,
        block: r.block,
        inRange: r.inRange,
        kb: 74,
      });
    }
    // A run leans on 8 to 13 of the 20 free proxies.
    const used = free.filter(() => next() < 0.55);
    for (const f of used) {
      parts.push({
        kind: "free",
        label: f.label,
        share: 0.42 / Math.max(1, used.length),
        block: f.block,
        inRange: f.inRange,
        kb: 81,
      });
    }
    if (next() < 0.12) {
      parts.push({
        kind: "direct",
        label: "This machine",
        share: 0.03,
        block: 0.06,
        inRange: 0.07,
        kb: 70,
      });
    }
    const shares = parts.reduce((s, p) => s + p.share, 0);
    for (const p of parts) {
      const requests = Math.max(1, Math.round((total * p.share) / shares));
      const blocks = Math.min(requests, Math.round(requests * p.block * (0.7 + next() * 0.6)));
      const failures = p.kind === "free" ? Math.round(requests * 0.06 * next()) : 0;
      const successes = requests - blocks - failures;
      const found = Math.round(successes * (0.14 + next() * 0.08));
      const inRange = Math.min(found, Math.round(requests * p.inRange * (0.8 + next() * 0.4)));
      rows.push({
        run_id: runId,
        kind: p.kind,
        label: p.label,
        requests,
        successes,
        blocks,
        connection_failures: failures,
        bytes: Math.round(successes * p.kb * 1000 * (0.9 + next() * 0.2)),
        keywords_finished: Math.round((keywords * requests) / total),
        channels_found: found,
        in_range_found: inRange,
        seconds_used: Math.round(requests * (0.9 + next() * 0.5) * 10) / 10,
        seconds_resting: p.kind === "free" ? Math.round(blocks * (30 + next() * 60)) : 0,
      });
    }
  });
  return rows;
}
