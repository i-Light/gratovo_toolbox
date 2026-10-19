import type { CSSProperties, ReactNode } from "react";

/** What `PageHead` takes. */
export interface PageHeadProps {
  readonly title: string;
  readonly sub?: string;
  /** A CSS colour value for the screen's hue, such as `var(--find)`. It goes into `--hue`. */
  readonly hue?: string;
  /** Controls on the right. */
  readonly right?: ReactNode;
}

/** The heading block at the top of a screen. */
export function PageHead({ title, sub, hue, right }: PageHeadProps) {
  const style = hue === undefined ? undefined : ({ "--hue": hue } as CSSProperties);
  return (
    <div className="ph" style={style}>
      <div className="t grow">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}
