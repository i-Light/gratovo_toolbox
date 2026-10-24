import type { Fit } from "@gratovo/core/find";
import { cx } from "@gratovo/ui";

import { strings } from "../strings";

const text = strings.findTriage;

const radius = 8;
const circumference = 2 * Math.PI * radius;

/** The tooltip: the score, then the five parts as points out of share and why. */
export function fitTip(fit: Fit): string {
  return text.fitTip(
    fit.score,
    fit.parts.map((p) => text.fitPart(text.fitParts[p.key], p.points, p.of, p.note)).join(" · "),
  );
}

/** The fit score as a ring and a number; the tooltip lists the parts so nobody has to trust a bare number. */
export function FitChip({ fit }: { readonly fit: Fit }) {
  const { score } = fit;
  const tone = score >= 70 ? "good" : score >= 50 ? "warn" : "crit";
  const tip = fitTip(fit);
  return (
    <span className={cx("fit", tone)} data-tip={tip} role="img" aria-label={tip}>
      <svg viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
        <circle className="ring-bg" cx="11" cy="11" r={radius} fill="none" strokeWidth="3" />
        <circle
          className="ring-fg"
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          strokeLinecap="round"
        />
      </svg>
      <span>{score}</span>
    </span>
  );
}
