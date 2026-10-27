import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useRef, useState } from "react";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { StateTag } from "./state-tag";
import { saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

/** The Gmail app's client ID and secret: set only. After saving, nothing of them shows. */
export function MailAppRow({ status }: { readonly status: ConnectionsStatus }) {
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const isSet = status.mailApp.set;
  const showForm = !isSet || editing;
  const ready = id.trim() !== "" && secret.trim() !== "";
  const save = (): void => {
    if (!ready || saving.current) {
      return;
    }
    saving.current = true;
    setBusy(true);
    void saveChange(
      { kind: "mail.client", id: id.trim(), secret: secret.trim() },
      { row: "connMailApp", msg: text.mailApp.toast },
    ).then((ok) => {
      saving.current = false;
      setBusy(false);
      if (ok) {
        setId("");
        setSecret("");
        setEditing(false);
      }
    });
  };
  return (
    <Row
      id="connMailApp"
      label={rows.connMailApp.label}
      scope="team"
      desc={rows.connMailApp.desc}
      ui="settings.connections.mail-app"
    >
      <Line
        actions={
          isSet && !editing ? (
            <Btn
              size="sm"
              onClick={() => {
                setEditing(true);
              }}
            >
              {text.replace}
            </Btn>
          ) : null
        }
      >
        <StateTag tone={isSet ? "good" : undefined} icon={isSet ? "check" : undefined}>
          {isSet ? text.tags.set : text.tags.notSet}
        </StateTag>
        {showForm ? null : <span className="hint">{text.mailApp.isSet}</span>}
      </Line>
      {showForm ? (
        <form
          className="col"
          style={{ gap: "8px", width: "100%" }}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {isSet ? null : <span className="hint">{text.mailApp.notSet}</span>}
          <label className="field">
            {text.mailApp.id}
            <input
              className="inp"
              type="password"
              autoComplete="off"
              value={id}
              onChange={(event) => {
                setId(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field">
            {text.mailApp.secret}
            <input
              className="inp"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => {
                setSecret(event.currentTarget.value);
              }}
            />
          </label>
          <div className="row wrap">
            <Btn kind="pri" size="sm" icon="check" disabled={!ready || busy} onClick={save}>
              {text.mailApp.save}
            </Btn>
            {isSet ? (
              <Btn
                size="sm"
                kind="ghost"
                onClick={() => {
                  setEditing(false);
                  setId("");
                  setSecret("");
                }}
              >
                {text.cancel}
              </Btn>
            ) : null}
          </div>
        </form>
      ) : null}
    </Row>
  );
}
