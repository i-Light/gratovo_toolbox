import { Avatar, Icon, avatarColor } from "@gratovo/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { setPalette } from "../lib/actions";
import { quietAnimations, useKeys } from "../lib/keys";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { buildCommands } from "./commands";
import type { Command } from "./commands";
import { ModalLayer } from "./modal-layer";

const listId = "palette-list";
const optionId = (i: number): string => `palette-option-${String(i)}`;
const groupId = (i: number): string => `palette-group-${String(i)}`;

/** The rows in runs of the same group, each with the index of its first row. */
function groupRuns(
  list: readonly Command[],
): { readonly start: number; readonly rows: Command[] }[] {
  const runs: { start: number; rows: Command[] }[] = [];
  list.forEach((command, i) => {
    const last = runs.at(-1);
    if (last !== undefined && last.rows[0]?.group === command.group) {
      last.rows.push(command);
    } else {
      runs.push({ start: i, rows: [command] });
    }
  });
  return runs;
}

function close(): void {
  setPalette(false);
}

/**
 * The command palette: search records, jump to a screen or run an action from the keyboard.
 * Open while `ui.palette` is set. It never animates (it must appear the moment Ctrl K is pressed),
 * holds the keys as a barrier so nothing behind it reacts, and runs the chosen row after closing.
 */
function PaletteBody() {
  const data = useApp((s) => s.data);
  const recent = useApp((s) => s.ui.recent);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useKeys({ "mod+k": close, escape: close }, { barrier: true });

  const list = useMemo(() => buildCommands(data, recent, query), [data, recent, query]);
  const index = Math.min(selected, Math.max(0, list.length - 1));
  // Keep the selected row in sight while the arrows move past the bottom (or top) of the list.
  useEffect(() => {
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const choose = (i: number): void => {
    const command = list[i];
    if (command !== undefined) {
      close();
      command.run();
    }
  };

  return (
    <ModalLayer label={strings.palette.label} onClose={close}>
      <div className="scrim" role="presentation" onClick={close}></div>
      <div className="pal" style={{ animation: "none" }}>
        <div className="pal-in">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected(index + 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected(Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                quietAnimations();
                choose(index);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={list.length > 0 ? optionId(index) : undefined}
            aria-autocomplete="list"
            placeholder={strings.palette.placeholder}
            aria-label={strings.palette.inputLabel}
          />
          <span className="kbd">{strings.keys.esc}</span>
        </div>
        <div className="pal-list" role="listbox" id={listId} aria-label={strings.palette.label}>
          {groupRuns(list).map((group) => (
            <div
              key={`${group.rows[0]?.group ?? ""}${String(group.start)}`}
              role="group"
              aria-labelledby={groupId(group.start)}
            >
              <div className="pal-g" id={groupId(group.start)} role="presentation">
                {group.rows[0]?.group}
              </div>
              {group.rows.map((command, k) => {
                const i = group.start + k;
                return (
                  <button
                    key={`${command.label}${String(i)}`}
                    type="button"
                    id={optionId(i)}
                    className="pal-i"
                    role="option"
                    aria-selected={i === index}
                    tabIndex={-1}
                    onMouseMove={() => {
                      if (i !== index) {
                        setSelected(i);
                      }
                    }}
                    onClick={() => {
                      choose(i);
                    }}
                  >
                    {command.avatar === undefined ? (
                      <Icon name={command.icon} />
                    ) : (
                      <Avatar
                        name={command.avatar.name}
                        color={avatarColor(command.avatar.seed)}
                        size="s"
                        decorative
                      />
                    )}
                    <span className="grow ell">
                      {command.label}
                      {command.sub === undefined ? null : (
                        <>
                          {" "}
                          <small>{command.sub}</small>
                        </>
                      )}
                    </span>
                    {command.hint === undefined ? null : (
                      <span className="kbd">{command.hint}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {list.length === 0 ? (
            <p className="hint" style={{ padding: "14px" }}>
              {strings.palette.empty(query)}
            </p>
          ) : null}
        </div>
        <div className="pal-f">
          <span>
            <span className="kbd">{strings.keys.up}</span>{" "}
            <span className="kbd">{strings.keys.down}</span> {strings.palette.footer.move}
          </span>
          <span>
            <span className="kbd">{strings.keys.enter}</span> {strings.palette.footer.open}
          </span>
          <span>
            <span className="kbd">{strings.keys.g}</span> {strings.palette.footer.jump}
          </span>
          <span>
            <span className="kbd">{strings.keys.help}</span> {strings.palette.footer.shortcuts}
          </span>
        </div>
      </div>
    </ModalLayer>
  );
}

/** Mounts the command palette while it is open. Reads only its own flag, so the frame does not re-render. */
export function Palette() {
  const open = useApp((s) => s.ui.palette);
  return open ? <PaletteBody /> : null;
}
