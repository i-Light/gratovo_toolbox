import type { ImportReport } from "@gratovo/ipc";
import { Icon } from "@gratovo/ui";

import { strings } from "../../strings";

const text = strings.settings.importDialog;

/** The warning about old work that was never sent. Null when there is none. */
export function UnsentWarning({ report }: { readonly report: ImportReport }) {
  const n = report.unsent.outbox + report.unsent.activity;
  if (n === 0) {
    return null;
  }
  return (
    <div className="callout warn" role="alert">
      <Icon name="alert" />
      <div className="grow">{text.unsent(n)}</div>
    </div>
  );
}
