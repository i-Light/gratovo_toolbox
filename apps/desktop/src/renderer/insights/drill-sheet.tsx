import { Btn, IconBtn } from "@gratovo/ui";
import type { DrillRow } from "@gratovo/core/insights";
import { useEffect, useRef } from "react";

import { useReturnFocus } from "../lib/focus";
import { useKeys } from "../lib/keys";
import { strings } from "../strings";

import { noteText } from "./words/drill";

const text = strings.insights.drill;

/** What `DrillSheet` takes. */
export interface DrillSheetProps {
  /** The sheet heading: what the number counted. */
  readonly title: string;
  readonly rows: readonly DrillRow[];
  /** How many records there are in all; more than `rows.length` shows Load more. */
  readonly total: number;
  readonly onMore: () => void;
  readonly onOpen: (row: DrillRow) => void;
  /** Set when the number also counts archived channels: the sheet says so and opens the archive. */
  readonly onArchive?: () => void;
  readonly onClose: () => void;
}

/** The records behind a number, in a side sheet. Esc closes it and focus goes back to where it was. */
export function DrillSheet({
  title,
  rows,
  total,
  onMore,
  onOpen,
  onArchive,
  onClose,
}: DrillSheetProps) {
  const sheet = useRef<HTMLElement>(null);
  useKeys({ escape: onClose });
  useReturnFocus(true);
  useEffect(() => {
    sheet.current?.focus();
  }, []);
  return (
    <aside
      className="ins-sheet"
      data-ui="insights.drill"
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      ref={sheet}
    >
      <div className="ins-sheet-head">
        <div className="ins-sheet-title">
          <h2>{title}</h2>
          <span className="muted num">{text.title(total)}</span>
        </div>
        <IconBtn icon="x" label={text.close} dataUi="insights.drill.close" onClick={onClose} />
      </div>
      {onArchive === undefined ? null : (
        <div className="ins-sheet-aside" data-ui="insights.drill.archived">
          <p className="muted">{text.archived}</p>
          <Btn kind="ghost" size="sm" onClick={onArchive}>
            {text.openArchive}
          </Btn>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="ins-sheet-empty muted">{text.empty}</p>
      ) : (
        <ul className="ins-sheet-list" aria-label={text.label}>
          {rows.map((row) => {
            const inner = (
              <>
                <span className="ins-row-name">{row.name}</span>
                {row.handle === null ? null : (
                  <span className="ins-row-handle muted">{row.handle}</span>
                )}
                {row.note === null ? null : (
                  <span className="ins-row-note">{noteText(row.note)}</span>
                )}
              </>
            );
            return (
              <li key={row.id}>
                {/* A gone record has nothing to open. */}
                {row.note?.kind === "gone" ? (
                  <div className="ins-sheet-row muted" data-ui="insights.drill.row">
                    {inner}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ins-sheet-row"
                    data-ui="insights.drill.row"
                    aria-label={`${text.open} ${row.name}`}
                    onClick={() => {
                      onOpen(row);
                    }}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length < total ? (
        <div className="ins-sheet-foot">
          <Btn kind="ghost" size="sm" onClick={onMore}>
            {text.more}
          </Btn>
        </div>
      ) : null}
    </aside>
  );
}
