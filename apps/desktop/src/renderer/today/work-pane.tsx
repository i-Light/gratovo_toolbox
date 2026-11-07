import type { TodayItem } from "@gratovo/core/today";
import { Btn, Icon } from "@gratovo/ui";
import { useEffect, useState } from "react";

import { peek, undo } from "../lib/actions";
import { appStore, useApp } from "../lib/store";
import type { ItemWords } from "../lib/today";
import { strings } from "../strings";
import { PaneBody } from "./pane-body";
import { snoozeMenu } from "./snooze-menu";
import { bucketHue, kindIcon } from "./today-view";

const text = strings.today.pane;
const nextOneMs = 4500;

/** The "next one" line: shows for 4.5 s after an item left the list, with Undo. */
function NextOne() {
  const just = useApp((s) => s.ui.today.justDone);
  const [born] = useState(() => Date.now());
  const top = useApp(() => appStore().peekUndo()?.id ?? null);
  const [gone, setGone] = useState<number | null>(null);
  const at = just?.at ?? null;
  useEffect(() => {
    if (at === null) {
      return undefined;
    }
    const id = setTimeout(
      () => {
        setGone(at);
      },
      Math.max(0, at + nextOneMs - Date.now()),
    );
    return () => {
      clearTimeout(id);
    };
  }, [at]);
  if (just === null || gone === just.at || just.at + nextOneMs <= born) {
    return null;
  }
  return (
    <div className="callout good" role="status" data-ui="today.work.next-one">
      <Icon name="checkc" />
      <span className="grow">{text.nextOne(just.title)}</span>
      {just.step !== null && just.step === top ? (
        <Btn size="sm" onClick={undo}>
          {text.undo}
        </Btn>
      ) : null}
    </div>
  );
}

/** The right-hand pane for the selected item: the header, then what the item needs. */
export function WorkPane({ item, words }: { readonly item: TodayItem; readonly words: ItemWords }) {
  const ref = item.ref;
  return (
    <section className="card tdy-work" data-ui="today.work" aria-label={words.title}>
      <div className="tdy-work-h">
        <span className="tdy-ico" style={{ color: bucketHue[item.bucket].hue }}>
          <Icon name={kindIcon[item.kind]} size={18} />
        </span>
        <div className="col grow" style={{ gap: "2px", minWidth: 0 }}>
          <h2>{words.title}</h2>
          <p className="muted">{words.why}</p>
        </div>
        <div className="row" style={{ gap: "6px" }}>
          {ref === null ? null : (
            <Btn
              size="sm"
              icon="eye"
              kbd="O"
              tip={text.recordTip}
              dataUi="today.record"
              onClick={() => {
                peek(ref);
              }}
            >
              {text.record}
            </Btn>
          )}
          <Btn
            size="sm"
            icon="clock"
            kbd="Z"
            tip={text.snoozeTip}
            dataUi="today.snooze"
            onClick={() => {
              snoozeMenu(item, words.title);
            }}
          >
            {text.snooze}
          </Btn>
        </div>
      </div>
      <NextOne />
      <PaneBody item={item} />
    </section>
  );
}
