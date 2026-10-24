import type { ConnectionsStatus } from "@gratovo/ipc";
import { Seg, Switch } from "@gratovo/ui";

import { strings } from "../../strings";
import { Row } from "../row";
import { Stepper } from "./stepper";
import { saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

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
