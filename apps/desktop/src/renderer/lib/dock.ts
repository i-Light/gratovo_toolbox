import type { DraftKind } from "@gratovo/core/data";
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

/** Opens the dock out if folded and moves focus into it (the "Show it" button of another card). */
export function showDock(): void {
  appStore().ui((ui) => {
    if (ui.dock !== null && ui.dock.min) {
      ui.dock = { draft: ui.dock.draft, min: false };
    }
  });
  setTimeout(() => {
    document.querySelector<HTMLElement>('[data-ui="frame.dock"]')?.focus();
  }, 0);
}

/** Folds the dock to its header, or opens it again. */
export function toggleDockMin(): void {
  appStore().ui((ui) => {
    if (ui.dock !== null) {
      ui.dock = { draft: ui.dock.draft, min: !ui.dock.min };
    }
  });
}

/** Drafts a person asked for ("creator:kind") that have not come back ready yet (this visit only). */
const asked = new Set<string>();
const key = (creator: string, kind: DraftKind): string => `${creator}:${kind}`;

/** Notes that a person asked for a draft of this kind for this creator: when it turns ready, a toast offers to open it. */
export function expectDraft(creatorId: string, kind: DraftKind): void {
  asked.add(key(creatorId, kind));
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
  const failedBefore = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ready = new Set(
      drafts.filter((d) => d.state === "ready" && d.rewriting === null).map((d) => d.id),
    );
    const was = before.current;
    before.current = ready;
    // An asked-for draft that failed will not come: forget it so a later background draft stays quiet.
    const failed = new Set(drafts.filter((d) => d.state === "failed").map((d) => d.id));
    for (const d of drafts) {
      if (failed.has(d.id) && !failedBefore.current.has(d.id)) {
        asked.delete(key(d.creator, d.kind));
      }
    }
    failedBefore.current = failed;
    if (was === null) {
      return;
    }
    for (const d of drafts) {
      if (!ready.has(d.id) || was.has(d.id) || !asked.has(key(d.creator, d.kind))) {
        continue;
      }
      asked.delete(key(d.creator, d.kind));
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
