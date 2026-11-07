import { Btn, IconBtn } from "@gratovo/ui";

import { stepRecord } from "../lib/actions";
import { useKeys } from "../lib/keys";
import { RecordBody } from "../overlays/record-summary";
import type { RecordRef } from "../lib/routes";
import { back, selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";

/**
 * The full-page record: a Back button and the record (creator, brand or deal) on a card. When it was
 * opened from a list, Previous and Next (Alt+Up, Alt+Down) step through that list. The keys are on
 * only while the side panel is closed, so the panel's own keys win when it is open over the page.
 */
export function RecordPage({ record }: { readonly record: RecordRef | undefined }) {
  const list = useApp((s) => selectRoute(s).list ?? null);
  const peekOpen = useApp((s) => s.ui.peek !== null);
  const i =
    list === null || record === undefined
      ? -1
      : list.findIndex((r) => r.kind === record.kind && r.id === record.id);
  const stepping = list !== null && list.length > 1 && i >= 0;
  useKeys(
    {
      "alt+arrowdown": () => {
        stepRecord(1);
      },
      "alt+arrowup": () => {
        stepRecord(-1);
      },
    },
    { active: stepping && !peekOpen },
  );
  const text = strings.peek;
  return (
    <div className="page" style={{ maxWidth: "1000px" }} data-ui="record.page">
      <div className="row">
        <Btn size="sm" kind="ghost" icon="arrowL" iconClassName="flip" onClick={back}>
          {strings.record.back}
        </Btn>
        {stepping ? (
          <>
            <span className="sp"></span>
            <span className="row" data-ui="record.page.step">
              <IconBtn
                icon="chevU"
                label={text.previous}
                kbd={strings.keys.altUp}
                disabled={i <= 0}
                onClick={() => {
                  stepRecord(-1);
                }}
              />
              <IconBtn
                icon="chevD"
                label={text.next}
                kbd={strings.keys.altDown}
                disabled={i >= list.length - 1}
                onClick={() => {
                  stepRecord(1);
                }}
              />
              <span className="small muted num">{text.counter(i + 1, list.length)}</span>
            </span>
          </>
        ) : null}
      </div>
      <div className="card" style={{ padding: "22px" }} data-ui="record.page.card">
        {record === undefined ? (
          <p className="hint">{strings.record.notFound}</p>
        ) : (
          <RecordBody key={`${record.kind}${record.id}`} record={record} layout="page" />
        )}
      </div>
    </div>
  );
}
