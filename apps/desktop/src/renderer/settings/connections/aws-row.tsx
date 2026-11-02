import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn, Switch } from "@gratovo/ui";
import { useState } from "react";

import { toast } from "../../lib/toast";
import { flashSetting } from "../../lib/actions";
import { strings } from "../../strings";
import { Row } from "../row";
import { Confirm } from "./confirm";
import { Line } from "./line";
import { Problem } from "./problem";
import { StateTag } from "./state-tag";
import { ask, failToast, loadConnections, saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

const regionCodes = Object.keys(text.aws.regionNames);
const regionName = (code: string): string => text.aws.regionNames[code] ?? code;

/** AWS: the keys (set only), the gateways switch, the regions in use and deploying to new ones. */
export function AwsRow({ status }: { readonly status: ConnectionsStatus }) {
  const [keysOpen, setKeysOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [confirmLeak, setConfirmLeak] = useState(false);
  const [leak, setLeak] = useState<{ lines: readonly string[]; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { aws } = status;
  const showKeys = !aws.keys || keysOpen;
  const keyIdClean = keyId.trim();
  const keyIdBad = keyIdClean !== "" && !/^[A-Z0-9]{16,128}$/.test(keyIdClean);
  const keysReady = keyIdClean !== "" && !keyIdBad && secret.trim() !== "";
  const free = regionCodes.filter((code) => !aws.regions.includes(code));

  const saveKeys = (): void => {
    setBusy(true);
    void saveChange(
      { kind: "aws.keys", accessKeyId: keyIdClean, secretAccessKey: secret.trim() },
      { row: "connAws", msg: text.saved },
    ).then((ok) => {
      setBusy(false);
      if (ok) {
        setKeyId("");
        setSecret("");
        setKeysOpen(false);
      }
    });
  };
  const remove = (region: string): void => {
    setBusy(true);
    void ask("gateways:remove", { region }).then((answer) => {
      setBusy(false);
      if (answer === null) {
        failToast(text.aws.couldNotRemove, text.gatewayReasons.failed);
      } else if (!answer.ok) {
        failToast(text.aws.couldNotRemove, text.gatewayReasons[answer.reason]);
      } else {
        setRemoving(null);
        flashSetting("connAws");
        toast({
          msg: text.aws.removed(regionName(region)),
          sub: text.aws.removedSub,
          icon: "check",
          tone: "good",
        });
        void loadConnections();
      }
    });
  };
  const deploy = (): void => {
    setBusy(true);
    void ask("gateways:deploy", { regions: [...picked] }).then((answer) => {
      setBusy(false);
      setConfirmDeploy(false);
      if (answer === null) {
        failToast(text.aws.couldNotDeploy, text.gatewayReasons.failed);
      } else if (!answer.ok) {
        failToast(text.aws.couldNotDeploy, text.gatewayReasons[answer.reason]);
      } else {
        setPicked([]);
        flashSetting("connAws");
        toast({
          msg: text.aws.deployed(answer.deployed.length),
          sub:
            answer.failed.length > 0
              ? text.aws.deployedFailed(answer.failed.map(regionName).join(", "))
              : text.aws.deployedSub,
          icon: "check",
          tone: "good",
        });
        void loadConnections();
      }
    });
  };
  const checkLeak = (): void => {
    setBusy(true);
    setLeak(null);
    void ask("gateways:leak", {}).then((answer) => {
      setBusy(false);
      setConfirmLeak(false);
      if (answer === null) {
        failToast(text.aws.couldNotCheckLeak, text.gatewayReasons.failed);
      } else if (!answer.ok) {
        const { reason } = answer;
        if (reason === "left_behind") {
          // It stays on the page: the owner has to act on it in the AWS console.
          setLeak({ lines: [text.aws.leakLeftBehind], bad: true });
        } else {
          failToast(
            text.aws.couldNotCheckLeak,
            reason === "aws" || reason === "network"
              ? text.aws.leakReasons[reason]
              : text.gatewayReasons[reason],
          );
        }
      } else {
        const said =
          answer.outcome === "leak"
            ? text.aws.leakFound(answer.headers)
            : answer.outcome === "clean"
              ? text.aws.leakNone
              : text.aws.leakUnclear;
        setLeak({
          lines: answer.removed ? [said] : [said, text.aws.leakLeftBehind],
          bad: answer.outcome === "leak" || !answer.removed,
        });
      }
    });
  };

  return (
    <Row
      id="connAws"
      label={rows.connAws.label}
      scope="team"
      desc={rows.connAws.desc}
      ui="settings.connections.aws"
    >
      <Line
        actions={
          aws.keys && !keysOpen ? (
            <Btn
              size="sm"
              onClick={() => {
                setKeysOpen(true);
              }}
            >
              {text.replace}
            </Btn>
          ) : null
        }
      >
        <StateTag tone={aws.keys ? "good" : undefined} icon={aws.keys ? "check" : undefined}>
          {aws.keys ? text.tags.set : text.tags.notSet}
        </StateTag>
        {showKeys ? null : <span className="hint">{text.aws.keysSet}</span>}
      </Line>
      {showKeys ? (
        <form
          className="col"
          style={{ gap: "8px", width: "100%" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (keysReady && !busy) {
              saveKeys();
            }
          }}
        >
          {aws.keys ? null : <span className="hint">{text.aws.keysNotSet}</span>}
          <label className="field">
            {text.aws.accessKeyId}
            <input
              className="inp"
              type="password"
              autoComplete="off"
              value={keyId}
              aria-invalid={keyIdBad}
              onChange={(event) => {
                setKeyId(event.currentTarget.value);
              }}
            />
          </label>
          {keyIdBad ? <Problem>{text.aws.keysBad}</Problem> : null}
          <label className="field">
            {text.aws.secretAccessKey}
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
            <Btn kind="pri" size="sm" icon="check" disabled={!keysReady || busy} onClick={saveKeys}>
              {text.aws.save}
            </Btn>
            {aws.keys ? (
              <Btn
                size="sm"
                kind="ghost"
                onClick={() => {
                  setKeysOpen(false);
                  setKeyId("");
                  setSecret("");
                }}
              >
                {text.cancel}
              </Btn>
            ) : null}
          </div>
        </form>
      ) : null}
      <div className="row" style={{ gap: "10px" }}>
        <Switch
          on={aws.enabled}
          label={text.aws.enabled}
          onChange={(enabled) => {
            void saveChange({ kind: "gateways.enabled", enabled }, { row: "connAws" });
          }}
        />
        <span>{text.aws.enabled}</span>
      </div>
      {aws.regions.length === 0 ? (
        <span className="hint">{text.aws.noRegions}</span>
      ) : (
        aws.regions.map((region) => (
          <Line
            key={region}
            actions={
              <Btn
                size="sm"
                kind="ghost"
                icon="trash"
                label={text.aws.removeRegion(region)}
                disabled={busy}
                onClick={() => {
                  setRemoving(region);
                }}
              >
                {text.remove}
              </Btn>
            }
          >
            <StateTag icon="globe">{region}</StateTag>
            <span className="small ink2">{regionName(region)}</span>
          </Line>
        ))
      )}
      {removing === null ? null : (
        <Confirm
          title={text.aws.removeConfirm(removing)}
          sub={text.aws.removeSub}
          yes={text.aws.removeYes}
          busy={busy}
          onYes={() => {
            remove(removing);
          }}
          onNo={() => {
            setRemoving(null);
          }}
        />
      )}
      {aws.keys && free.length > 0 ? (
        <div className="col" style={{ gap: "8px" }}>
          <div className="fchips" role="group" aria-label={text.aws.regionsLabel}>
            {free.map((code) => {
              const on = picked.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  title={regionName(code)}
                  onClick={() => {
                    setPicked(on ? picked.filter((c) => c !== code) : [...picked, code]);
                  }}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <div className="row wrap">
            <Btn
              size="sm"
              icon="bolt"
              disabled={busy || picked.length === 0}
              onClick={() => {
                setConfirmDeploy(true);
              }}
            >
              {busy && confirmDeploy ? text.aws.deploying : text.aws.deploy}
            </Btn>
          </div>
        </div>
      ) : null}
      {confirmDeploy ? (
        <Confirm
          title={text.aws.deployConfirm(picked.length)}
          sub={text.aws.deploySub}
          yes={text.aws.deployYes}
          busy={busy}
          onYes={deploy}
          onNo={() => {
            setConfirmDeploy(false);
          }}
        />
      ) : null}
      <div className="row wrap">
        <Btn
          size="sm"
          icon="shield"
          disabled={!aws.keys || busy}
          onClick={() => {
            setConfirmLeak(true);
          }}
        >
          {busy && confirmLeak ? text.aws.leakChecking : text.aws.leakCheck}
        </Btn>
      </div>
      {confirmLeak ? (
        <Confirm
          title={text.aws.leakConfirm}
          sub={text.aws.leakSub}
          yes={text.aws.leakYes}
          busy={busy}
          onYes={checkLeak}
          onNo={() => {
            setConfirmLeak(false);
          }}
        />
      ) : null}
      {leak === null ? null : (
        <span className={leak.bad ? "hint set-err" : "hint"} role="status">
          {leak.lines.join(" ")}
        </span>
      )}
    </Row>
  );
}
