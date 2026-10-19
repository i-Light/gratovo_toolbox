import type { ReactNode } from "react";

import { cx } from "./cx";
import { Icon } from "./icon";
import type { IconName } from "./icons";

/** What `Tag` takes. */
export interface TagProps {
  /** The colour: a state (good, warn, crit), "info" or the plain "line". Left out, it is neutral. */
  readonly tone?: "good" | "warn" | "crit" | "info" | "line";
  readonly icon?: IconName;
  readonly children?: ReactNode;
}

/** A small label for a state or a category. */
export function Tag({ tone, icon, children }: TagProps) {
  return (
    <span className={cx("tag", tone)}>
      {icon === undefined ? null : <Icon name={icon} />}
      {children}
    </span>
  );
}
