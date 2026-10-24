import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";

import { strings } from "../../strings";
import { Row } from "../row";
import { dayText } from "./format";
import { Line } from "./line";
import { StateTag } from "./state-tag";

const text = strings.settings.connections;
const rows = strings.settings.rows;

/** Old app data: has it been brought in, and the button that opens the import dialog. */
export function OldDataRow(props: {
  readonly status: ConnectionsStatus;
  readonly onOpen: () => void;
}) {
  const { import: imported } = props.status;
  const done = imported.state === "done";
  return (
    <Row
      id="connOld"
      label={rows.connOld.label}
      scope="team"
      desc={rows.connOld.desc}
      ui="settings.connections.old"
    >
      <Line>
        <StateTag tone={done ? "good" : "info"} icon={done ? "check" : undefined}>
          {done
            ? text.old.done(imported.at === null ? null : dayText(imported.at))
            : text.old.never}
        </StateTag>
      </Line>
      {imported.backup === null ? null : (
        <span className="hint">{text.old.backup(imported.backup)}</span>
      )}
      <div className="row wrap">
        <Btn {...(done ? {} : { kind: "pri" })} size="sm" icon="inbox" onClick={props.onOpen}>
          {done ? text.old.again : text.old.button}
        </Btn>
        {done ? <span className="hint">{text.old.hint}</span> : null}
      </div>
    </Row>
  );
}
