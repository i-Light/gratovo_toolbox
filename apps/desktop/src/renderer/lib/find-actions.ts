import type { CatalogItem } from "@gratovo/core/find";
import { creatorStages } from "@gratovo/core/data";
import type { Creator, CreatorStage, LogAction, RejectReason } from "@gratovo/core/data";

import { strings } from "../strings";
import { act } from "./actions";
import { adoptServerData } from "./persist";
import type { DataDraft } from "./persist";
import { appStore } from "./store";

const t = strings.findActions;

/**
 * Adds every catalog item the frame doesn't hold yet to `data.creators`, in the current data and
 * every undo step, and writes nothing (D3). The frame keeps its creators; a catalog channel gets
 * in only when someone acts on it.
 */
export function ensureCreators(items: readonly CatalogItem[]): void {
  const held = new Set(
    appStore()
      .getState()
      .data.creators.map((c) => c.id),
  );
  const missing: Creator[] = [];
  for (const item of items) {
    if (!held.has(item.id)) {
      held.add(item.id);
      missing.push({
        id: item.id,
        name: item.name,
        handle: item.handle,
        stage: item.stage,
        email: item.email,
        emailConfirmed: item.emailConfirmed,
        contactName: item.contactName,
        // The catalog carries no source or confidence: an adopted creator's contact has none
        // until a confirm sets them.
        contactSource: null,
        contactConfidence: null,
        rejectReason: item.rejectReason,
        rejectedAt: null,
        archiveDueAt: item.archiveDueAt,
      });
    }
  }
  if (missing.length > 0) {
    adoptServerData((data) => {
      data.creators.push(...missing);
    });
  }
}

interface Change {
  /** The stages the action makes sense for; a creator in another stage is left alone. */
  readonly from: readonly CreatorStage[];
  readonly action: LogAction;
  /** Sets the new stage (and the reject fields) on the creator. */
  readonly set: (creator: DataDraft["creators"][number], now: number) => void;
  /** The activity line's text for one creator. */
  readonly line: (name: string) => string;
  readonly detail: string | null;
  /** The toast, from the creator's name or the count. */
  readonly msg: (name: string) => string;
  readonly msgMany?: (n: number) => string;
  /** The toast's second line; empty for none. */
  readonly sub: string;
}

/** Makes the change to every item whose creator is in a stage it fits: one act, one log line each. */
function change(items: readonly CatalogItem[], how: Change): boolean {
  ensureCreators(items);
  const ids = new Set(items.map((i) => i.id));
  const todo = appStore()
    .getState()
    .data.creators.filter((c) => ids.has(c.id) && how.from.includes(c.stage));
  const first = todo[0];
  if (first === undefined) {
    return false;
  }
  const label =
    todo.length === 1 || how.msgMany === undefined ? how.msg(first.name) : how.msgMany(todo.length);
  const chosen = new Set(todo.map((c) => c.id));
  const now = Date.now();
  const done = act(
    label,
    (data) => {
      for (const creator of data.creators) {
        if (!chosen.has(creator.id)) {
          continue;
        }
        how.set(creator, now);
        data.log.unshift({
          id: crypto.randomUUID(),
          at: now,
          who: data.me,
          text: how.line(creator.name),
          ref: creator.id,
          action: how.action,
          detail: how.detail,
        });
      }
    },
    { log: false, toast: how.sub === "" ? {} : { sub: how.sub } },
  );
  return done !== false;
}

/** Shortlists the channels that are new or rejected. */
export function shortlist(items: readonly CatalogItem[]): boolean {
  return change(items, {
    from: ["new", "rejected"],
    action: "creator.shortlist",
    set: (c) => {
      c.stage = "shortlisted";
      c.rejectReason = null;
      c.rejectedAt = null;
    },
    line: t.shortlisted,
    detail: null,
    msg: t.shortlisted,
    msgMany: t.shortlistedMany,
    sub: t.shortlistSub,
  });
}

/** Rejects the channels that are new or shortlisted, with one of the four reasons. */
export function reject(items: readonly CatalogItem[], reason: RejectReason): boolean {
  return change(items, {
    from: ["new", "shortlisted"],
    action: "creator.reject",
    set: (c, now) => {
      c.stage = "rejected";
      c.rejectReason = reason;
      c.rejectedAt = now;
    },
    line: t.rejected,
    detail: reason,
    msg: t.rejected,
    msgMany: t.rejectedMany,
    sub: t.rejectSub(t.reasons[reason]),
  });
}

/** Takes a rejected channel back to Review new. */
export function bringBack(item: CatalogItem): boolean {
  return change([item], {
    from: ["rejected"],
    action: "creator.restore",
    set: (c) => {
      c.stage = "new";
      c.rejectReason = null;
      c.rejectedAt = null;
    },
    line: t.broughtBack,
    detail: null,
    msg: t.broughtBack,
    sub: "",
  });
}

/** Marks a channel as never to be emailed; `reasonText` is what the person wrote. */
export function neverContact(item: CatalogItem, reasonText: string): boolean {
  return change([item], {
    from: creatorStagesExcept("never"),
    action: "creator.never",
    set: (c, now) => {
      c.stage = "never";
      c.rejectReason = null;
      c.rejectedAt = now;
    },
    line: t.never,
    detail: reasonText,
    msg: t.never,
    sub: t.neverSub,
  });
}

/** Lets a never-contact channel be emailed again; it goes back to Review new. */
export function allowAgain(item: CatalogItem): boolean {
  return change([item], {
    from: ["never"],
    action: "creator.allow",
    set: (c) => {
      c.stage = "new";
      c.rejectReason = null;
      c.rejectedAt = null;
    },
    line: t.allowed,
    detail: null,
    msg: t.allowed,
    sub: t.allowedSub,
  });
}

function creatorStagesExcept(stage: CreatorStage): CreatorStage[] {
  return creatorStages.filter((s) => s !== stage);
}
