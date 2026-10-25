import type { OutreachDraft } from "@gratovo/core/data";
import type { FramePart, SyncStatus } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";

import { toAppData } from "./frame";
import { noticeReachChange } from "./reach-actions";
import { adoptServerData, onPersistenceIdle, persistenceIdle } from "./persist";
import type { DataDraft } from "./persist";
import { appStore } from "./store";
import type { AppData } from "./store";

/** The most often the page asks main for a fresh frame. */
const askEveryMs = 1000;
/** The activity log keeps this many lines, newest first (the frame's size). */
const logKept = 50;
/** The frame lists at most this many creators; a creator missing from a full list may still exist. */
const listCap = 5000;

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    );
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => sameValue(x[k], y[k]));
}

/**
 * The list to put in place of `list` (the page's data or one of its undo steps), or null when it
 * would not change. Only what is news to the page goes in: an item the page already shows exactly
 * as the server has it (your own change coming back, or one adopted before) leaves every step
 * alone, so Undo still undoes it. An item the page holds but the server no longer lists goes,
 * except from a full creator list, which is cut off. Unchanged items keep their reference.
 */
function mergeList<T extends { readonly id: string }>(
  list: readonly T[],
  shown: readonly T[],
  next: readonly T[],
  keepMissing: boolean,
): readonly T[] | null {
  const shownById = new Map(shown.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const news = next.filter((item) => {
    const was = shownById.get(item.id);
    return was === undefined || !sameValue(was, item);
  });
  const gone = keepMissing
    ? new Set<string>()
    : new Set(shown.filter((item) => !nextById.has(item.id)).map((item) => item.id));
  if (news.length === 0 && gone.size === 0) {
    return null;
  }
  const newsById = new Map(news.map((item) => [item.id, item]));
  const merged: T[] = [];
  for (const item of list) {
    if (gone.has(item.id)) {
      continue;
    }
    const replacement = newsById.get(item.id);
    merged.push(replacement !== undefined && !sameValue(replacement, item) ? replacement : item);
    newsById.delete(item.id);
  }
  // Records new to this step: in the server's order, after the ones the step already has.
  merged.push(...newsById.values());
  const same = merged.length === list.length && merged.every((item, i) => item === list[i]);
  return same ? null : merged;
}

function mergeLog(draft: DataDraft, shown: AppData, next: AppData): void {
  const shownIds = new Set(shown.log.map((line) => line.id));
  const incoming = new Set(next.log.map((line) => line.id));
  // News only: a teammate's line the page doesn't have comes in, and a teammate's line the server
  // no longer has goes. Your own lines are left to you and your undo steps.
  const added = next.log.filter((line) => !shownIds.has(line.id));
  const gone = new Set(
    shown.log
      .filter((line) => line.who !== shown.me && !incoming.has(line.id))
      .map((line) => line.id),
  );
  const have = new Set(draft.log.map((line) => line.id));
  const merged = [
    ...draft.log.filter((line) => !gone.has(line.id)),
    ...added.filter((line) => !have.has(line.id)),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, logKept);
  const same =
    merged.length === draft.log.length && merged.every((line, i) => line === draft.log[i]);
  if (!same) {
    draft.log = merged;
  }
}

const reachMainFields = [
  "threads",
  "sequences",
  "mailboxes",
  "gemini",
  "geminiPausedUntil",
  "sender",
] as const satisfies readonly (keyof AppData["reach"])[];

/** The draft fields a person sets: their own change coming back is not news (D5). */
const personDraftFields = [
  "state",
  "subject",
  "body",
  "mailbox",
  "gatesOk",
] as const satisfies readonly (keyof OutreachDraft)[];

/**
 * One draft of `list` (the page's data or an undo step) with main's answer folded in, field by
 * field. A field a person sets is news only when main's value differs from what the page showed,
 * so a Send or a Skip coming back, with main's own `sendAt` and `updatedAt`, never reaches the
 * undo steps before it, and Undo still takes it back. The fields main alone sets (the proposal,
 * the problem, the times, rewriting) always follow main. `sendAt` follows the state that wins.
 */
function mergeDraft(
  item: OutreachDraft,
  shown: OutreachDraft | undefined,
  next: OutreachDraft,
): OutreachDraft {
  const out: Record<string, unknown> = { ...item };
  let changed = false;
  for (const key of Object.keys(next) as (keyof OutreachDraft)[]) {
    if (key === "sendAt") {
      continue;
    }
    const person = (personDraftFields as readonly string[]).includes(key);
    const isNews = !person || shown === undefined || !sameValue(shown[key], next[key]);
    if (isNews && !sameValue(item[key], next[key])) {
      out[key] = next[key];
      changed = true;
    }
  }
  const sendAt = out.state === next.state ? next.sendAt : item.sendAt;
  if (!Object.is(sendAt, item.sendAt)) {
    out.sendAt = sendAt;
    changed = true;
  }
  return changed ? (out as unknown as OutreachDraft) : item;
}

/** The drafts to put in place of `list`, or null when nothing changes (as `mergeList`). */
function mergeDrafts(
  list: readonly OutreachDraft[],
  shown: readonly OutreachDraft[],
  next: readonly OutreachDraft[],
): readonly OutreachDraft[] | null {
  const shownById = new Map(shown.map((d) => [d.id, d]));
  const nextById = new Map(next.map((d) => [d.id, d]));
  const held = new Set(list.map((d) => d.id));
  let changed = false;
  const merged: OutreachDraft[] = [];
  for (const item of list) {
    const fresh = nextById.get(item.id);
    if (fresh === undefined) {
      // Gone from main's list (a day after it was sent or skipped): gone here too, unless the
      // page never showed it gone.
      if (shownById.has(item.id)) {
        changed = true;
        continue;
      }
      merged.push(item);
      continue;
    }
    const done = mergeDraft(item, shownById.get(item.id), fresh);
    changed ||= done !== item;
    merged.push(done);
  }
  // Drafts this step lacks: those that are news (new, or changed since the page showed them).
  for (const fresh of next) {
    const was = shownById.get(fresh.id);
    if (!held.has(fresh.id) && (was === undefined || !sameValue(was, fresh))) {
      merged.push(fresh);
      changed = true;
    }
  }
  return changed ? merged : null;
}

/**
 * Reach is server news like the records: drafts by id and field (`mergeDrafts`); the rest is
 * main's and is replaced when it differs.
 */
function mergeReach(draft: DataDraft, shown: AppData, next: AppData): void {
  const drafts = mergeDrafts(draft.reach.drafts, shown.reach.drafts, next.reach.drafts);
  if (drafts !== null) {
    draft.reach.drafts = drafts as typeof draft.reach.drafts;
  }
  for (const field of reachMainFields) {
    if (!sameValue(draft.reach[field], next.reach[field])) {
      (draft.reach as Record<string, unknown>)[field] = next.reach[field];
    }
  }
}

/**
 * Folds the server's answer into the page's data, or into one of its undo steps (`bg` runs this on
 * each). `shown` is the page's data when the answer arrived: only what differs from it is news, so
 * your own changes coming back from the server never reach the steps before them, and Undo still
 * undoes them. The team, the conflicts and the money switch are the server's alone (nothing the
 * page undoes). Creators, brands and deals take the news by id; the log gets teammates' new lines
 * and loses their lines that are gone; `myName` follows only when `parts` names `me`, and the
 * notifications and their switches only when it names `notify`, each only when it is news.
 */
export function mergeServerData(
  draft: DataDraft,
  next: AppData,
  parts: ReadonlySet<FramePart>,
  shown: AppData,
): void {
  if (draft.seesMoney !== next.seesMoney) {
    draft.seesMoney = next.seesMoney;
  }
  if (!sameValue(draft.team, next.team)) {
    draft.team = next.team as typeof draft.team;
  }
  if (!sameValue(draft.conflicts, next.conflicts)) {
    draft.conflicts = next.conflicts as typeof draft.conflicts;
  }
  const creators = mergeList(
    draft.creators,
    shown.creators,
    next.creators,
    next.creators.length >= listCap,
  );
  if (creators !== null) {
    draft.creators = creators as typeof draft.creators;
  }
  const brands = mergeList(draft.brands, shown.brands, next.brands, false);
  if (brands !== null) {
    draft.brands = brands as typeof draft.brands;
  }
  const deals = mergeList(draft.deals, shown.deals, next.deals, false);
  if (deals !== null) {
    draft.deals = deals as typeof draft.deals;
  }
  mergeReach(draft, shown, next);
  if (parts.has("log")) {
    mergeLog(draft, shown, next);
  }
  if (parts.has("me") && shown.myName !== next.myName && draft.myName !== next.myName) {
    draft.myName = next.myName;
  }
  if (parts.has("notify")) {
    if (
      !sameValue(shown.settings.notify, next.settings.notify) &&
      !sameValue(draft.settings.notify, next.settings.notify)
    ) {
      draft.settings.notify = next.settings.notify;
    }
    // By id, news only, like the records: marking read is undoable, so your own reads coming back
    // must not reach the steps before them.
    const notifications = mergeList(
      draft.notifications,
      shown.notifications,
      next.notifications,
      false,
    );
    if (notifications !== null) {
      // Newest first, as the frame lists them.
      draft.notifications = [...notifications].sort((x, y) => y.at - x.at);
    }
  }
}

/** Puts each listed member's status and what they are doing on the team; others stay as they are. */
export function mergePresence(
  draft: DataDraft,
  members: readonly {
    readonly id: string;
    readonly status: "online" | "away";
    readonly doing: string;
  }[],
): void {
  const byId = new Map(members.map((m) => [m.id, m]));
  draft.team.forEach((person, i) => {
    const seen = byId.get(person.id);
    if (seen !== undefined && (person.status !== seen.status || person.doing !== seen.doing)) {
      draft.team[i] = { ...person, status: seen.status, doing: seen.doing };
    }
  });
}

/**
 * Keeps the page in step with main: a `frame:changed` makes it ask for the frame (when the
 * persister is idle, at most once a second) and fold the answer in without writing it back; a
 * `sync:status` goes to the UI state; a `presence:changed` updates each listed member's status and
 * what they are doing (nothing is written). The answer is dropped, and asked for again, when the data
 * changed while it was on its way. Returns a function that stops it.
 */
export function installLiveUpdates(bridge: Pick<Bridge, "invoke" | "on">): () => void {
  let stopped = false;
  let wanted = new Set<FramePart>();
  let busy = false;
  let waiting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAskedAt = Number.NEGATIVE_INFINITY;

  const ask = async (): Promise<void> => {
    busy = true;
    lastAskedAt = Date.now();
    const parts = wanted;
    wanted = new Set();
    const store = appStore();
    const noted = store.getState().data;
    try {
      const loaded = await bridge.invoke("frame:load", {});
      if (stopped) {
        return;
      }
      if (!loaded.ok) {
        console.error("The page couldn't read the server's changes:", loaded.reason);
        return;
      }
      if (appStore() !== store || store.getState().data !== noted || !persistenceIdle()) {
        for (const part of parts) {
          wanted.add(part);
        }
        return;
      }
      const next = toAppData(loaded.value);
      const shown = store.getState().data;
      adoptServerData((draft) => {
        mergeServerData(draft, next, parts, shown);
      });
      noticeReachChange(shown.reach, next.reach);
    } catch (reason) {
      console.error("The page couldn't read the server's changes:", reason);
    } finally {
      busy = false;
      later();
    }
  };

  function later(): void {
    if (stopped || busy || waiting || timer !== null || wanted.size === 0) {
      return;
    }
    if (!persistenceIdle()) {
      waiting = true;
      onPersistenceIdle(() => {
        waiting = false;
        later();
      });
      return;
    }
    const wait = lastAskedAt + askEveryMs - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        later();
      }, wait);
      return;
    }
    void ask();
  }

  const offFrame = bridge.on("frame:changed", (payload) => {
    for (const part of payload.parts) {
      wanted.add(part);
    }
    later();
  });
  const setStatus = (status: SyncStatus): void => {
    appStore().ui((draft) => {
      draft.sync = status;
    });
  };
  const offStatus = bridge.on("sync:status", setStatus);
  const offPresence = bridge.on("presence:changed", (payload) => {
    if (!stopped) {
      adoptServerData((draft) => {
        mergePresence(draft, payload.members);
      });
    }
  });
  void bridge.invoke("sync:status", {}).then(
    (result) => {
      if (!stopped && result.ok) {
        setStatus(result.value);
      }
    },
    () => undefined,
  );

  return () => {
    stopped = true;
    offFrame();
    offStatus();
    offPresence();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
