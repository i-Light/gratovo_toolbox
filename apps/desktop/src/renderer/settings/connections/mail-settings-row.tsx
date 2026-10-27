import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { strings } from "../../strings";
import { Row } from "../row";
import { Problem } from "./problem";
import { saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

/** The sender name and the Gmail label every email carries. */
export function MailSettingsRow({ status }: { readonly status: ConnectionsStatus }) {
  const [sender, setSender] = useState(status.mail.senderName ?? "");
  const [label, setLabel] = useState(status.mail.label);
  const cleanLabel = label.trim();
  const cleanSender = sender.trim();
  const labelBad = cleanLabel.length < 1 || cleanLabel.length > 100;
  const senderBad = cleanSender.length > 100;
  const changed =
    cleanLabel !== status.mail.label || cleanSender !== (status.mail.senderName ?? "");
  return (
    <Row
      id="connMailSettings"
      label={rows.connMailSettings.label}
      scope="team"
      desc={rows.connMailSettings.desc}
      ui="settings.connections.mail-settings"
    >
      <label className="field" style={{ width: "100%" }}>
        {text.mailSettings.sender}
        <input
          className="inp"
          value={sender}
          aria-invalid={senderBad}
          onChange={(event) => {
            setSender(event.currentTarget.value);
          }}
        />
        <span className="hint">{text.mailSettings.senderHint}</span>
      </label>
      <label className="field" style={{ width: "100%" }}>
        {text.mailSettings.label}
        <input
          className="inp"
          value={label}
          aria-invalid={labelBad}
          onChange={(event) => {
            setLabel(event.currentTarget.value);
          }}
        />
        <span className="hint">{text.mailSettings.labelHint}</span>
      </label>
      {labelBad ? <Problem>{text.mailSettings.labelBad}</Problem> : null}
      {senderBad ? <Problem>{text.mailSettings.senderBad}</Problem> : null}
      <Btn
        kind="pri"
        size="sm"
        icon="check"
        disabled={!changed || labelBad || senderBad}
        onClick={() => {
          void saveChange(
            {
              kind: "mail.settings",
              label: cleanLabel,
              senderName: cleanSender === "" ? null : cleanSender,
            },
            { row: "connMailSettings" },
          );
        }}
      >
        {text.mailSettings.save}
      </Btn>
    </Row>
  );
}
