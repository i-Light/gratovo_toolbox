import type { ConnectionsStatus, FolderPurpose } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";

import { strings } from "../../strings";
import { Row } from "../row";
import { dayText } from "./format";
import { Line, StateTag } from "./parts";
import { ask, failToast, saveChange } from "./use-connections";

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

function FolderLine(props: {
  readonly purpose: FolderPurpose;
  readonly label: string;
  readonly status: ConnectionsStatus;
}) {
  const { course } = props.status;
  const path = props.purpose === "course" ? course.courseDir : course.videoDir;
  const missing = props.purpose === "course" && path !== null && !course.courseFound;
  const put = (value: string | null): void => {
    void saveChange(
      {
        kind: "course",
        courseDir: props.purpose === "course" ? value : course.courseDir,
        videoDir: props.purpose === "videos" ? value : course.videoDir,
      },
      {
        row: "connCourse",
        msg: value === null ? text.course.clearedToast : text.course.savedToast,
      },
    );
  };
  const choose = (): void => {
    void ask("connections:pick-folder", { purpose: props.purpose }).then((answer) => {
      if (answer === null) {
        failToast(text.notSaved, text.course.pickFailed);
      } else if (answer.path !== null) {
        put(answer.path);
      }
    });
  };
  return (
    <Line
      label={props.label}
      actions={
        <span className="row" style={{ gap: "6px" }}>
          <Btn size="sm" label={`${text.choose} ${props.label}`} onClick={choose}>
            {text.choose}
          </Btn>
          <Btn
            size="sm"
            kind="ghost"
            label={`${text.clear} ${props.label}`}
            disabled={path === null}
            onClick={() => {
              put(null);
            }}
          >
            {text.clear}
          </Btn>
        </span>
      }
    >
      <span className="small" style={{ overflowWrap: "anywhere" }}>
        {path ?? text.course.none}
      </span>
      {missing ? (
        <StateTag tone="warn" icon="alert">
          {text.course.notFound}
        </StateTag>
      ) : null}
    </Line>
  );
}

/** The course folder and the videos folder. */
export function CourseRow({ status }: { readonly status: ConnectionsStatus }) {
  return (
    <Row
      id="connCourse"
      label={rows.connCourse.label}
      scope="team"
      desc={rows.connCourse.desc}
      ui="settings.connections.course"
    >
      <FolderLine purpose="course" label={text.course.courseDir} status={status} />
      <FolderLine purpose="videos" label={text.course.videoDir} status={status} />
      <span className="hint">{text.course.hint}</span>
    </Row>
  );
}

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
