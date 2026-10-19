import type { MouseEventHandler } from "react";

import { cx } from "./cx";
import { Icon } from "./icon";
import type { IconName } from "./icons";

/** What `IconBtn` takes. */
export interface IconBtnProps {
  readonly icon: IconName;
  /** The accessible name and the tooltip. */
  readonly label: string;
  /** A key hint for the tooltip (`data-kbd`). */
  readonly kbd?: string;
  /** Makes it a toggle: sets `aria-pressed`. Left out, the attribute is not written. */
  readonly pressed?: boolean;
  /** A small count on the corner. */
  readonly badge?: string | number;
  readonly disabled?: boolean;
  /** Icon size in pixels. Default 17. */
  readonly size?: number;
  readonly className?: string;
  readonly iconClassName?: string;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
}

/** A square button with only an icon. */
export function IconBtn({
  icon,
  label,
  kbd,
  pressed,
  badge,
  disabled,
  size = 17,
  className,
  iconClassName,
  onClick,
}: IconBtnProps) {
  return (
    <button
      type="button"
      className={cx("iconbtn", className)}
      onClick={onClick}
      aria-label={label}
      data-tip={label}
      data-kbd={kbd}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
    >
      <Icon name={icon} size={size} className={iconClassName} />
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}
