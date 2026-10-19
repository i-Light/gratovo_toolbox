import { Icon } from "@gratovo/ui";
import { useState } from "react";

import type { Problem } from "../lib/store";
import { strings } from "../strings";

/**
 * The red bar under the top bar when something behind the app is broken. It shows the first
 * problem with its action, and a link that opens the rest. It cannot be dismissed: it goes away
 * when the problem is fixed. Renders nothing when `problems` is empty.
 */
export function ProblemsBar({ problems }: { readonly problems: readonly Problem[] }) {
  const [open, setOpen] = useState(false);
  const [first, ...others] = problems;
  if (first === undefined) {
    return null;
  }
  return (
    <div className="sysbar crit" role="alert">
      <Icon name="alert" />
      <span className="grow">
        <b style={{ fontWeight: 600 }}>{first.text}</b>{" "}
        <span className="hide-narrow">{first.sub}</span>
        {others.length > 0 ? (
          <>
            {" "}
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                setOpen(!open);
              }}
            >
              {open ? strings.problems.hide : strings.problems.more(others.length)}
            </button>
          </>
        ) : null}
        {open ? (
          <span className="sys-more">
            {others.map((p) => (
              <span key={p.key} className="row wrap" style={{ gap: "8px" }}>
                <span>{p.text}</span>
                {p.action ? (
                  <button type="button" className="linkbtn" onClick={p.action.run}>
                    {p.action.label}
                  </button>
                ) : null}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {first.action ? (
        <button type="button" className="btn sm" onClick={first.action.run}>
          {first.action.label}
        </button>
      ) : null}
    </div>
  );
}
