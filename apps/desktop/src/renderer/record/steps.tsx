import type { CSSProperties } from "react";

import { strings } from "../strings";

/** Up to this many steps, each bar has its name under it; past it, one caption names the current. */
const namedMax = 5;

/**
 * A row of steps with the current one marked (v6's steps strip): the ones before it are done, the
 * current one carries `aria-current="step"`. `hue` colours it with one of the phase tokens.
 */
export function Steps({
  label,
  steps,
  at,
  hue,
}: {
  readonly label: string;
  readonly steps: readonly string[];
  /** The index of the current step. */
  readonly at: number;
  readonly hue?: string;
}) {
  const named = steps.length <= namedMax;
  const current = steps[at];
  return (
    <div className="steps-wrap">
      <ol
        className={named ? "steps" : "steps compact"}
        data-ui="record.steps"
        aria-label={label}
        {...(hue === undefined ? {} : { style: { "--hue": hue } as CSSProperties })}
      >
        {steps.map((name, i) => (
          <li
            key={name}
            className={i < at ? "st done" : i === at ? "st now" : "st"}
            {...(i === at ? { "aria-current": "step" as const } : {})}
          >
            <i></i>
            <span className={named ? undefined : "sr"}>{name}</span>
          </li>
        ))}
      </ol>
      {named || current === undefined ? null : (
        <p className="steps-cap" aria-hidden="true">
          {strings.record.stepOf(current, at + 1, steps.length)}
        </p>
      )}
    </div>
  );
}
