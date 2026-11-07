import { Icon } from "@gratovo/ui";
import type { TodayItem } from "@gratovo/core/today";

import type { ItemWords } from "../lib/today";
import { kindIcon } from "./today-view";

/** The right-hand pane for the selected item. The header only for now: the item's tools come with the next task. */
export function WorkPane({ item, words }: { readonly item: TodayItem; readonly words: ItemWords }) {
  return (
    <section className="card tdy-work" data-ui="today.work" aria-label={words.title}>
      <div className="tdy-work-h">
        <span className="tdy-ico">
          <Icon name={kindIcon[item.kind]} size={18} />
        </span>
        <div className="col grow" style={{ gap: "2px", minWidth: 0 }}>
          <h2>{words.title}</h2>
          <p className="muted">{words.why}</p>
        </div>
      </div>
    </section>
  );
}
