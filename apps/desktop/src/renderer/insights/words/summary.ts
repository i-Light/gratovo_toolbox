import type { OverviewReport, Period, Verdict } from "@gratovo/core/insights";

import { strings } from "../../strings";
import {
  alertWords,
  emailsTile,
  fuelTile,
  replyRateTile,
  signedTile,
  summaryText,
  waitingTile,
} from "./overview";
import type { TileWords } from "./overview";
import { noNames } from "./names";
import type { Names } from "./names";

const t = strings.insights;
const d = t.summaryDoc;

function value(words: TileWords): string {
  return words.unit === undefined ? words.value : `${words.value} ${words.unit}`;
}

/**
 * The Overview as plain text for Copy summary: the heading, the summary sentences, the five vital
 * numbers with their verdict words, and the titles of what needs attention.
 */
export function summaryDocument(
  report: OverviewReport,
  period: Period,
  names: Names = noNames,
): string {
  const v = report.vitals;
  const tile = (label: string, words: TileWords, verdict: Verdict): string =>
    d.line(label, value(words), t.verdict[verdict]);
  const vitals = t.overview.vitals;
  const lines = [
    d.heading(t.comparedWith[period]),
    "",
    summaryText(report.summary, names),
    "",
    d.vitals,
    tile(vitals.emails.label, emailsTile(v.emails), v.emails.verdict),
    tile(vitals.replyRate.label, replyRateTile(v.replyRate), v.replyRate.verdict),
    tile(vitals.signed.label, signedTile(v.signedPer1000), v.signedPer1000.verdict),
    tile(vitals.fuel.label, fuelTile(v.fuel), v.fuel.verdict),
    tile(
      vitals.waiting.label,
      waitingTile(v.repliesWaiting, report.window.now),
      v.repliesWaiting.verdict,
    ),
    "",
    d.attention,
    ...(report.attention.length === 0
      ? [d.nothing]
      : report.attention.map((line) => `- ${alertWords(line.alert, names).title}`)),
  ];
  return lines.join("\n");
}
