import { Btn } from "@gratovo/ui";

import { RecordSummary } from "../overlays/record-summary";
import type { RecordRef } from "../lib/routes";
import { back } from "../lib/store";
import { strings } from "../strings";

/**
 * The full-page record: a Back button and the record's summary on a card. Until the real record
 * view comes with each screen (steps 4 to 9) the summary stands in for it.
 */
export function RecordPage({ record }: { readonly record: RecordRef | undefined }) {
  return (
    <div className="page" style={{ maxWidth: "1000px" }}>
      <div className="row">
        <Btn size="sm" kind="ghost" icon="arrowL" iconClassName="flip" onClick={back}>
          {strings.record.back}
        </Btn>
      </div>
      <div className="card" style={{ padding: "22px" }}>
        {record === undefined ? (
          <p className="hint">{strings.record.notFound}</p>
        ) : (
          <RecordSummary key={`${record.kind}${record.id}`} record={record} />
        )}
      </div>
    </div>
  );
}
