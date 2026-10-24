import type { ConnectionsStatus } from "@gratovo/ipc";
import { mailboxCapMax, mailboxCapMin, mailboxesMax } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useRef, useState } from "react";

import { toast } from "../../lib/toast";
import { strings } from "../../strings";
import { Row } from "../row";
import { whenText } from "./format";
import { Confirm, Line, Problem, StateTag, Stepper } from "./parts";
import { applyConnections, ask, failToast, loadConnections, saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;
type Mailbox = ConnectionsStatus["mailboxes"][number];

const healthTone = { ok: "good", "signed-out": "crit", error: "crit", unknown: undefined } as const;
const healthWords = {
  ok: text.tags.ok,
  "signed-out": text.tags.signedOut,
  error: text.tags.error,
  unknown: text.tags.unknown,
} as const;

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
      ui="settings.connections.mailApp"
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

function MailboxLine({ box }: { readonly box: Mailbox }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { address } = box;
  const update = (patch: { dailyCap?: number; warmupStartedOn?: string | null }): void => {
    void saveChange(
      {
        kind: "mailbox.update",
        address,
        dailyCap: patch.dailyCap ?? box.dailyCap,
        warmupStartedOn:
          patch.warmupStartedOn === undefined ? box.warmupStartedOn : patch.warmupStartedOn,
      },
      { row: "connMailboxes" },
    );
  };
  const remove = (): void => {
    setBusy(true);
    void saveChange(
      { kind: "mailbox.remove", address },
      {
        row: "connMailboxes",
        msg: text.mailboxes.removed(address),
        sub: text.mailboxes.removedSub,
      },
    ).then((ok) => {
      setBusy(false);
      if (ok) {
        setAsking(false);
      }
    });
  };
  return (
    <div
      className="col"
      style={{ gap: "8px", width: "100%", padding: "8px 0", borderTop: "1px solid var(--line)" }}
      data-ui="settings.connections.mailbox"
    >
      <Line
        actions={
          <Btn
            size="sm"
            kind="ghost"
            icon="trash"
            label={`${text.remove} ${address}`}
            onClick={() => {
              setAsking(true);
            }}
          >
            {text.remove}
          </Btn>
        }
      >
        <b style={{ fontWeight: 600 }}>{address}</b>
        <StateTag tone={healthTone[box.health]} icon={box.health === "ok" ? "check" : undefined}>
          {healthWords[box.health]}
        </StateTag>
        <span className="small ink2">
          {box.checkedAt === null
            ? text.mailboxes.neverChecked
            : text.mailboxes.checked(whenText(box.checkedAt))}
        </span>
      </Line>
      <div className="row wrap" style={{ gap: "16px" }}>
        <div className="col tight">
          <Stepper
            value={box.dailyCap}
            min={mailboxCapMin}
            max={mailboxCapMax}
            label={text.mailboxes.cap(address)}
            upLabel={text.mailboxes.capUp(address)}
            downLabel={text.mailboxes.capDown(address)}
            onChange={(dailyCap) => {
              update({ dailyCap });
            }}
          />
          <span className="hint">{text.mailboxes.capHint}</span>
        </div>
        <input
          className="inp"
          type="date"
          aria-label={text.mailboxes.warmup(address)}
          value={box.warmupStartedOn ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            update({ warmupStartedOn: value === "" ? null : value });
          }}
        />
      </div>
      {asking ? (
        <Confirm
          title={text.mailboxes.removeConfirm(address)}
          sub={text.mailboxes.removeSub}
          yes={text.mailboxes.removeYes}
          busy={busy}
          onYes={remove}
          onNo={() => {
            setAsking(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The connected mailboxes, with Connect a mailbox and Check mailboxes. */
export function MailboxesRow({ status }: { readonly status: ConnectionsStatus }) {
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const full = status.mailboxes.length >= mailboxesMax;
  const connect = (): void => {
    setConnecting(true);
    void ask("mail:connect", {}).then((answer) => {
      setConnecting(false);
      if (answer === null) {
        failToast(text.mailboxes.couldNotConnect, text.connectReasons.failed);
      } else if (!answer.ok) {
        failToast(text.mailboxes.couldNotConnect, text.connectReasons[answer.reason]);
      } else {
        toast({
          msg: text.mailboxes.connected(answer.address),
          sub: text.mailboxes.connectedSub,
          icon: "check",
          tone: "good",
        });
        void loadConnections();
      }
    });
  };
  const check = (): void => {
    setChecking(true);
    void ask("mail:check", {}).then((answer) => {
      setChecking(false);
      if (answer === null) {
        failToast(text.mailboxes.couldNotCheck, text.checkReasons.failed);
      } else if (!answer.ok) {
        failToast(text.mailboxes.couldNotCheck, text.checkReasons[answer.reason]);
      } else {
        applyConnections({ ...status, mailboxes: answer.mailboxes });
        toast({
          msg: text.mailboxes.checkedToast(answer.mailboxes.length),
          sub: text.mailboxes.checkedSub,
          icon: "check",
          tone: "good",
        });
      }
    });
  };
  return (
    <Row
      id="connMailboxes"
      label={rows.connMailboxes.label}
      scope="team"
      desc={rows.connMailboxes.desc}
      ui="settings.connections.mailboxes"
    >
      {status.mailboxes.length === 0 ? (
        <span className="hint">{text.mailboxes.none}</span>
      ) : (
        status.mailboxes.map((box) => <MailboxLine key={box.address} box={box} />)
      )}
      <div className="row wrap">
        <Btn icon="plus" disabled={connecting || full} onClick={connect}>
          {text.mailboxes.connect}
        </Btn>
        <Btn icon="refresh" disabled={checking || status.mailboxes.length === 0} onClick={check}>
          {checking ? text.mailboxes.checking : text.mailboxes.check}
        </Btn>
      </div>
      {connecting ? (
        <span className="hint" role="status">
          {text.mailboxes.waiting}
        </span>
      ) : null}
    </Row>
  );
}

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
      ui="settings.connections.mailSettings"
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
