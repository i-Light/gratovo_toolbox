import type { ReactNode } from "react";

import { Icon } from "./icon";
import type { IconName } from "./icons";

/** What `Empty` takes. */
export interface EmptyProps {
  /** Default "checkc". */
  readonly icon?: IconName;
  readonly title: string;
  /** The hint under the title. */
  readonly children?: ReactNode;
  /** A button or link under the hint. */
  readonly action?: ReactNode;
}

/** The "nothing here" block: an icon, a title, a hint and an optional action. */
export function Empty({ icon = "checkc", title, children, action }: EmptyProps) {
  return (
    <div className="empty">
      <span className="ei">
        <Icon name={icon} size={20} />
      </span>
      <b>{title}</b>
      {children ? (
        <p className="hint" style={{ maxWidth: "46ch" }}>
          {children}
        </p>
      ) : null}
      {action}
    </div>
  );
}
