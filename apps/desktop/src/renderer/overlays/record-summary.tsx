import { Avatar, avatarColor } from "@gratovo/ui";

import type { RecordRef } from "../lib/routes";
import { findRecord, useApp } from "../lib/store";
import { isPartShown } from "../lib/wired";
import { BrandRecord } from "../record/brand-record";
import { DealRecord } from "../record/deal-record";
import { CreatorEmails } from "../record/creator-emails";
import { CreatorRecord } from "../record/creator-record";
import { isChannelId } from "../record/detail";
import { strings } from "../strings";
import { creatorSub } from "./record-text";

/**
 * A short summary of one record: its kind, who or what it is, its main line and a note that the
 * full record arrives with its screen. It stands in for the real record (steps 4 to 9) in the peek
 * panel and on the record page, so both already have something true to show.
 */
export function RecordSummary({
  record,
  tab,
}: {
  readonly record: RecordRef;
  /** The record tab asked for: "emails" adds the creator's emails under the summary. */
  readonly tab?: string;
}) {
  const data = useApp((s) => s.data);
  const found = findRecord(data, record);
  if (found === undefined) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  if (!("handle" in found)) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  const title = found.name;
  const sub = creatorSub(found);
  return (
    <>
      <div className="row" style={{ gap: "12px" }}>
        <Avatar name={found.name} color={avatarColor(found.handle)} size="xl" decorative />
        <div className="col tight" style={{ minWidth: 0 }}>
          <span className="small muted">{strings.record.kinds.creator}</span>
          <h2 className="ell">{title}</h2>
          <span className="small muted">{sub}</span>
        </div>
      </div>
      {record.kind === "creator" && tab === "emails" ? (
        <CreatorEmails creatorId={record.id} />
      ) : (
        <p className="hint">{strings.record.fullRecordLater}</p>
      )}
    </>
  );
}

/**
 * What the peek and the record page show for a record: the creator, brand or deal record. A creator
 * the catalog can't hold shows a short summary instead. An example-data creator that the page holds shows the summary
 * at once; on live data one the catalog lacks but the page still holds falls back to it.
 */
export function RecordBody({
  record,
  layout,
  tab,
}: {
  readonly record: RecordRef;
  readonly layout: "peek" | "page";
  /** The record tab to open on (the creator record's "emails"). */
  readonly tab?: string;
}) {
  const held = useApp((s) => s.data.creators.some((c) => c.id === record.id));
  const example = useApp((s) => s.data.source === "example");
  const source = useApp((s) => s.data.source);
  // A creator id that isn't a channel can't be in the catalog: asking would only flash a skeleton.
  // The example's creators have channel ids (step P1, F6): prototype mode's catalog holds them, and
  // in the plain example copy, whose catalog is empty, the record falls back to the summary. The id
  // decides, not whether the page holds it: an adopted channel keeps its full record.
  const dealsShown = isPartShown("record.deals", source);
  if (record.kind !== "creator" && !dealsShown) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  if (record.kind === "brand") {
    return <BrandRecord id={record.id} layout={layout} {...(tab === undefined ? {} : { tab })} />;
  }
  if (record.kind === "deal") {
    return <DealRecord id={record.id} layout={layout} {...(tab === undefined ? {} : { tab })} />;
  }
  if (example && !isChannelId(record.id)) {
    return <RecordSummary record={record} {...(tab === undefined ? {} : { tab })} />;
  }
  return (
    <CreatorRecord
      id={record.id}
      layout={layout}
      {...(tab === undefined ? {} : { tab })}
      fallback={
        held ? <RecordSummary record={record} {...(tab === undefined ? {} : { tab })} /> : undefined
      }
    />
  );
}
