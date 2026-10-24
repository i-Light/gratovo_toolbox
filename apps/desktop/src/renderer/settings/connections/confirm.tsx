import { Btn, Icon } from "@gratovo/ui";

import { strings } from "../../strings";

const text = strings.settings.connections;

/** A question before something is removed or created, with Yes and Cancel, in the row itself. */
export function Confirm(props: {
  readonly title: string;
  readonly sub: string;
  readonly yes: string;
  readonly busy?: boolean;
  readonly onYes: () => void;
  readonly onNo: () => void;
}) {
  return (
    <div className="callout warn" role="group" aria-label={props.title}>
      <Icon name="alert" />
      <div className="grow col tight">
        <b>{props.title}</b>
        <span className="small">{props.sub}</span>
        <div className="row wrap">
          <Btn kind="pri" size="sm" disabled={props.busy === true} onClick={props.onYes}>
            {props.yes}
          </Btn>
          <Btn size="sm" kind="ghost" disabled={props.busy === true} onClick={props.onNo}>
            {text.cancel}
          </Btn>
        </div>
      </div>
    </div>
  );
}
