import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn, Empty, Icon } from "@gratovo/ui";
import { useState } from "react";

import { strings } from "../strings";
import { GeminiRow } from "./connections/gemini-row";
import { MailAppRow } from "./connections/mail-app-row";
import { MailSettingsRow } from "./connections/mail-settings-row";
import { MailboxesRow } from "./connections/mailboxes-row";
import { ImportDialog } from "./connections/import-dialog";
import { AwsRow } from "./connections/aws-row";
import { PacingRow } from "./connections/pacing-row";
import { ProxiesRow } from "./connections/proxies-row";
import { CourseRow } from "./connections/course-row";
import { OldDataRow } from "./connections/old-data-row";
import { PythonRow } from "./connections/python-row";
import { SyncRow } from "./connections/sync-row";
import { YoutubeRow } from "./connections/youtube-row";
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

/** What isn't set up yet: nothing is broken, but the work that needs it can't run. */
export function piecesNotSetUp(status: ConnectionsStatus): readonly string[] {
  const names: string[] = [];
  if (status.import.state === "never") {
    names.push(text.pieces.oldData);
  }
  if (!status.mailApp.set) {
    names.push(text.pieces.mailApp);
  }
  if (status.mailboxes.length === 0) {
    names.push(text.pieces.mailboxes);
  }
  return names;
}

function Overview({ status }: { readonly status: ConnectionsStatus }) {
  const names = piecesNeedingALook(status);
  const unset = piecesNotSetUp(status);
  if (names.length > 0) {
    return (
      <div className="callout warn" role="status" data-ui="settings.connections.callout">
        <Icon name="alert" />
        <div className="grow col tight">
          <span>{text.needsLook(names.join(", "))}</span>
          {unset.length > 0 ? (
            <span className="small">{text.notSetUp(unset.join(", "))}</span>
          ) : null}
        </div>
      </div>
    );
  }
  return unset.length > 0 ? (
    <div className="callout info" role="status" data-ui="settings.connections.callout">
      <Icon name="info" />
      <div className="grow">{text.notSetUpCallout(unset.join(", "))}</div>
    </div>
  ) : (
    <div className="callout good" role="status" data-ui="settings.connections.callout">
      <Icon name="check" />
      <div className="grow">{text.goodCallout}</div>
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
