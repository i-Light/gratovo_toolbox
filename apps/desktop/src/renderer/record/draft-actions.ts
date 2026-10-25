import type { Creator } from "@gratovo/core/data";
import type { CatalogItem } from "@gratovo/core/find";

import { confirmAddress, neverContact } from "../lib/find-actions";
import { adoptServerData } from "../lib/persist";
import { appStore } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";

const t = strings.reach.card;

/**
 * A held creator as the Find actions take it. They read only the id (and the name and stage of a
 * channel the page does not hold yet); a creator with a draft is always held, so the rest of a
 * catalog item is never looked at.
 */
export function asCatalogItem(creator: Creator): CatalogItem {
  return { id: creator.id, name: creator.name, handle: creator.handle } as CatalogItem;
}

/** Confirms the address the page already holds for a creator, as typed in and kept. */
export function confirmHeldAddress(creator: Creator): boolean {
  if (creator.email === null) {
    return false;
  }
  return confirmAddress(asCatalogItem(creator), {
    email: creator.email,
    contactName: creator.contactName ?? "",
    source: creator.contactSource ?? "typed",
    confidence: creator.contactConfidence,
  });
}

/** Marks a creator never to be contacted, from the draft card. */
export function neverContactCreator(creator: Creator): boolean {
  return neverContact(asCatalogItem(creator), t.neverWhy);
}

/**
 * Takes an email back during its 10 s hold: `approved` goes back to `ready`, and main drops it
 * from its timer when it reads the write. It is not an undo step: it goes straight through, and
 * reaches every undo step (`adoptServerData`), so neither Ctrl Z nor Redo can put the approval
 * back afterwards. An approval put back that way would carry a time already past (main gives it a
 * fresh hold anyway, D11).
 */
export async function takeBack(id: string): Promise<boolean> {
  const draft = appStore()
    .getState()
    .data.reach.drafts.find((d) => d.id === id);
  if (draft?.state !== "approved") {
    toast({ msg: strings.reach.tooLate, sub: strings.reach.tooLateSub, icon: "alert" });
    return false;
  }
  adoptServerData((data) => {
    const target = data.reach.drafts.find((d) => d.id === id);
    if (target?.state === "approved") {
      target.state = "ready";
      target.sendAt = null;
    }
  });
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [{ kind: "draft.state", id, state: "ready", sendAt: null }],
    });
    if (result.ok) {
      toast({ msg: t.takeBack, icon: "undo", tone: "info", ms: 3000, actions: [] });
      return true;
    }
    console.error("A change wasn't saved:", result.reason);
  } catch (reason) {
    console.error("A change wasn't saved:", reason);
  }
  toast({ msg: strings.saveFailed.title, sub: strings.saveFailed.sub, icon: "alert" });
  return false;
}
