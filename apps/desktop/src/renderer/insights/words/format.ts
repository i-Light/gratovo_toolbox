import { rateOf } from "@gratovo/core/insights";
import type { Ratio } from "@gratovo/core/insights";

import { strings } from "../../strings";

const fmt = strings.insights.overview.fmt;

/** A whole number with thousands separators. */
export function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A number for reading: one decimal under 10, whole from 10, no trailing ".0". */
export function decimal(n: number): string {
  const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** A share 0..1 as a percentage: one decimal under 10%, none from 10%. */
export function pct(share: number): string {
  const tenths = Math.round(share * 1000) / 10;
  if (tenths === 0) return "0%";
  return tenths < 10 ? `${tenths.toFixed(1)}%` : `${String(Math.round(tenths))}%`;
}

/** A ratio's share as a percentage, or a dash when nothing was counted. */
export function ratioPct(r: Ratio): string {
  const v = rateOf(r);
  return v === null ? fmt.dash : pct(v);
}

/** A rate with its count: "4.9%, 9 of 182" (design rule 5). */
export function ratioText(r: Ratio): string {
  return rateOf(r) === null ? fmt.none : fmt.rate(ratioPct(r), num(r.n), num(r.d));
}

/** "9 of 182". */
export function ofText(n: number, d: number): string {
  return fmt.of(num(n), num(d));
}

/** "1 email", "182 emails". */
export function plural(n: number, pair: readonly [string, string]): string {
  return `${num(n)} ${n === 1 ? pair[0] : pair[1]}`;
}

/** "28 Sep", in this computer's time. */
export function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Wed", in this computer's time. */
export function weekdayLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { weekday: "short" });
}
