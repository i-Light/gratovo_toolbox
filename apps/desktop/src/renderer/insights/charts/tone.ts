import type { CSSProperties } from "react";

/** The colour tokens a chart piece may use. Names only; never a hex value. */
export type Tone =
  | "series-live"
  | "series-waiting"
  | "series-archive"
  | "series-rules"
  | "series-neutral"
  | "ink"
  | "ink-2"
  | "muted"
  | "faint"
  | "line"
  | "good"
  | "warn"
  | "crit";

export function toneVar(tone: Tone): string {
  return `var(--${tone})`;
}

/** Inline style that sets the `--tone` custom property the chart CSS reads. */
export function toneStyle(tone: Tone, extra?: CSSProperties): CSSProperties {
  return { ...extra, ["--tone" as string]: toneVar(tone) };
}
