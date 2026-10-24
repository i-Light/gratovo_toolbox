import { Btn, Icon, Tag } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import type { ReactNode } from "react";

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

/** A plain-words problem under a control. */
export function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <span className="hint set-err" role="alert">
      {children}
    </span>
  );
}

/** One line of a row: a name, its value and its buttons. */
export function Line(props: {
  readonly label?: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="row wrap" style={{ gap: "8px", width: "100%" }}>
      {props.label === undefined ? null : <span className="small ink2">{props.label}</span>}
      <div className="row wrap grow" style={{ gap: "8px", minWidth: 0 }}>
        {props.children}
      </div>
      {props.actions}
    </div>
  );
}

/** The up and down buttons around a number. */
export function Stepper(props: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly upLabel: string;
  readonly downLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (next: number) => void;
}) {
  const { value, min, max } = props;
  const off = props.disabled === true;
  return (
    <div className="row" style={{ gap: "6px" }} role="group" aria-label={props.label}>
      <Btn
        size="sm"
        icon="minus"
        label={props.downLabel}
        disabled={off || value <= min}
        onClick={() => {
          props.onChange(Math.max(min, value - 1));
        }}
      />
      <span className="num">{value}</span>
      <Btn
        size="sm"
        icon="plus"
        label={props.upLabel}
        disabled={off || value >= max}
        onClick={() => {
          props.onChange(Math.min(max, value + 1));
        }}
      />
    </div>
  );
}

/** A `Tag` that takes a tone or icon that may be absent. */
export function StateTag(props: {
  readonly tone?: "good" | "warn" | "crit" | "info" | "line" | undefined;
  readonly icon?: IconName | undefined;
  readonly children: ReactNode;
}) {
  return (
    <Tag
      {...(props.tone === undefined ? {} : { tone: props.tone })}
      {...(props.icon === undefined ? {} : { icon: props.icon })}
    >
      {props.children}
    </Tag>
  );
}
