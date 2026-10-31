import { Btn } from "@gratovo/ui";

import { RecordBody } from "../overlays/record-summary";
import type { RecordRef } from "../lib/routes";
import { back } from "../lib/store";
import { strings } from "../strings";

/**
 * The full-page record: a Back button and the record (creator, brand or deal) on a card.
 */
export function RecordPage({ record }: { readonly record: RecordRef | undefined }) {
  return (
    <div className="page" style={{ maxWidth: "1000px" }} data-ui="record.page">
      <div className="row">
        <Btn size="sm" kind="ghost" icon="arrowL" iconClassName="flip" onClick={back}>
          {strings.record.back}
        </Btn>
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
