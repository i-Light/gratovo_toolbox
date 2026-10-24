import type { MouseEventHandler, ReactNode, Ref } from "react";

import { cx } from "./cx";
import { Icon } from "./icon";
import type { IconName } from "./icons";

/** What `Btn` takes. Every word comes in as a prop. */
export interface BtnProps {
  /** The look: "pri" (primary), "ghost" and so on. The class name is used as given. */
  readonly kind?: string;
  readonly size?: "sm";
  readonly icon?: IconName;
  readonly iconClassName?: string;
  /** A key hint. Shown on the button when it is primary or has no tip; otherwise it goes into the tip. */
  readonly kbd?: string;
  /** Tooltip text (`data-tip`). */
  readonly tip?: string;
  /** An accessible name, for a button whose children are not text. */
  readonly label?: string;
  readonly disabled?: boolean;
  /** For a button that opens and closes something: `aria-expanded`. */
  readonly expanded?: boolean;
  /** The button element, to send focus back to it. */
  readonly ref?: Ref<HTMLButtonElement>;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
  readonly children?: ReactNode;
}

/** The standard button. */
export function Btn({
  kind,
  size,
  icon,
  iconClassName,
  kbd,
  tip,
  label,
  disabled,
  expanded,
  ref,
  onClick,
  children,
}: BtnProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx("btn", kind, size)}
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      data-kbd={tip === undefined ? undefined : kbd}
      aria-label={label}
      aria-expanded={expanded}
    >
      {icon === undefined ? null : <Icon name={icon} className={iconClassName} />}
      {children}
      {kbd !== undefined && (kind === "pri" || tip === undefined) ? (
        <span className="kbd">{kbd}</span>
      ) : null}
    </button>
  );
}
