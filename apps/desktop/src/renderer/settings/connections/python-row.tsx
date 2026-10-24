import type { ConnectionsStatus } from "@gratovo/ipc";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { StateTag } from "./state-tag";

const text = strings.settings.connections;
const rows = strings.settings.rows;

/** The Python pipeline is there or not. */
export function PythonRow({ status }: { readonly status: ConnectionsStatus }) {
  const ok = status.python.state === "ready";
  return (
    <Row
      id="connPython"
      label={rows.connPython.label}
      scope="team"
      desc={rows.connPython.desc}
      ui="settings.connections.python"
    >
      <Line>
        <StateTag tone={ok ? "good" : "crit"} icon={ok ? "check" : "alert"}>
          {ok ? text.tags.ready : text.tags.missing}
        </StateTag>
        <span className="small ink2">{ok ? text.python.readyLine : text.python.missingLine}</span>
      </Line>
    </Row>
  );
}
