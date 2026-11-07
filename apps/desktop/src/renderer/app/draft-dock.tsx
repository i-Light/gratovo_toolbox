import { Icon } from "@gratovo/ui";
import { useEffect, useRef } from "react";

import { closeDock, toggleDockMin } from "../lib/dock";
import { kindLabel } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { DraftCard } from "../record/draft-card";
import { strings } from "../strings";

const t = strings.dock;

/** The draft dock: one open draft in its card, bottom right. A person opens it; it closes when the draft is done. */
export function DraftDock() {
  const dock = useApp((s) => s.ui.dock);
  const draft = useApp((s) =>
    s.ui.dock === null ? undefined : s.data.reach.drafts.find((d) => d.id === s.ui.dock?.draft),
  );
  const name = useApp((s) =>
    draft === undefined ? "" : (s.data.creators.find((c) => c.id === draft.creator)?.name ?? ""),
  );
  // Done means sent, scheduled or skipped; a scheduled draft is no longer this person's to edit.
  const gone =
    dock !== null &&
    (draft === undefined ||
      draft.state === "sent" ||
      draft.state === "scheduled" ||
      draft.state === "skipped");
  const ref = useRef<HTMLElement>(null);
  const shownFor = dock === null || gone ? null : dock.draft;
  useEffect(() => {
    if (shownFor !== null) {
      ref.current?.focus();
    }
  }, [shownFor]);
  useEffect(() => {
    if (gone) {
      closeDock();
    }
  }, [gone]);
  if (dock === null || draft === undefined || gone) {
    return null;
  }
  const word = dock.min ? t.expand : t.minimise;
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className={dock.min ? "qdock min" : "qdock"}
      role="region"
      aria-label={t.region}
      data-ui="frame.dock"
    >
      <div className="qdock-h">
        <Icon name="send" size={15} />
        <b className="grow ell">{t.title(kindLabel(draft), name)}</b>
        <button
          type="button"
          className="iconbtn"
          aria-label={word}
          data-tip={word}
          aria-expanded={!dock.min}
          onClick={toggleDockMin}
        >
          <Icon name={dock.min ? "chevU" : "chevD"} size={14} />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={t.close}
          data-tip={t.close}
          onClick={closeDock}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {dock.min ? null : (
        <div className="qdock-b">
          <DraftCard key={draft.id} draftId={draft.id} inDock />
        </div>
      )}
    </aside>
  );
}
