import type { ReactNode } from "react";

/** The big number: semibold, tight, tabular figures, with an optional smaller unit. */
export function BigNumber({
  value,
  unit,
  size = "md",
}: {
  readonly value: ReactNode;
  readonly unit?: string;
  readonly size?: "md" | "lg";
}) {
  return (
    <span className={`ins-big ${size}`}>
      {value}
      {unit === undefined ? null : <small>{unit}</small>}
    </span>
  );
}
