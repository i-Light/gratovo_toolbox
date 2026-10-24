import type { Fit } from "@gratovo/core/find";
import { cx } from "@gratovo/ui";
import { useId, useState } from "react";

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

/**
 * The fit score as a ring and a number. It is a button: pressing it (Enter or Space too) opens a
 * small list of the five parts and why, so the score never has to be taken on trust and a keyboard
 * can reach it. Esc or leaving it closes the list.
 */
export function FitChip({ fit }: { readonly fit: Fit }) {
  const { score } = fit;
  const tone = score >= 70 ? "good" : score >= 50 ? "warn" : "crit";
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <span className="fit-wrap">
      <button
        type="button"
        className={cx("fit", tone)}
        data-tip={fitTip(fit)}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={text.fit(score)}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
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
        <span aria-hidden="true">{score}</span>
      </button>
      <ul id={listId} className="fit-pop" hidden={!open} aria-label={text.fitDetail}>
        {fit.parts.map((p) => (
          <li key={p.key}>{text.fitPart(text.fitParts[p.key], p.points, p.of, p.note)}</li>
        ))}
      </ul>
    </span>
  );
}
