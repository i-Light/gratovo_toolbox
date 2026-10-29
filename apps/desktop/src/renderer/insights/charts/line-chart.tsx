/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import type { Point } from "@gratovo/core/insights";

import { niceTicks, scaleLinear } from "./scale";
import { toneStyle, type Tone } from "./tone";
import "./charts.css";

export interface LineChartProps {
  points: readonly Point[];
  /** Total height in px; the width fills the container. */
  height: number;
  tone?: Tone;
  /** Labels under the axis, placed by the same `at` values as the points. */
  xLabels?: readonly { at: number; label: string }[];
  /** Bands (for example weekends) in the same `at` units. */
  shaded?: readonly { from: number; to: number }[];
  /** The last point is "today so far": drawn hollow. */
  lastIsPartial?: boolean;
  /** About how many y ticks; 0 shows no y axis and only a baseline. */
  yTickCount?: number;
  yFormat?: (v: number) => string;
  ariaLabel: string;
}

const W = 1000;
const H = 100;

type Seg = { at: number; value: number }[];

export function LineChart({
  points,
  height,
  tone = "series-live",
  xLabels,
  shaded,
  lastIsPartial = false,
  yTickCount = 4,
  yFormat = (v) => String(v),
  ariaLabel,
}: LineChartProps) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const lo = values.length > 0 ? Math.min(0, ...values) : 0;
  const hi = values.length > 0 ? Math.max(0, ...values) : 0;
  const ticks = niceTicks(lo, hi, Math.max(1, yTickCount));
  const d0 = ticks[0] ?? 0;
  const d1 = ticks[ticks.length - 1] ?? 1;
  const yOf = scaleLinear(d0, d1, H, 0);

  const first = points[0]?.at ?? 0;
  const last = points[points.length - 1]?.at ?? 0;
  const xFrac = (at: number): number => (last === first ? 0.5 : (at - first) / (last - first));

  const segments: Seg[] = [];
  let run: Seg = [];
  for (const p of points) {
    if (p.value === null) {
      if (run.length > 0) segments.push(run);
      run = [];
    } else {
      run.push({ at: p.at, value: p.value });
    }
  }
  if (run.length > 0) segments.push(run);

  const lineOf = (seg: Seg): string =>
    seg
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${(xFrac(p.at) * W).toFixed(1)} ${yOf(p.value).toFixed(2)}`,
      )
      .join(" ");
  const areaOf = (seg: Seg): string => {
    const a = seg[0];
    const b = seg[seg.length - 1];
    if (!a || !b) return "";
    const base = yOf(Math.max(0, d0)).toFixed(2);
    return `${lineOf(seg)} L${(xFrac(b.at) * W).toFixed(1)} ${base} L${(xFrac(a.at) * W).toFixed(1)} ${base} Z`;
  };

  const lastPoint = points[points.length - 1];
  const showAxis = yTickCount > 0;

  return (
    <div
      className="ch-line"
      role="img"
      aria-label={ariaLabel}
      style={toneStyle(tone, { height })}
      data-axis={showAxis ? "y" : "none"}
      data-labels={(xLabels?.length ?? 0) > 0 ? "x" : "none"}
    >
      {showAxis
        ? ticks.map((t) => (
            <span
              key={t}
              className="ch-line__ytick"
              style={{ top: `${(yOf(t) / H) * 100}%` }}
              data-y-tick=""
            >
              {yFormat(t)}
            </span>
          ))
        : null}
      <div className="ch-line__plot">
        {(shaded ?? []).map((b, i) => {
          const from = Math.max(0, xFrac(b.from));
          const to = Math.min(1, xFrac(b.to));
          if (to <= from) return null;
          return (
            <div
              key={i}
              className="ch-line__band"
              data-band=""
              style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%` }}
            />
          );
        })}
        {(showAxis ? ticks : [d0]).map((t) => (
          <div
            key={t}
            className={t === d0 ? "ch-line__grid ch-line__grid--base" : "ch-line__grid"}
            style={{ top: `${(yOf(t) / H) * 100}%` }}
          />
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {segments.map((seg, i) =>
            seg.length > 1 ? (
              <g key={i}>
                <path className="ch-line__area" d={areaOf(seg)} />
                <path className="ch-line__path" d={lineOf(seg)} />
              </g>
            ) : null,
          )}
        </svg>
        {segments
          .filter((seg) => seg.length === 1)
          .map((seg) => {
            const p = seg[0];
            return p ? (
              <span
                key={p.at}
                className="ch-line__dot ch-line__dot--small"
                data-dot="single"
                style={{ left: `${xFrac(p.at) * 100}%`, top: `${(yOf(p.value) / H) * 100}%` }}
              />
            ) : null;
          })}
        {lastPoint && lastPoint.value !== null ? (
          <span
            className={lastIsPartial ? "ch-line__dot ch-line__dot--hollow" : "ch-line__dot"}
            data-dot={lastIsPartial ? "hollow" : "last"}
            style={{
              left: `${xFrac(lastPoint.at) * 100}%`,
              top: `${(yOf(lastPoint.value) / H) * 100}%`,
            }}
          />
        ) : null}
        <div className="ch-line__xs">
          {(xLabels ?? []).map((l) => {
            const f = xFrac(l.at);
            return (
              <span
                key={`${l.at}-${l.label}`}
                className={f < 0.04 ? "is-start" : f > 0.96 ? "is-end" : undefined}
                style={{ left: `${f * 100}%` }}
                data-x-label=""
              >
                {l.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
