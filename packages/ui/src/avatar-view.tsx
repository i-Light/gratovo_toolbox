import { cx } from "./cx";
import { Icon } from "./icon";
import { initials } from "./avatar";

/** What `Avatar` takes. */
export interface AvatarProps {
  readonly name: string;
  /** Background colour, for example from `avatarColor`. */
  readonly color: string;
  readonly size?: "s" | "l" | "xl";
  /** Draws the presence dot. */
  readonly status?: "online" | "away";
  readonly tip?: string;
  /** The person has no name yet: show the user icon instead of initials. */
  readonly unnamed?: boolean;
  /** Address of a photo; shown instead of initials. */
  readonly photo?: string;
  /**
   * The name is already written next to it (a menu row, a list row, a heading), so the avatar is
   * hidden from screen readers instead of saying the name twice.
   */
  readonly decorative?: boolean;
}

const iconSizes = { s: 14, l: 20, xl: 24 } as const;

/** A round avatar: a photo, initials, or the user icon, with an optional presence dot. */
export function Avatar({
  name,
  color,
  size,
  status,
  tip,
  unnamed,
  photo,
  decorative = false,
}: AvatarProps) {
  const iconSize = size === undefined ? 14 : iconSizes[size];
  let face;
  if (photo !== undefined) {
    face = <img src={photo} alt="" />;
  } else if (unnamed === true) {
    face = <Icon name="user" size={iconSize} />;
  } else {
    face = initials(name);
  }
  return (
    <span
      className={cx("av", size)}
      style={{ background: color }}
      data-tip={tip}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
    >
      {face}
      {status === undefined ? null : <i className={cx("dot", status === "away" && "away")}></i>}
    </span>
  );
}
