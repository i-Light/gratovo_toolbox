/* Numbers in template strings here are SVG and CSS geometry, never user words. */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import type { Tone } from "./tone";
import "./charts.css";

export interface Step {
  key: string;
  label: string;
  /** The count, formatted. */
  count: string;
  sub?: string;
  subTone?: Tone;
}

export interface StepLineProps {
  steps: readonly Step[];
  /** The share between step i and i+1, formatted; null draws a plain line. Length steps - 1. */
  shares: readonly (string | null)[];
  onPick?: (index: number) => void;
  ariaLabel?: string;
}

/** The pipeline at a glance: dots on one line, the share between steps on the line. */
export function StepLine({ steps, shares, onPick, ariaLabel }: StepLineProps) {
  return (
    <ol
      className="ch-steps"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const share = i < steps.length - 1 ? (shares[i] ?? null) : null;
        return (
          <li key={s.key} className="ch-steps__item">
            {i < steps.length - 1 ? (
              <span className="ch-steps__link" data-link="">
                {share !== null ? <span className="ch-steps__share">{share}</span> : null}
              </span>
            ) : null}
            <button type="button" className="ch-steps__btn" onClick={() => onPick?.(i)}>
              <span className="ch-steps__label">{s.label}</span>
              <span className="ch-steps__dot" data-dot="" />
              <span className="ch-steps__count">{s.count}</span>
              {s.sub ? (
                <span className={`ch-steps__sub ch-tone-${s.subTone ?? "muted"}`}>{s.sub}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
