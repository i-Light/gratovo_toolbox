import type { ReactNode } from "react";

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
