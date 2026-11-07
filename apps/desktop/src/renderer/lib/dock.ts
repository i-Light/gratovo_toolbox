import { useEffect, useRef } from "react";

import { strings } from "../strings";
import { appStore, useApp } from "./store";
import { toast } from "./toast";

const t = strings.dock;

/** Opens the draft dock on a draft. Only a person's click calls this. */
export function openDock(draftId: string): void {
  appStore().ui((ui) => {
    ui.dock = { draft: draftId, min: false };
  });
}

/** Closes the draft dock. */
export function closeDock(): void {
  appStore().ui((ui) => {
    ui.dock = null;
  });
}

/** Folds the dock to its header, or opens it again. */
export function toggleDockMin(): void {
  appStore().ui((ui) => {
    if (ui.dock !== null) {
      ui.dock = { draft: ui.dock.draft, min: !ui.dock.min };
    }
  });
}

/** Creators whose draft a person asked for and that has not come back ready yet (this visit only). */
const asked = new Set<string>();

/** Notes that a person asked for a draft for this creator: when it turns ready, a toast offers to open it. */
export function expectDraft(creatorId: string): void {
  asked.add(creatorId);
}

/** Empties the asked-for set (tests). */
export function resetDockForTests(): void {
  asked.clear();
}

/** Toasts "Draft for Name is ready" with an Open button for a draft that was asked for and turns ready. */
export function useDraftReadyToasts(): void {
  const drafts = useApp((s) => s.data.reach.drafts);
  const creators = useApp((s) => s.data.creators);
  const before = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const ready = new Set(
      drafts.filter((d) => d.state === "ready" && d.rewriting === null).map((d) => d.id),
    );
    const was = before.current;
    before.current = ready;
    if (was === null) {
      return;
    }
    for (const d of drafts) {
      if (!ready.has(d.id) || was.has(d.id) || !asked.has(d.creator)) {
        continue;
      }
      asked.delete(d.creator);
      const id = d.id;
      toast({
        msg: t.ready(creators.find((c) => c.id === d.creator)?.name ?? ""),
        icon: "sparkle",
        tone: "info",
        actions: [
          {
            label: t.open,
            run: () => {
              openDock(id);
            },
          },
        ],
      });
    }
  }, [drafts, creators]);
}
