import type { Comment } from "@gratovo/ipc";

import { peek } from "../lib/actions";
import { commentsForClaude, exportComments, openCount, setOpen } from "../lib/prototype";
import { appStore, findRecord, go, recordName, selectRoute } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";
import { locate } from "./anchor";
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

/** Goes to where a comment was left (screen, tab, record, peek), opens its card and scrolls to it. */
export function visitComment(c: Comment): void {
  const state = appStore().getState();
  const route = selectRoute(state);
  if (!c.place.global && c.place.screen !== null) {
    const record = c.place.record === null ? null : asRecordRef(c.place.record);
    const sameSpot = isHere({ ...c.place, peek: null }, route, state.ui.peek);
    if (!sameSpot) {
      const screen = c.place.screen as Parameters<typeof go>[0];
      if (record !== null) {
        go(screen, c.place.tab, { record, from: route.screen });
      } else {
        go(screen, c.place.tab);
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
