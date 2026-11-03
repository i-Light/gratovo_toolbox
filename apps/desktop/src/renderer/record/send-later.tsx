import type { OutreachDraft } from "@gratovo/core/data";
import { mondayAt9, theirMorning, tomorrowAt9 } from "@gratovo/core/reach";
import { Btn } from "@gratovo/ui";
import { useState } from "react";
import type { MouseEvent } from "react";

import { openMenu } from "../lib/actions";
import { dayWords, scheduleDraft, whenWords } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import type { MenuItem } from "../lib/store";
import { useNow } from "../lib/use-now";
import { strings } from "../strings";

const later = strings.reach.later;

/**
 * The Send later menu at the pressed button: their morning, tomorrow and Monday at 09:00, and
 * "Pick a time…" when `onPick` is given. `pick` gets the chosen time.
 */
export function openSendLater(
  event: MouseEvent<HTMLButtonElement>,
  zone: string | null,
  pick: (when: number) => void,
  onPick?: () => void,
): void {
  const box = event.currentTarget.getBoundingClientRect();
  const at = Date.now();
  const morning = theirMorning(zone, at);
  const tomorrow = tomorrowAt9(at);
  const monday = mondayAt9(at);
  const items: MenuItem[] = [
    { kind: "heading", label: later.menu },
    {
      kind: "item",
      label: later.theirMorning,
      hint: morning.theirs
        ? later.theirHint(whenWords(morning.at))
        : later.yoursHint(dayWords(morning.at)),
      icon: "sun",
      run: () => {
        pick(morning.at);
      },
    },
    {
      kind: "item",
      label: later.tomorrow,
      hint: dayWords(tomorrow),
      icon: "clock",
      run: () => {
        pick(tomorrow);
      },
    },
    {
      kind: "item",
      label: later.monday,
      hint: dayWords(monday),
      icon: "calendar",
      run: () => {
        pick(monday);
      },
    },
  ];
  if (onPick !== undefined) {
    items.push(
      { kind: "separator" },
      { kind: "item", label: later.pick, icon: "edit", run: onPick },
    );
  }
  openMenu(box, items, later.menu, "start");
}

const two = (n: number): string => String(n).padStart(2, "0");
/** A time as a `datetime-local` value, in the sender's time. */
const localValue = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * "Change time" on a scheduled email: the Send later choices, or a time typed in. It stays
 * scheduled; Cancel is a separate button.
 */
export function ChangeTime({
  draft,
  label,
}: {
  readonly draft: OutreachDraft;
  readonly label?: string;
}) {
  const zone = useApp((s) => s.data.reach.zones[draft.creator] ?? null);
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const move = (when: number): void => {
    scheduleDraft(draft.id, when);
  };
  const typedAt = picked === null || picked === "" ? Number.NaN : new Date(picked).getTime();
  return (
    <>
      <Btn
        size="sm"
        icon="clock"
        tip={later.changeTip}
        {...(label === undefined ? {} : { label })}
        onClick={(event) => {
          openSendLater(event, zone, move, () => {
            setPicked(localValue(draft.sendAt ?? Date.now() + 3_600_000));
          });
        }}
      >
        {later.change}
      </Btn>
      {picked === null ? null : (
        // Its own line: inline, a narrow panel put Set under Cancel (real-use week, 2026-11-03).
        <span className="row" style={{ gap: "4px", flexBasis: "100%" }} data-ui="reach.draft.pick">
          <input
            className="inp"
            type="datetime-local"
            aria-label={later.pickLabel}
            value={picked}
            min={localValue(now)}
            onChange={(event) => {
              setPicked(event.currentTarget.value);
            }}
          />
          <Btn
            size="sm"
            kind="pri"
            disabled={Number.isNaN(typedAt) || typedAt <= now}
            onClick={() => {
              if (scheduleDraft(draft.id, typedAt)) {
                setPicked(null);
              }
            }}
          >
            {later.pickSet}
          </Btn>
          <Btn
            size="sm"
            kind="ghost"
            onClick={() => {
              setPicked(null);
            }}
          >
            {later.pickCancel}
          </Btn>
        </span>
      )}
    </>
  );
}
