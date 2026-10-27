import type { Comment } from "@gratovo/ipc";

import { peek } from "../lib/actions";
import { exportComments, openCount, setOpen } from "../lib/prototype";
import { appStore, findRecord, go, recordName, selectRoute } from "../lib/store";
import { toast } from "../lib/toast";
import { isRouteShown } from "../lib/wired";
import { screens } from "../lib/routes";
import type { ScreenKey } from "../lib/routes";
import { strings } from "../strings";
import { locate } from "./anchor";
import { commentsForClaude } from "./for-claude";
import { asRecordRef, isHere } from "./place";

const text = strings.prototype;

/** The clipboard, with a toast saying what was copied (or that it could not be). */
export function copyText(value: string, done: string): void {
  const ok = (): void => {
    toast({ msg: done, icon: "copy", tone: "good", ms: 4000 });
  };
  const failed = (): void => {
    toast({ msg: text.copyFailed, icon: "alert", tone: "info" });
  };
  try {
    navigator.clipboard.writeText(value).then(ok, failed);
  } catch {
    failed();
  }
}

/** Copies the open comments, worded for Claude. */
export function copyOpenForClaude(list: readonly Comment[]): void {
  const data = appStore().getState().data;
  const body = commentsForClaude(list, {
    refName: (ref) => {
      const found = asRecordRef(ref);
      return found === null || findRecord(data, found) === undefined
        ? null
        : recordName(data, found);
    },
  });
  copyText(body, text.copied(openCount(list)));
}

/** Writes the comments for Claude into the repository, and says how it went. */
export function exportForClaude(): void {
  void exportComments().then((result) => {
    if (result?.ok === true) {
      toast({ msg: text.exportOk(result.count), icon: "check", tone: "good", ms: 4000 });
    } else if (result?.ok === false && result.problem === "no_repo") {
      toast({ msg: text.exportNoRepo, icon: "info", tone: "info" });
    } else {
      toast({ msg: text.exportFailed, icon: "alert", tone: "info" });
    }
  });
}

/**
 * Where a comment's screen and tab lead, or null when it has none, names a screen or tab the app
 * does not have, or a route the live gate hides. Then the card just opens where the user is.
 */
function routeOf(c: Comment): { screen: ScreenKey; tab: string | null } | null {
  const { global, screen, tab } = c.place;
  if (global || screen === null || !Object.hasOwn(screens, screen)) {
    return null;
  }
  const key = screen as ScreenKey;
  if (tab !== null && !screens[key].tabs.some((t) => t.key === tab)) {
    return null;
  }
  const source = appStore().getState().data.source;
  return isRouteShown({ screen: key, tab }, source) ? { screen: key, tab } : null;
}

/** Goes to where a comment was left (screen, tab, record, peek), opens its card and scrolls to it. */
export function visitComment(c: Comment): void {
  const state = appStore().getState();
  const route = selectRoute(state);
  const target = routeOf(c);
  if (target !== null) {
    const record = c.place.record === null ? null : asRecordRef(c.place.record);
    const sameSpot = isHere({ ...c.place, peek: null }, route, state.ui.peek);
    if (!sameSpot) {
      if (record !== null) {
        go(target.screen, target.tab, { record, from: route.screen });
      } else {
        go(target.screen, target.tab);
      }
    }
    const peekRef = c.place.peek === null ? null : asRecordRef(c.place.peek);
    if (peekRef !== null) {
      peek(peekRef);
    }
  }
  setOpen(c.id);
  setTimeout(() => {
    const found = locate(c.anchor);
    found?.el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 60);
}
