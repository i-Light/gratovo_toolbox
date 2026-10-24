import { Empty, Icon } from "@gratovo/ui";

import { openSetting } from "../lib/actions";
import { meIsOwner, searchSettings, settingsSections } from "../lib/settings";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";

const { tabs } = strings.screens.settings;

/**
 * What the search found: the rows (a click opens the row's section and highlights it), then the
 * sections. Nothing found shows an empty state with a hint. `onPick` clears the search first.
 */
export function Results({
  query,
  onPick,
}: {
  readonly query: string;
  readonly onPick: () => void;
}) {
  const owner = useApp((s) => meIsOwner(s.data));
  const source = useApp((s) => s.data.source);
  const { rows, sections } = searchSettings(query, owner, source);
  if (rows.length === 0 && sections.length === 0) {
    return (
      <div className="card">
        <Empty icon="search" title={strings.settings.noMatch(query)}>
          {strings.settings.noMatchHint}
        </Empty>
      </div>
    );
  }
  return (
    <div className="col">
      {rows.length > 0 ? (
        <div className="card tight">
          {rows.map((row) => {
            const icon = settingsSections.find((s) => s.key === row.section)?.icon ?? "gear";
            return (
              <button
                key={`${row.section}-${row.id}`}
                type="button"
                className="li"
                onClick={() => {
                  onPick();
                  openSetting(row.section, row.id);
                }}
              >
                <span className="tb-ic">
                  <Icon name={icon} size={15} />
                </span>
                <span className="lt">
                  <b>{strings.settings.rows[row.id].label}</b>
                  <small>{tabs[row.section]}</small>
                </span>
                <Icon name="chevR" className="flip" />
              </button>
            );
          })}
        </div>
      ) : null}
      {sections.length > 0 ? (
        <div className="card tight">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className="li"
              onClick={() => {
                onPick();
                go("settings", s.key);
              }}
            >
              <span className="tb-ic">
                <Icon name={s.icon} size={15} />
              </span>
              <span className="lt">
                <b>{tabs[s.key]}</b>
                <small>{strings.settings.sections[s.key].sub}</small>
              </span>
              <Icon name="chevR" className="flip" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
