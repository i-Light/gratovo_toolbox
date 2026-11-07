import { snoozeOptions } from "@gratovo/core/today";
import type { TodayItem } from "@gratovo/core/today";

import { openMenu } from "../lib/actions";
import type { MenuItem } from "../lib/store";
import { whenWords } from "../lib/reach-actions";
import { appStore } from "../lib/store";
import { snooze } from "../lib/today-actions";
import { strings } from "../strings";

const text = strings.today.screen.snoozeMenu;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Where the snooze menu opens: under the Snooze button if the pane has one, else under the selected row. */
export function snoozeAnchor(): Box {
  const el =
    document.querySelector('[data-ui="today.snooze"]') ??
    document.querySelector('[data-ui="today.row"][aria-current="true"]');
  const rect = el?.getBoundingClientRect();
  return rect ?? { left: 0, right: 0, top: 0, bottom: 0 };
}

/** Opens the snooze menu for an item: Later today (before 14:00 only), Tomorrow morning, Next Monday morning, In two weeks. */
export function snoozeMenu(item: TodayItem, title: string, anchor: Box = snoozeAnchor()): void {
  const day = appStore().getState().data.settings.day;
  const options = snoozeOptions(Date.now(), day.morning);
  const entry = (label: string, until: number): MenuItem => ({
    kind: "item",
    label,
    icon: "clock",
    hint: whenWords(until),
    run: () => {
      snooze(item.key, title, until);
    },
  });
  const items: MenuItem[] = [];
  if (options.later !== null) {
    items.push(entry(text.later, options.later));
  }
  items.push(
    entry(text.tomorrow, options.tomorrow),
    entry(text.monday, options.monday),
    entry(text.twoWeeks, options.twoWeeks),
  );
  openMenu(anchor, items, text.label);
}
