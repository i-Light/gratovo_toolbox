import type { ConnectionsStatus } from "@gratovo/ipc";
import { mailboxCapMax, mailboxCapMin, mailboxesMax } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { toast } from "../../lib/toast";
import { strings } from "../../strings";
import { Row } from "../row";
import { whenText } from "./format";
import { Confirm } from "./confirm";
import { Line } from "./line";
import { StateTag } from "./state-tag";
import { Stepper } from "./stepper";
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
