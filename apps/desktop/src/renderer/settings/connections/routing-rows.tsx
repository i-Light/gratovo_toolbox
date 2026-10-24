import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn, Seg, Switch } from "@gratovo/ui";
import { useRef, useState } from "react";

import { toast } from "../../lib/toast";
import { flashSetting } from "../../lib/actions";
import { strings } from "../../strings";
import { Row } from "../row";
import { Confirm, Line, Problem, StateTag, Stepper } from "./parts";
import { ask, failToast, loadConnections, saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

const proxiesMax = 100;

/** Proxies: how many, and a form that replaces the whole list. The URLs never come back. */
export function ProxiesRow({ status }: { readonly status: ConnectionsStatus }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const urls = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const tooMany = urls.length > proxiesMax;
  const spaced = urls.some((url) => /\s/.test(url));
  const send = (next: readonly string[], msg: string, sub?: string): void => {
    if (saving.current) {
      return;
    }
    saving.current = true;
    setBusy(true);
    void saveChange(
      { kind: "proxies.urls", urls: [...next] },
      { row: "connProxies", msg, ...(sub === undefined ? {} : { sub }) },
    ).then((ok) => {
      saving.current = false;
      setBusy(false);
      if (ok) {
        setList("");
        setOpen(false);
      }
    });
  };
  const count = status.proxies.count;
  return (
    <Row
      id="connProxies"
      label={rows.connProxies.label}
      scope="team"
      desc={rows.connProxies.desc}
      ui="settings.connections.proxies"
    >
      <Line
        actions={
          open ? null : (
            <span className="row" style={{ gap: "6px" }}>
              <Btn
                size="sm"
                onClick={() => {
                  setOpen(true);
                }}
              >
                {text.proxies.replace}
              </Btn>
              <Btn
                size="sm"
                kind="ghost"
                disabled={count === 0 || busy}
                onClick={() => {
                  send([], text.proxies.cleared);
                }}
              >
                {text.proxies.clear}
              </Btn>
            </span>
          )
        }
      >
        <StateTag tone={count > 0 ? "good" : undefined}>{text.proxies.count(count)}</StateTag>
      </Line>
      {open ? (
        <div className="col" style={{ gap: "8px", width: "100%" }}>
          <label className="field">
            {text.proxies.label}
            <textarea
              className="inp"
              rows={5}
              autoComplete="off"
              spellCheck={false}
              placeholder={text.proxies.placeholder}
              value={list}
              onChange={(event) => {
                setList(event.currentTarget.value);
              }}
            />
          </label>
          {tooMany ? <Problem>{text.proxies.tooMany}</Problem> : null}
          {spaced ? <Problem>{text.proxies.bad}</Problem> : null}
          <div className="row wrap">
            <Btn
              kind="pri"
              size="sm"
              icon="check"
              disabled={busy || urls.length === 0 || tooMany || spaced}
              onClick={() => {
                send(urls, text.proxies.saved(urls.length));
              }}
            >
              {text.proxies.save}
            </Btn>
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => {
                setOpen(false);
                setList("");
              }}
            >
              {text.cancel}
            </Btn>
          </div>
        </div>
      ) : (
        <span className="hint">{text.proxies.hint}</span>
      )}
    </Row>
  );
}

const pacingOptions = [
  { value: "normal", label: text.routing.normal },
  { value: "fast", label: text.routing.fast },
] as const;

/** Whether proxies are used, whether the direct line is also used, the pacing and the parallel search. */
export function PacingRow({ status }: { readonly status: ConnectionsStatus }) {
  const send = (patch: {
    enabled?: boolean;
    includeDirect?: boolean;
    pacing?: "normal" | "fast";
    parallelOn?: boolean;
    maxWorkers?: number;
  }): void => {
    void saveChange(
      {
        kind: "pipeline.settings",
        pacing: patch.pacing ?? status.pacing,
        parallel: {
          enabled: patch.parallelOn ?? status.parallel.enabled,
          maxWorkers: patch.maxWorkers ?? status.parallel.maxWorkers,
        },
        proxies: {
          enabled: patch.enabled ?? status.proxies.enabled,
          includeDirect: patch.includeDirect ?? status.proxies.includeDirect,
        },
      },
      { row: "connPacing" },
    );
  };
  return (
    <Row
      id="connPacing"
      label={rows.connPacing.label}
      scope="team"
      desc={rows.connPacing.desc}
      ui="settings.connections.pacing"
    >
      <div className="row" style={{ gap: "10px" }}>
        <Switch
          on={status.proxies.enabled}
          label={text.routing.useProxies}
          onChange={(enabled) => {
            send({ enabled });
          }}
        />
        <span>{text.routing.useProxies}</span>
      </div>
      <div className="row" style={{ gap: "10px" }}>
        <Switch
          on={status.proxies.includeDirect}
          label={text.routing.includeDirect}
          onChange={(includeDirect) => {
            send({ includeDirect });
          }}
        />
        <span>{text.routing.includeDirect}</span>
      </div>
      <Seg
        label={text.routing.pacing}
        value={status.pacing}
        options={pacingOptions}
        onPick={(value) => {
          send({ pacing: value === "fast" ? "fast" : "normal" });
        }}
      />
      <div className="row" style={{ gap: "10px" }}>
        <Switch
          on={status.parallel.enabled}
          label={text.routing.parallel}
          onChange={(parallelOn) => {
            send({ parallelOn });
          }}
        />
        <span>{text.routing.parallel}</span>
      </div>
      {status.parallel.enabled ? (
        <div className="col tight">
          <Stepper
            value={status.parallel.maxWorkers}
            min={1}
            max={16}
            label={text.routing.workers}
            upLabel={text.routing.workersUp}
            downLabel={text.routing.workersDown}
            onChange={(maxWorkers) => {
              send({ maxWorkers });
            }}
          />
          <span className="hint">{text.routing.workersHint}</span>
        </div>
      ) : null}
    </Row>
  );
}

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
    </Row>
  );
}
