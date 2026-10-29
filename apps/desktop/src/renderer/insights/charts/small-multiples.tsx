/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import type { Point } from "@gratovo/core/insights";

import { LineChart } from "./line-chart";
import type { Tone } from "./tone";
import "./charts.css";

export interface SmallMultiple {
  key: string;
  title: string;
  /** The big current value, formatted. */
  value: string;
  /** The change line, formatted ("+180 in 12 weeks"). */
  change: string;
  changeTone?: Tone;
  points: readonly Point[];
  tone: Tone;
  xLabels?: readonly { at: number; label: string }[];
  lastIsPartial?: boolean;
  ariaLabel: string;
}

export interface SmallMultiplesProps {
  items: readonly SmallMultiple[];
  /** Chart height in px (default 90). */
  chartHeight?: number;
}

/** Side-by-side mini line charts; each one is scaled to its own values. */
export function SmallMultiples({ items, chartHeight = 90 }: SmallMultiplesProps) {
  return (
    <div
      className="ch-multi"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}
    >
      {items.map((it) => (
        <section key={it.key} className="ch-multi__item" data-multi="">
          <header>
            <span className="ch-multi__title">{it.title}</span>
            <span className="ch-multi__value">{it.value}</span>
          </header>
          <LineChart
            points={it.points}
            height={chartHeight}
            tone={it.tone}
            yTickCount={0}
            lastIsPartial={it.lastIsPartial ?? false}
            ariaLabel={it.ariaLabel}
            {...(it.xLabels ? { xLabels: it.xLabels } : {})}
          />
          <p className={`ch-multi__change ch-tone-${it.changeTone ?? "muted"}`}>{it.change}</p>
        </section>
      ))}
    </div>
  );
}
