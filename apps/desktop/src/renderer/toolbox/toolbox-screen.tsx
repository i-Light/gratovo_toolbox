import { Icon, PageHead } from "@gratovo/ui";

import { useKeys } from "../lib/keys";
import { screens } from "../lib/routes";
import { go } from "../lib/store";
import { strings } from "../strings";
import { ArchiveTool } from "./archive-tool";
import { LogTool } from "./log-tool";
import { NeverTool } from "./never-tool";
import { ToolboxList, useCurrentTool, useShownTools, type ToolKey } from "./toolbox-list";

const text = strings.toolbox;
const { tabs } = strings.screens.toolbox;

function ToolView({ tool }: { readonly tool: ToolKey }) {
  switch (tool) {
    case "archive":
      return <ArchiveTool />;
    case "never":
      return <NeverTool />;
    case "log":
      return <LogTool />;
  }
}

/**
 * The Toolbox screen (D34): the tools on the left, the open tool on the right. The route's tab
 * says which tool is open. J and K step through the tools.
 */
export function ToolboxScreen() {
  const shown = useShownTools();
  const current = useCurrentTool();
  const sub = screens.toolbox.sub;
  const step = (by: number): void => {
    const at = shown.findIndex((t) => t.key === current?.key);
    const next = shown[at + by];
    if (at >= 0 && next !== undefined) {
      go("toolbox", next.key);
    }
  };
  // Single letters: the key stack leaves them out while typing and when the letters switch is off.
  useKeys({
    j: () => {
      step(1);
    },
    k: () => {
      step(-1);
    },
  });
  if (current === undefined) {
    return null;
  }
  return (
    <div className="page">
      <PageHead title={screens.toolbox.name} {...(sub === null ? {} : { sub })} />
      <div className="tb">
        <ToolboxList />
        <div className="card tb-pane" key={current.key}>
          <div className="row top" style={{ gap: "12px" }}>
            <span className="tb-ic tb-ic-lg">
              <Icon name={current.icon} size={18} />
            </span>
            <div className="grow col t2">
              <h2>{tabs[current.key]}</h2>
              <p className="small ink2 tb-long">{text.tools[current.key].long}</p>
            </div>
          </div>
          <hr className="divider" />
          <ToolView tool={current.key} />
        </div>
      </div>
    </div>
  );
}
