/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { niceTicks, scaleLinear } from "./scale";
import { toneStyle, type Tone } from "./tone";
import "./charts.css";

export interface PairedColumnsRow {
  key: string;
  /** Label under the pair. */
  label: string;
  a: number | null;
  b: number | null;
}

export interface PairedColumnsProps {
  rows: readonly PairedColumnsRow[];
  legend: { a: { label: string; tone: Tone }; b: { label: string; tone: Tone } };
  height: number;
  /** Show a label under every n-th pair (default 1). */
  labelEvery?: number;
  yTickCount?: number;
  ariaLabel: string;
}

export function PairedColumns({
  rows,
  legend,
  height,
  labelEvery = 1,
  yTickCount = 4,
  ariaLabel,
}: PairedColumnsProps) {
  const all = rows.flatMap((r) => [r.a, r.b]).filter((v): v is number => v !== null);
  const ticks = niceTicks(0, all.length > 0 ? Math.max(0, ...all) : 0, yTickCount);
  const top = ticks[ticks.length - 1] ?? 1;
  const pct = scaleLinear(0, top, 0, 100);

  return (
    <div className="ch-paired" role="img" aria-label={ariaLabel}>
      <div className="ch-legend">
        {(["a", "b"] as const).map((k) => (
          <span key={k} className="ch-legend__item" style={toneStyle(legend[k].tone)}>
            <i className="ch-legend__swatch" />
            {legend[k].label}
          </span>
        ))}
      </div>
      <div className="ch-paired__chart" style={{ height }}>
        <div className="ch-paired__plot">
          {ticks.map((t) => (
            <div key={t} className="ch-paired__grid" style={{ bottom: `${pct(t)}%` }}>
              <span>{t}</span>
            </div>
          ))}
          <div className="ch-paired__groups">
            {rows.map((r) => (
              <div key={r.key} className="ch-paired__group">
                {(["a", "b"] as const).map((k) => {
                  const v = r[k];
                  return v === null ? (
                    <span key={k} className="ch-paired__none" data-null="" />
                  ) : (
                    <span
                      key={k}
                      className="ch-paired__col"
                      data-col={k}
                      style={toneStyle(legend[k].tone, { height: `${pct(v)}%` })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="ch-paired__labels">
          {rows.map((r, i) => (
            <span key={r.key}>{i % Math.max(1, labelEvery) === 0 ? r.label : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
