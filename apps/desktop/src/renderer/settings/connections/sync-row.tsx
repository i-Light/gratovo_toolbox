import type { ConnectionsStatus } from "@gratovo/ipc";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { StateTag } from "./state-tag";

const text = strings.settings.connections;
const rows = strings.settings.rows;

const syncTone = {
  off: undefined,
  syncing: "info",
  synced: "good",
  offline: "warn",
  stuck: "crit",
} as const;

/** Where the sync stands, in the words the top bar uses. */
export function SyncRow({ status }: { readonly status: ConnectionsStatus }) {
  const state = status.sync.state;
  return (
    <Row
      id="connSync"
      label={rows.connSync.label}
      scope="team"
      desc={rows.connSync.desc}
      ui="settings.connections.sync"
    >
      <Line>
        <StateTag tone={syncTone[state]} icon={state === "synced" ? "check" : undefined}>
          {text.sync.tags[state]}
        </StateTag>
        <span className="small ink2">{text.sync.lines[state]}</span>
      </Line>
    </Row>
  );
}
