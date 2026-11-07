import { Btn, Kbd } from "@gratovo/ui";

import { duration } from "../lib/format";
import { appStore } from "../lib/store";
import { strings } from "../strings";

const text = strings.today.screen.focus;

export function leaveFocus(): void {
  appStore().ui((ui) => {
    ui.today.focusAt = null;
  });
}

/** The bar that shows while focus is on: where you are in the list, time left and in, the keys. */
export function FocusBar({
  position,
  total,
  doneSince,
  minutesLeft,
  focusAt,
  now,
}: {
  /** 1-based place of the open item, or 0 when nothing is open. */
  readonly position: number;
  readonly total: number;
  readonly doneSince: number;
  readonly minutesLeft: number;
  readonly focusAt: number;
  readonly now: number;
}) {
  const all = doneSince + total;
  const share = all === 0 ? 100 : (100 * doneSince) / all;
  return (
    <div className="tdy-focusbar" data-ui="today.focus" role="group" aria-label={text.label}>
      <b>{text.label}</b>
      <span className="num">{text.position(position, total)}</span>
      <span
        className="meter good tdy-focus-meter"
        role="meter"
        aria-label={text.progress}
        aria-valuemin={0}
        aria-valuemax={Math.max(all, 1)}
        aria-valuenow={doneSince}
      >
        <i style={{ width: `${String(share)}%` }}></i>
      </span>
      <span className="muted num">{text.left(duration(minutesLeft))}</span>
      <span className="muted num">
        {text.minIn(Math.max(0, Math.floor((now - focusAt) / 60_000)))}
      </span>
      <span className="grow" />
      <span className="tdy-keys muted small">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd> {text.keys} <Kbd>Z</Kbd> {text.snooze}
      </span>
      <Btn size="sm" kbd="Esc" onClick={leaveFocus}>
        {text.leave}
      </Btn>
    </div>
  );
}
