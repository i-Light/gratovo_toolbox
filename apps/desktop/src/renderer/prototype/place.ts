import type { Comment, CommentPlace, CommentRef } from "@gratovo/ipc";

import { screens } from "../lib/routes";
import type { RecordRef, Route, ScreenKey } from "../lib/routes";
import { findRecord, recordName } from "../lib/store";
import type { AppData, Peek } from "../lib/store";
import { strings } from "../strings";

const text = strings.prototype;

function toRef(ref: RecordRef): CommentRef {
  return { kind: ref.kind, id: ref.id };
}

function sameRef(a: CommentRef | null, b: CommentRef | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}

/** Where a comment on `target` is left: the open screen, tab, record and peek, or everywhere. */
export function placeOf(target: Element, route: Route, peek: Peek | null): CommentPlace {
  if (target.closest("nav.rail, header.top") !== null) {
    return { global: true, screen: null, tab: null, record: null, peek: null };
  }
  const inPeek = peek !== null && target.closest(".peek") !== null;
  return {
    global: false,
    screen: route.screen,
    tab: route.tab,
    record: route.record === undefined ? null : toRef(route.record),
    peek: inPeek ? toRef(peek.record) : null,
  };
}

/** Does a comment belong on what is open right now? Global ones belong everywhere. */
export function isHere(place: CommentPlace, route: Route, peek: Peek | null): boolean {
  if (place.global) {
    return true;
  }
  if (place.screen !== route.screen || place.tab !== route.tab) {
    return false;
  }
  if (!sameRef(place.record, route.record === undefined ? null : toRef(route.record))) {
    return false;
  }
  return place.peek === null || sameRef(place.peek, peek === null ? null : toRef(peek.record));
}

function refName(data: AppData, ref: CommentRef): string | null {
  if (ref.kind !== "creator" && ref.kind !== "brand" && ref.kind !== "deal") {
    return null;
  }
  const found: RecordRef = { kind: ref.kind, id: ref.id };
  return findRecord(data, found) === undefined ? null : recordName(data, found);
}

/** The record kinds a place may name; anything else cannot be opened. */
export function asRecordRef(ref: CommentRef): RecordRef | null {
  return ref.kind === "creator" || ref.kind === "brand" || ref.kind === "deal"
    ? { kind: ref.kind, id: ref.id }
    : null;
}

/** Where a comment was left, as words: "Find › Review new › Maya Chen", or "Everywhere · Back". */
export function whereText(c: Comment, data: AppData): string {
  if (c.place.global) {
    return c.anchor.label === ""
      ? text.forClaude.everywhere
      : text.cmt.everywhereWith(c.anchor.label);
  }
  const screen = c.place.screen;
  const info =
    screen !== null && Object.hasOwn(screens, screen) ? screens[screen as ScreenKey] : undefined;
  const tab =
    info !== undefined && c.place.tab !== null
      ? (info.tabs.find((t) => t.key === c.place.tab)?.name ?? c.place.tab)
      : null;
  const bits = [info?.name ?? screen ?? ""];
  if (tab !== null) {
    bits.push(tab);
  }
  for (const ref of [c.place.record, c.place.peek]) {
    if (ref !== null) {
      bits.push(refName(data, ref) ?? text.forClaude.aRecord);
    }
  }
  return bits.filter((b) => b !== "").join(" › ");
}

/** A comment's number: its place in the whole list, oldest first, from 1. */
export function numberOf(list: readonly Comment[], id: string): number {
  return list.findIndex((c) => c.id === id) + 1;
}
