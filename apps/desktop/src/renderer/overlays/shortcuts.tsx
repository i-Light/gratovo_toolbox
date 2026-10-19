import { IconBtn } from "@gratovo/ui";
import type { CSSProperties } from "react";

import { setShortcuts } from "../lib/actions";
import { useKeys } from "../lib/keys";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { ModalLayer } from "./modal-layer";

function close(): void {
  setShortcuts(false);
}

const rowStyle: CSSProperties = {
  justifyContent: "space-between",
  gap: "12px",
  padding: "3px 0",
  borderBottom: "1px solid var(--line)",
};

function ShortcutsBody() {
  useKeys({ escape: close, "?": close }, { barrier: true });
  const { shortcuts } = strings;
  return (
    <ModalLayer label={shortcuts.label} onClose={close} focusSelf>
      <div className="scrim" role="presentation" onClick={close}></div>
      <div className="modal" style={{ "--mw": "760px" } as CSSProperties}>
        <div className="row">
          <h2 className="grow">{shortcuts.label}</h2>
          <IconBtn icon="x" label={shortcuts.close} onClick={close} />
        </div>
        <div className="grid2">
          {shortcuts.groups.map((group) => (
            <div key={group.title} className="col tight">
              <h4>{group.title}</h4>
              {group.rows.map(([keys, text]) => (
                <div key={keys} className="row small" style={rowStyle}>
                  <span className="ink2">{text}</span>
                  <span className="kbd">{keys}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="hint">{shortcuts.hint}</p>
      </div>
    </ModalLayer>
  );
}

/** The keyboard shortcut sheet, open while `ui.shortcuts` is set. Esc or `?` closes it; it holds the keys as a barrier. */
export function Shortcuts() {
  const open = useApp((s) => s.ui.shortcuts);
  return open ? <ShortcutsBody /> : null;
}
