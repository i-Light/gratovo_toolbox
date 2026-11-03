import { keywordKey } from "../find/keyword-lists";
import { judgedMin } from "../find/keyword-order";
import type { InsightsInputs } from "./inputs";
import type { Span, YieldReport, YieldRow } from "./types";

/**
 * Search › Yield (S6, K13): the period's finished keywords added up by the tool and the angle that
 * made them. Only keywords finished in the period with an in-range number count (those finished
 * before S6 have none). A keyword with no recorded origin was typed by hand.
 */

/** The most rows a list holds (the IPC schema's cap). */
export const yieldMax = 500;

interface Sum {
  /** The first spelling seen, shown as the row's name. */
  name: string;
  keywords: number;
  inRange: number;
  newFound: number;
}

function rowOf(s: Sum): YieldRow {
  return {
    name: s.name,
    keywords: s.keywords,
    inRange: s.inRange,
    newFound: s.newFound,
    perKeyword: s.keywords > 0 ? s.inRange / s.keywords : null,
    judged: s.keywords >= judgedMin,
  };
}

function listOf(sums: ReadonlyMap<string, Sum>): YieldRow[] {
  return [...sums.values()]
    .map((s) => rowOf(s))
    .sort(
      (a, b) =>
        Number(b.judged) - Number(a.judged) ||
        (b.perKeyword ?? -1) - (a.perKeyword ?? -1) ||
        b.keywords - a.keywords ||
        a.name.localeCompare(b.name),
    )
    .slice(0, yieldMax);
}

export function keywordYield(inputs: InsightsInputs, span: Span): YieldReport {
  const tools = new Map<string, Sum>();
  const angles = new Map<string, Sum>();
  const hand: Sum = { name: "", keywords: 0, inRange: 0, newFound: 0 };
  const bump = (m: Map<string, Sum>, name: string, k: { inRange: number; newFound: number }) => {
    const id = keywordKey(name);
    let s = m.get(id);
    if (s === undefined) {
      s = { name, keywords: 0, inRange: 0, newFound: 0 };
      m.set(id, s);
    }
    s.keywords += 1;
    s.inRange += k.inRange;
    s.newFound += k.newFound;
  };
  for (const k of inputs.keywords) {
    if (k.inRange === null || k.completedAt === null) continue;
    if (k.completedAt < span.from || k.completedAt > span.to) continue;
    const got = { inRange: k.inRange, newFound: k.newFound ?? 0 };
    if (k.tool === null || k.angle === null) {
      hand.keywords += 1;
      hand.inRange += got.inRange;
      hand.newFound += got.newFound;
    } else {
      bump(tools, k.tool, got);
      bump(angles, k.angle, got);
    }
  }
  return {
    byTool: listOf(tools),
    byAngle: listOf(angles),
    byHand: hand.keywords > 0 ? rowOf(hand) : null,
  };
}
