/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { niceTicks, scaleLinear } from "./scale";
import { toneStyle, type Tone } from "./tone";
import "./charts.css";

export interface MonthBar {
  key: string;
  /** Label under the bar. */
  label: string;
  value: number;
  /** The text over the bar (already formatted). */
  display: string;
  /** The month is still running: the bar is paler, and this is where it ends at this pace. */
  projected?: number | null;
}

export interface MonthBarsProps {
  bars: readonly MonthBar[];
  height: number;
  tone?: Tone;
  /** A dashed line across the plot, with its label at the right. */
  goal?: { value: number; label: string } | null;
  yFormat: (v: number) => string;
  /** Words for the whole chart, for screen readers. */
  ariaLabel: string;
  /** Words for one bar; they are read as part of the whole chart's label, in order. */
  barLabel: (bar: MonthBar) => string;
}

/** One column a month, the running month paler with a dashed outline where it ends, and a dashed goal line. */
export function MonthBars({
  bars,
  height,
  tone = "series-live",
  goal = null,
  yFormat,
  ariaLabel,
  barLabel,
}: MonthBarsProps) {
  const highs = bars.flatMap((b) => [b.value, b.projected ?? 0]);
  if (goal !== null) highs.push(goal.value);
  const ticks = niceTicks(0, Math.max(0, ...highs), 4);
  const top = ticks[ticks.length - 1] ?? 1;
  const pct = scaleLinear(0, top, 0, 100);
  return (
    <div
      className="ch-months"
      role="img"
      aria-label={`${ariaLabel}: ${bars.map(barLabel).join(", ")}`}
      style={toneStyle(tone)}
    >
      <div className="ch-months__chart" style={{ height }}>
        <div className="ch-months__plot">
          {ticks.map((t) => (
            <div key={t} className="ch-months__grid" style={{ bottom: `${pct(t)}%` }}>
              <span>{yFormat(t)}</span>
            </div>
          ))}
          {goal === null ? null : (
            <div className="ch-months__goal" data-goal="" style={{ bottom: `${pct(goal.value)}%` }}>
              <span>{goal.label}</span>
            </div>
          )}
          <div className="ch-months__cols">
            {bars.map((b) => {
              const partial = b.projected !== undefined && b.projected !== null;
              return (
                <div key={b.key} className="ch-months__col" data-month={b.key}>
                  {partial ? (
                    <span
                      className="ch-months__proj"
                      data-projected=""
                      style={{ height: `${pct(b.projected ?? 0)}%` }}
                    />
                  ) : null}
                  <span
                    className={partial ? "ch-months__bar partial" : "ch-months__bar"}
                    data-bar=""
                    style={{ height: `${pct(b.value)}%` }}
                  />
                  <span
                    className="ch-months__value"
                    style={{ bottom: `calc(${pct(b.value)}% + 4px)` }}
                  >
                    {b.display}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="ch-months__labels">
          {bars.map((b) => (
            <span key={b.key}>{b.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
