import type { Fit } from "@gratovo/core/find";
import { cx } from "@gratovo/ui";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Floating } from "../overlays/floating";
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
 * can reach it. Esc, leaving it or a press elsewhere closes the list. The list is drawn in the
 * floating layer, not inside the card, so a card that clips its content (`content-visibility`) or a
 * table cell cannot cut it off.
 */
export function FitChip({ fit }: { readonly fit: Fit }) {
  const { score } = fit;
  const tone = score >= 70 ? "good" : score >= 50 ? "warn" : "crit";
  const [open, setOpen] = useState(false);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ readonly left: number; readonly top: number } | null>(null);

  // Put the list under the chip, its right edge on the chip's, kept inside the window; above the
  // chip when there is no room below.
  useLayoutEffect(() => {
    const chip = button.current;
    const pop = list.current;
    if (!open || chip === null || pop === null) {
      setPos(null);
      return;
    }
    const r = chip.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const below = r.bottom + 6;
    setPos({
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below,
    });
  }, [open]);

  // A press outside the chip and its list, or any scroll or resize (the list does not follow), closes it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (): void => {
      setOpen(false);
    };
    const press = (event: MouseEvent): void => {
      const at = event.target instanceof Node ? event.target : null;
      const inside =
        at !== null &&
        ((button.current?.contains(at) ?? false) || (list.current?.contains(at) ?? false));
      if (!inside) {
        close();
      }
    };
    document.addEventListener("mousedown", press);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", press);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="fit-wrap">
      <button
        ref={button}
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
      {open ? (
        <Floating>
          <ul
            ref={list}
            id={listId}
            className="fit-pop"
            aria-label={text.fitDetail}
            style={{
              left: `${String(pos?.left ?? -999)}px`,
              top: `${String(pos?.top ?? -999)}px`,
            }}
          >
            {fit.parts.map((p) => (
              <li key={p.key}>{text.fitPart(text.fitParts[p.key], p.points, p.of, p.note)}</li>
            ))}
          </ul>
        </Floating>
      ) : null}
    </span>
  );
}
