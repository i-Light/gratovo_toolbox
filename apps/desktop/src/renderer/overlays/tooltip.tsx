import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Floating } from "./floating";

/** A tooltip waiting to be shown: its text, where it hangs from and the key hint. */
interface TipState {
  readonly text: string;
  readonly kbd: string | null;
  /** Centre of the element, and the line under it. */
  readonly x: number;
  readonly y: number;
  /** The element's top, for flipping above. */
  readonly top: number;
}

/** The wait before the first tip shows, in milliseconds. */
const delayMs = 480;
/** A tip shown again within this time of the last one shows at once. */
const warmMs = 700;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function tipTarget(event: Event): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip]") : null;
}

/**
 * The one tooltip for every element with `data-tip` (and `data-kbd` for a key hint). It shows after
 * 480 ms, at once when another tip was showing less than 700 ms ago, and hides on a press or a key.
 * It sits under the element, kept inside the window, and flips above when there is no room below,
 * and shows above any open dialog.
 */
export function Tooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warm = 0;
    const over = (event: MouseEvent): void => {
      const el = tipTarget(event);
      if (el === null) {
        clearTimeout(timer);
        shown.current = false;
        setTip(null);
        return;
      }
      const text = el.getAttribute("data-tip");
      if (text === null || text === "") {
        return;
      }
      clearTimeout(timer);
      const show = (): void => {
        const r = el.getBoundingClientRect();
        shown.current = true;
        setTip({
          text,
          kbd: el.getAttribute("data-kbd"),
          x: r.left + r.width / 2,
          y: r.bottom + 8,
          top: r.top,
        });
        warm = Date.now();
      };
      if (Date.now() - warm < warmMs) {
        show();
      } else {
        timer = setTimeout(show, delayMs);
      }
    };
    const out = (event: MouseEvent): void => {
      if (tipTarget(event) === null) {
        return;
      }
      clearTimeout(timer);
      if (shown.current) {
        warm = Date.now();
      }
      shown.current = false;
      setTip(null);
    };
    const hide = (): void => {
      clearTimeout(timer);
      shown.current = false;
      setTip(null);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("mousedown", hide);
    document.addEventListener("keydown", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("keydown", hide);
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ readonly x: number; readonly y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (tip === null || el === null) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      x: clamp(tip.x - w / 2, 8, window.innerWidth - w - 8),
      y: tip.y + h > window.innerHeight - 8 ? tip.top - h - 8 : tip.y,
    });
  }, [tip]);

  if (tip === null) {
    return null;
  }
  return (
    <Floating>
      <div
        ref={ref}
        className="tip"
        role="tooltip"
        style={{ left: `${String(pos?.x ?? -999)}px`, top: `${String(pos?.y ?? -999)}px` }}
      >
        {tip.text}
        {tip.kbd === null || tip.kbd === "" ? null : <span className="kbd">{tip.kbd}</span>}
      </div>
    </Floating>
  );
}
