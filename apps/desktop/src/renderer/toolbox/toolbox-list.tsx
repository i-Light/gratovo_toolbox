import { Icon, type IconName } from "@gratovo/ui";

import { go, selectRoute, useApp } from "../lib/store";
import { useToolboxCounts } from "../lib/toolbox";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { useScheduled } from "./scheduled-tool";

const text = strings.toolbox;
const { tabs } = strings.screens.toolbox;

export type ToolKey = keyof typeof tabs;

interface Tool {
  readonly key: ToolKey;
  readonly group: "tools" | "history";
  readonly icon: IconName;
}

/** The tools in the order the list shows them, with their group and icon. */
const toolOrder: readonly Tool[] = [
  { key: "archive", group: "tools", icon: "trash" },
  { key: "never", group: "tools", icon: "ban" },
  { key: "scheduled", group: "tools", icon: "clock" },
  { key: "log", group: "history", icon: "list" },
];

/** The tools the route may show (the live gate), in list order. */
export function useShownTools(): readonly Tool[] {
  const source = useApp((s) => s.data.source);
  const shown = new Set(shownTabs("toolbox", source).map((t) => t.key));
  return toolOrder.filter((t) => shown.has(t.key));
}

/** The tool the route opens: its tab, else the first one shown. */
export function useCurrentTool(): Tool | undefined {
  const tab = useApp((s) => selectRoute(s).tab);
  const shown = useShownTools();
  return shown.find((t) => t.key === tab) ?? shown[0];
}

/** The left column: the tools in two groups, each with its icon, one line and a count. */
export function ToolboxList() {
  const counts = useToolboxCounts();
  const scheduled = useScheduled().length;
  const shown = useShownTools();
  const current = useCurrentTool();
  const countOf = (key: ToolKey): number => {
    if (key === "scheduled") {
      return scheduled;
    }
    if (counts === null) {
      return 0;
    }
    return key === "archive" ? counts.archive : key === "never" ? counts.never : counts.logToday;
  };
  return (
    <nav className="card tight tb-list" aria-label={text.navLabel}>
      {(["tools", "history"] as const).map((group) => {
        const inGroup = shown.filter((t) => t.group === group);
        return inGroup.length === 0 ? null : (
          <div key={group} className="bucket">
            <div className="bucket-h">{text.groups[group]}</div>
            {inGroup.map((t) => {
              const n = countOf(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  className="li"
                  aria-current={current?.key === t.key ? "page" : undefined}
                  onClick={() => {
                    go("toolbox", t.key);
                  }}
                >
                  <span className="tb-ic">
                    <Icon name={t.icon} size={15} />
                  </span>
                  <span className="lt">
                    <b>{tabs[t.key]}</b>
                    <small>{text.tools[t.key].sub}</small>
                  </span>
                  {n > 0 ? (
                    <span
                      className="cnt"
                      {...(t.key === "log" || t.key === "scheduled"
                        ? { "data-tip": text.countTips[t.key] }
                        : {})}
                    >
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
