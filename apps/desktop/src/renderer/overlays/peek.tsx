import { Btn, IconBtn } from "@gratovo/ui";

import { closePeek, openRecord, stepPeek } from "../lib/actions";
import { useReturnFocus } from "../lib/focus";
import { useKeys } from "../lib/keys";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { RecordBody } from "./record-summary";

/**
 * The side panel that shows a record next to the list. Previous and Next step through the list the
 * record was opened from; Full page opens the record on its own page. Its key layer is on only
 * while it is open (Esc, Alt+Up, Alt+Down) and is not a barrier, so keys it ignores still reach
 * the screen. Closed with focus inside it, it gives focus back to what had it before.
 */
export function Peek() {
  const peek = useApp((s) => s.ui.peek);
  useKeys(
    {
      escape: closePeek,
      "alt+arrowdown": () => {
        stepPeek(1);
      },
      "alt+arrowup": () => {
        stepPeek(-1);
      },
    },
    { active: peek !== null },
  );
  useReturnFocus(peek !== null);
  if (peek === null) {
    return null;
  }
  const list = peek.list ?? [];
  const i = list.indexOf(peek.record.id);
  const text = strings.peek;
  return (
    <aside className="peek" aria-label={text.label}>
      <div className="peek-h">
        {list.length > 1 ? (
          <>
            <IconBtn
              icon="chevU"
              label={text.previous}
              kbd={strings.keys.altUp}
              disabled={i <= 0}
              onClick={() => {
                stepPeek(-1);
              }}
            />
            <IconBtn
              icon="chevD"
              label={text.next}
              kbd={strings.keys.altDown}
              disabled={i >= list.length - 1}
              onClick={() => {
                stepPeek(1);
              }}
            />
            <span className="small muted num">{text.counter(i + 1, list.length)}</span>
          </>
        ) : null}
        <span className="sp"></span>
        <Btn
          size="sm"
          kind="ghost"
          icon="external"
          onClick={() => {
            openRecord(peek.record);
          }}
        >
          {text.fullPage}
        </Btn>
        <IconBtn icon="x" label={text.close} kbd={strings.keys.esc} onClick={closePeek} />
      </div>
      <div className="peek-b">
        <RecordBody
          key={`${peek.record.kind}${peek.record.id}`}
          record={peek.record}
          layout="peek"
        />
      </div>
    </aside>
  );
}
