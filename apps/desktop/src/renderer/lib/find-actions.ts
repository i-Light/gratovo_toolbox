import type { CatalogItem } from "@gratovo/core/find";
import { contactNameMax, creatorStages, emailMax, emailPattern } from "@gratovo/core/data";
import type {
  ContactSource,
  Creator,
  CreatorStage,
  LogAction,
  RejectReason,
} from "@gratovo/core/data";

import { strings } from "../strings";
import { act } from "./actions";
import { adoptServerData } from "./persist";
import type { DataDraft } from "./persist";
import { appStore } from "./store";

const t = strings.findActions;
const contacts = strings.findContacts;

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
        rejectedAt: item.rejectedAt,
        neverReason: item.neverReason,
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
      c.neverReason = null;
    },
    line: t.rejected,
    detail: reason,
    msg: t.rejected,
    msgMany: t.rejectedMany,
    sub: t.rejectSub(t.reasons[reason]),
  });
}

/** Takes a rejected channel back to Review new; `sub` is the toast's second line, if the caller has words for it. */
export function bringBack(item: CatalogItem, sub = ""): boolean {
  return change([item], {
    from: ["rejected"],
    action: "creator.restore",
    set: (c) => {
      c.stage = "new";
      c.rejectReason = null;
      c.rejectedAt = null;
      c.neverReason = null;
    },
    line: t.broughtBack,
    detail: null,
    msg: t.broughtBack,
    sub,
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
      c.neverReason = reasonText;
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
      c.neverReason = null;
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

/** An address to confirm for one channel: where it came from and how sure, or typed by hand. */
export interface AddressChoice {
  readonly email: string;
  /** Who reads the inbox; empty for none. */
  readonly contactName: string;
  readonly source: ContactSource;
  /** 0 to 1; null for an address typed by hand. */
  readonly confidence: number | null;
}

/** True for something that can be confirmed as an address (D31): the basic shape, at most 254. */
export function isAddress(email: string): boolean {
  return email.length <= emailMax && emailPattern.test(email);
}

/** The reader's name as stored: trimmed, at most 80, empty is none. */
function cleanName(name: string): string | null {
  const cut = name.trim().slice(0, contactNameMax).trim();
  return cut === "" ? null : cut;
}

/**
 * Confirms an address for every channel in the list: one act (one Undo), one activity line each.
 * The channel's email, name, source and sureness are set, and a shortlisted one moves on to
 * Contact; any other stage keeps its own. An address that is not one is left alone (false).
 */
function confirmList(
  list: readonly { readonly item: CatalogItem; readonly choice: AddressChoice }[],
): boolean {
  const entries = list
    .map((e) => ({ ...e, email: e.choice.email.trim() }))
    .filter((e) => isAddress(e.email));
  const first = entries[0];
  if (first === undefined || entries.length !== list.length) {
    return false;
  }
  ensureCreators(entries.map((e) => e.item));
  const byId = new Map(entries.map((e) => [e.item.id, e]));
  const label =
    entries.length === 1
      ? contacts.confirmed(first.item.name)
      : contacts.confirmedMany(entries.length);
  const now = Date.now();
  const done = act(
    label,
    (data) => {
      for (const creator of data.creators) {
        const entry = byId.get(creator.id);
        if (entry === undefined) {
          continue;
        }
        creator.email = entry.email;
        creator.emailConfirmed = true;
        creator.contactName = cleanName(entry.choice.contactName);
        creator.contactSource = entry.choice.source;
        creator.contactConfidence = entry.choice.confidence;
        if (creator.stage === "shortlisted") {
          creator.stage = "contact";
        }
        data.log.unshift({
          id: crypto.randomUUID(),
          at: now,
          who: data.me,
          text: contacts.logLine(creator.name),
          ref: creator.id,
          action: null,
          detail: null,
        });
      }
    },
    { log: false, toast: { sub: contacts.confirmedSub } },
  );
  return done !== false;
}

/** Confirms the address for one channel, with the name of whoever reads that inbox (may be empty). */
export function confirmAddress(item: CatalogItem, choice: AddressChoice): boolean {
  return confirmList([{ item, choice }]);
}

/** Confirms one address each, names left empty, in one act (Confirm all 90%+). */
export function confirmMany(
  list: readonly { readonly item: CatalogItem; readonly choice: AddressChoice }[],
): boolean {
  // One that is not an address is skipped; the rest are still confirmed.
  const fine = list.filter((e) => isAddress(e.choice.email.trim()));
  if (fine.length === 0) {
    return false;
  }
  return confirmList(fine.map((e) => ({ ...e, choice: { ...e.choice, contactName: "" } })));
}
