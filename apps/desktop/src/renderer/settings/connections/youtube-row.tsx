import type { ConnectionsStatus } from "@gratovo/ipc";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { StateTag } from "./state-tag";

const text = strings.settings.connections;
const rows = strings.settings.rows;

/** YouTube search: the team's key is there or not. No buttons. */
export function YoutubeRow({ status }: { readonly status: ConnectionsStatus }) {
  const ok = status.youtube.state === "available";
  return (
    <Row
      id="connYoutube"
      label={rows.connYoutube.label}
      scope="team"
      desc={rows.connYoutube.desc}
      ui="settings.connections.youtube"
    >
      <Line>
        <StateTag tone={ok ? "good" : "warn"} icon={ok ? "check" : "alert"}>
          {ok ? text.tags.available : text.tags.notAvailable}
        </StateTag>
        <span className="small ink2">
          {ok ? text.youtube.availableLine : text.youtube.unavailableLine}
        </span>
      </Line>
    </Row>
  );
}
