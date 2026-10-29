/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { toneStyle, type Tone } from "./tone";
import "./charts.css";

export interface BarListRow {
  key: string;
  label: string;
  value: number;
  /** The text at the right (already formatted). */
  display: string;
  tone?: Tone;
  onClick?: () => void;
}

export interface BarListProps {
  rows: readonly BarListRow[];
  /** The value that fills the track; default the largest row, so each list has its own scale. */
  max?: number;
  tone?: Tone;
  ariaLabel?: string;
}

export function BarList({ rows, max, tone = "series-live", ariaLabel }: BarListProps) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="ch-bars" aria-label={ariaLabel}>
      {rows.map((r) => {
        const width = top > 0 ? Math.min(1, Math.max(0, r.value / top)) * 100 : 0;
        const inner = (
          <>
            <span className="ch-bars__label">{r.label}</span>
            <span className="ch-bars__track">
              <span className="ch-bars__fill" data-bar="" style={{ width: `${width}%` }} />
            </span>
            <span className="ch-bars__value">{r.display}</span>
          </>
        );
        return (
          <li key={r.key} style={toneStyle(r.tone ?? tone)}>
            {r.onClick ? (
              <button
                type="button"
                className="ch-bars__row ch-bars__row--click"
                onClick={r.onClick}
              >
                {inner}
              </button>
            ) : (
              <div className="ch-bars__row">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface ShareBarProps {
  n: number;
  d: number;
  tone?: Tone;
  /** Position 0..1 of the "needed" mark. */
  neededAt?: number;
  /** Words for the mark, for screen readers. */
  neededLabel?: string;
  ariaLabel: string;
}

export function ShareBar({
  n,
  d,
  tone = "series-live",
  neededAt,
  neededLabel,
  ariaLabel,
}: ShareBarProps) {
  const share = d > 0 ? Math.min(1, Math.max(0, n / d)) : 0;
  return (
    <span className="ch-share" role="img" aria-label={ariaLabel} style={toneStyle(tone)}>
      <span className="ch-share__fill" data-share-fill="" style={{ width: `${share * 100}%` }} />
      {neededAt !== undefined ? (
        <span
          className="ch-share__mark"
          data-needed=""
          title={neededLabel}
          style={{ left: `${Math.min(1, Math.max(0, neededAt)) * 100}%` }}
        />
      ) : null}
    </span>
  );
}
