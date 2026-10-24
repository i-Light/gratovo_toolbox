import { Tag } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import type { ReactNode } from "react";

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
