import { Icon } from "@gratovo/ui";
import type { ReactNode } from "react";

import type { RowId } from "../lib/settings";
import { useApp } from "../lib/store";
import { strings } from "../strings";

/** What `Row` takes. */
export interface RowProps {
  readonly id: RowId;
  readonly label: string;
  /** Who the setting is for; left out, no scope word shows. */
  readonly scope?: keyof typeof strings.settings.scopes;
  /** What it says under the label. */
  readonly desc?: string;
  /** A stable name for tests and tours, written as `data-ui` (such as `settings.search.median`). */
  readonly ui?: string;
  /** The control. */
  readonly children: ReactNode;
}

/**
 * One setting: its name, who it is for and what it does on the left, the control on the right.
 * Shows "Saved" beside the name while the setting has just been saved. Its `id` (`set-<id>`) is
 * what the search and the palette scroll to.
 */
export function Row({ id, label, scope, desc, ui, children }: RowProps) {
  const saved = useApp((s) => s.ui.settingFlash?.id === id);
  return (
    <div className="set-row" id={`set-${id}`} {...(ui === undefined ? {} : { "data-ui": ui })}>
      <div className="set-t">
        <div className="row wrap" style={{ gap: "8px" }}>
          <b>{label}</b>
          {scope === undefined ? null : (
            <span className="set-scope">{strings.settings.scopes[scope]}</span>
          )}
          {saved ? (
            <span className="set-saved" role="status">
              <Icon name="check" size={13} />
              {strings.settings.saved}
            </span>
          ) : null}
        </div>
        {desc === undefined ? null : <p>{desc}</p>}
      </div>
      <div className="set-c">{children}</div>
    </div>
  );
}
