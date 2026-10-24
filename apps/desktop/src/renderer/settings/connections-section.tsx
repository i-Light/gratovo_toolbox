import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn, Empty, Icon } from "@gratovo/ui";
import { useState } from "react";

import { strings } from "../strings";
import { GeminiRow } from "./connections/gemini-row";
import { MailAppRow, MailboxesRow, MailSettingsRow } from "./connections/gmail-rows";
import { ImportDialog } from "./connections/import-dialog";
import { AwsRow, PacingRow, ProxiesRow } from "./connections/routing-rows";
import { CourseRow, OldDataRow, PythonRow, SyncRow, YoutubeRow } from "./connections/simple-rows";
import { useConnections } from "./connections/use-connections";

const text = strings.settings.connections;

/** The pieces that need a look, by name, in the order the rows show them. */
export function piecesNeedingALook(status: ConnectionsStatus): readonly string[] {
  const names: string[] = [];
  if (status.python.state === "missing") {
    names.push(text.pieces.python);
  }
  if (status.youtube.state === "unavailable") {
    names.push(text.pieces.youtube);
  }
  if (status.gemini.state === "failed" || status.gemini.problem !== null) {
    names.push(text.pieces.gemini);
  }
  if (status.mailboxes.some((m) => m.health === "signed-out" || m.health === "error")) {
    names.push(text.pieces.gmail);
  }
  if (status.course.courseDir !== null && !status.course.courseFound) {
    names.push(text.pieces.course);
  }
  if (status.sync.state === "offline" || status.sync.state === "stuck") {
    names.push(text.pieces.sync);
  }
  return names;
}

function Overview({ status }: { readonly status: ConnectionsStatus }) {
  const names = piecesNeedingALook(status);
  return names.length === 0 ? (
    <div className="callout good" role="status" data-ui="settings.connections.callout">
      <Icon name="check" />
      <div className="grow">{text.goodCallout}</div>
    </div>
  ) : (
    <div className="callout warn" role="status" data-ui="settings.connections.callout">
      <Icon name="alert" />
      <div className="grow">{text.needsLook(names.join(", "))}</div>
    </div>
  );
}

/** Settings › Connections: whether each piece behind the app is connected and working. */
export function ConnectionsSection() {
  const { status, load, reload } = useConnections();
  const [importing, setImporting] = useState(false);
  if (status === null) {
    return load === "failed" ? (
      <div className="card tight">
        <Empty
          icon="alert"
          title={text.loadFailed}
          action={
            <Btn size="sm" onClick={reload}>
              {text.retry}
            </Btn>
          }
        />
      </div>
    ) : null;
  }
  return (
    <>
      <Overview status={status} />
      <OldDataRow
        status={status}
        onOpen={() => {
          setImporting(true);
        }}
      />
      <MailAppRow status={status} />
      <MailboxesRow status={status} />
      <MailSettingsRow
        key={`${status.mail.label}|${status.mail.senderName ?? ""}`}
        status={status}
      />
      <GeminiRow status={status} />
      <CourseRow status={status} />
      <YoutubeRow status={status} />
      <PythonRow status={status} />
      <ProxiesRow status={status} />
      <PacingRow status={status} />
      <AwsRow status={status} />
      <SyncRow status={status} />
      {importing ? (
        <ImportDialog
          onClose={() => {
            setImporting(false);
          }}
        />
      ) : null}
    </>
  );
}
