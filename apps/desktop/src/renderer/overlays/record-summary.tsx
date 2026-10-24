import { Avatar, Icon, avatarColor } from "@gratovo/ui";
import type { CSSProperties } from "react";

import type { RecordRef } from "../lib/routes";
import { dealName, findRecord, useApp } from "../lib/store";
import { CreatorRecord } from "../record/creator-record";
import { strings } from "../strings";
import { brandSub, creatorSub, dealSub } from "./record-text";

const tileStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "var(--r-md, 10px)",
  background: "var(--sunk)",
  display: "grid",
  placeItems: "center",
  flex: "none",
};

/**
 * A short summary of one record: its kind, who or what it is, its main line and a note that the
 * full record arrives with its screen. It stands in for the real record (steps 4 to 9) in the peek
 * panel and on the record page, so both already have something true to show.
 */
export function RecordSummary({ record }: { readonly record: RecordRef }) {
  const data = useApp((s) => s.data);
  const found = findRecord(data, record);
  if (found === undefined) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  let face;
  let title: string;
  let sub: string;
  if (record.kind === "creator" && "handle" in found) {
    face = <Avatar name={found.name} color={avatarColor(found.handle)} size="xl" decorative />;
    title = found.name;
    sub = creatorSub(found);
  } else if (record.kind === "brand" && "sells" in found) {
    face = (
      <span style={tileStyle}>
        <Icon name="flag" size={20} />
      </span>
    );
    title = found.name;
    sub = brandSub(found);
  } else if ("brand" in found) {
    face = (
      <span style={tileStyle}>
        <Icon name="box" size={20} />
      </span>
    );
    title = dealName(data, found);
    sub = dealSub(found);
  } else {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  return (
    <>
      <div className="row" style={{ gap: "12px" }}>
        {face}
        <div className="col tight" style={{ minWidth: 0 }}>
          <span className="small muted">{strings.record.kinds[record.kind]}</span>
          <h2 className="ell">{title}</h2>
          <span className="small muted">{sub}</span>
        </div>
      </div>
      <p className="hint">{strings.record.fullRecordLater}</p>
    </>
  );
}

/**
 * What the peek and the record page show for a record: the creator record for a creator, the
 * summary for a brand or a deal. An example-data creator that the page holds shows the summary
 * at once; on live data one the catalog lacks but the page still holds falls back to it.
 */
export function RecordBody({
  record,
  layout,
}: {
  readonly record: RecordRef;
  readonly layout: "peek" | "page";
}) {
  const held = useApp((s) => s.data.creators.some((c) => c.id === record.id));
  const example = useApp((s) => s.data.source === "example");
  // Example creators (c1, c2 ...) are not in the catalog: asking would only flash a skeleton.
  if (record.kind !== "creator" || (example && held)) {
    return <RecordSummary record={record} />;
  }
  return (
    <CreatorRecord
      id={record.id}
      layout={layout}
      fallback={held ? <RecordSummary record={record} /> : undefined}
    />
  );
}
