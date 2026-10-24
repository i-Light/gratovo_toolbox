import type { ConnectionsStatus, FolderPurpose } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { StateTag } from "./state-tag";
import { ask, failToast, saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

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
