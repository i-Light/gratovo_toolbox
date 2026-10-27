import type { CommentAnchor } from "@gratovo/ipc";

import { strings } from "../strings";

const d = strings.prototype.cmt.describe;

/**
 * What the comment tool may point at: controls, cards, rows, tags, headings, and anything that
 * carries a `data-ui` id. The nearest match to the pointer wins.
 */
export const targetSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role=tab]",
  "[role=option]",
  "[data-ui]",
  ".tag",
  ".chip",
  ".kcard",
  ".gcard",
  ".li",
  "tr",
  ".tile",
  ".msg",
  ".draft",
  ".gate",
  ".fact",
  ".callout",
  ".stat",
  ".thumb",
  ".banner",
  ".card",
  ".lane",
  ".bucket",
  "section",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
].join(", ");

/** With Alt held: a whole section. */
export const sectionSelector =
  "[data-ui], section, .card, .lane, nav.rail, header.top, .peek, .page";

/** Boxes that hold a whole screen; pointing at one of them points at nothing. */
const frameClasses = ["app", "main", "content", "body"];

const uiPattern = /^[a-z0-9.-]{1,120}$/;
const containers = ".gcard, .kcard, .li, tr, .card, section, .lane, .peek, nav.rail, header.top";
const labelCap = 200;
const scanCap = 400;

/** The first 60 characters of an element's text, whitespace collapsed. */
export function snip(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function visibleText(el: Element | null): string {
  const raw = el instanceof HTMLElement && el.innerText ? el.innerText : (el?.textContent ?? "");
  return raw.replace(/\s+/g, " ").trim();
}

/** True for the comment tool's own elements, which it never points at. */
export function inCmtUi(el: Element | null): boolean {
  return el?.closest("[data-cmt-ui]") != null;
}

/** The element a pointer at `el` would comment on, or null. */
export function pick(el: Element | null, wholeSection: boolean): HTMLElement | null {
  if (el === null || inCmtUi(el)) {
    return null;
  }
  const found =
    (wholeSection ? el.closest(sectionSelector) : el.closest(targetSelector)) ??
    el.closest(sectionSelector);
  if (!(found instanceof HTMLElement)) {
    return null;
  }
  const isFrame =
    found.id === "root" ||
    found === document.body ||
    found === document.documentElement ||
    frameClasses.some((name) => found.classList.contains(name));
  return isFrame ? null : found;
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The named thing an element sits in: a card's title, a row's name. */
function contextOf(el: Element): string {
  const box = el.parentElement?.closest(containers);
  if (box == null) {
    return "";
  }
  const heading = box.querySelector("h1, h2, h3, h4, .lt b, b");
  return shorten(visibleText(heading), 30);
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const full = visibleText(el);
  const short = shorten(full, 34);
  const classes = el.classList;
  const aria = el.getAttribute("aria-label") ?? "";
  if (el.getAttribute("role") === "tab") {
    return d.tab(short);
  }
  if (tag === "button" || tag === "a") {
    return d.button(aria !== "" && full === "" ? aria : short);
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return d.field((aria || (el.getAttribute("placeholder") ?? "")).slice(0, 40));
  }
  if (/^h[1-4]$/.test(tag)) {
    return d.heading(short);
  }
  if (tag === "tr") {
    return d.tableRow(short);
  }
  if (classes.contains("banner")) {
    return d.banner;
  }
  if (classes.contains("thumb")) {
    return d.thumbnail;
  }
  if (classes.contains("vid")) {
    return d.video;
  }
  if (classes.contains("meter") || classes.contains("budget")) {
    return d.bar;
  }
  if (classes.contains("steps")) {
    return d.steps;
  }
  if (classes.contains("av")) {
    return d.avatar;
  }
  if (classes.contains("tag") || classes.contains("chip")) {
    return d.tag(short);
  }
  if (classes.contains("li") || classes.contains("kcard") || classes.contains("gcard")) {
    const name = el.querySelector("b");
    const text = name === null ? short : visibleText(name);
    return classes.contains("gcard") ? d.cardNamed(text) : d.row(text);
  }
  if (classes.contains("card") || tag === "section" || classes.contains("lane")) {
    const heading = el.querySelector("h1, h2, h3, h4");
    const text = heading === null ? "" : visibleText(heading);
    if (classes.contains("lane")) {
      return d.column(text);
    }
    return text === "" ? d.card : d.cardNamed(text);
  }
  if (classes.contains("rail")) {
    return d.rail;
  }
  if (classes.contains("top")) {
    return d.top;
  }
  if (classes.contains("peek")) {
    return d.peek;
  }
  if (tag === "p") {
    return d.text(short);
  }
  return short === "" ? d.area : d.quoted(short);
}

/** What the tool calls an element: "Button “Send”", with what it sits in when that helps. */
export function labelOf(el: Element): string {
  const base = describe(el);
  const context = el.matches(containers) ? "" : contextOf(el);
  const full = context !== "" && !base.includes(context) ? d.inside(base, context) : base;
  return full.slice(0, labelCap);
}

function nthOfType(el: Element): number {
  let index = 1;
  for (let s = el.previousElementSibling; s !== null; s = s.previousElementSibling) {
    if (s.tagName === el.tagName) {
      index += 1;
    }
  }
  return index;
}

function rootEl(): Element {
  return document.getElementById("root") ?? document.body;
}

/** The `data-ui` id of the nearest element at or above `el`, if it has a usable one. */
function uiOf(el: Element): { readonly ui: string; readonly scope: Element } | null {
  const scope = el.closest("[data-ui]");
  const ui = scope?.getAttribute("data-ui") ?? null;
  return scope !== null && ui !== null && uiPattern.test(ui) ? { ui, scope } : null;
}

/** The `tag:nth-of-type(i)` chain from `scope` down to `el`; empty when they are the same. */
function pathFrom(scope: Element, el: Element): string {
  const parts: string[] = [];
  for (let at: Element | null = el; at !== null && at !== scope; at = at.parentElement) {
    parts.unshift(`${at.tagName.toLowerCase()}:nth-of-type(${String(nthOfType(at))})`);
  }
  return parts.join(" > ");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Where a comment pinned to `el` is anchored, with the click as a fraction of its box. */
export function anchorOf(el: Element, clickX: number, clickY: number): CommentAnchor {
  const found = uiOf(el);
  const rect = el.getBoundingClientRect();
  return {
    ui: found?.ui ?? null,
    path: pathFrom(found?.scope ?? rootEl(), el),
    tag: el.tagName.toLowerCase(),
    text: snip(el),
    label: labelOf(el),
    rx: rect.width > 0 ? clamp01((clickX - rect.left) / rect.width) : 0.5,
    ry: rect.height > 0 ? clamp01((clickY - rect.top) / rect.height) : 0.5,
  };
}

function walk(scope: Element, path: string): Element | null {
  let at: Element | null = scope;
  for (const part of path === "" ? [] : path.split(" > ")) {
    const match = /^([a-z0-9]+):nth-of-type\((\d+)\)$/.exec(part);
    if (match === null || at === null) {
      return null;
    }
    const tag = match[1] ?? "";
    const want = Number(match[2]);
    let seen = 0;
    let next: Element | null = null;
    for (const child of Array.from(at.children)) {
      if (child.tagName.toLowerCase() === tag) {
        seen += 1;
        if (seen === want) {
          next = child;
          break;
        }
      }
    }
    at = next;
  }
  return at;
}

/** The element a comment was pinned to now, and whether it had to fall back to its `data-ui` section. */
export interface Located {
  readonly el: Element;
  readonly moved: boolean;
}

/** Finds the anchor again: the exact path, else the same text nearby, else the section, else nothing. */
export function locate(anchor: CommentAnchor): Located | null {
  const scopes =
    anchor.ui === null
      ? [rootEl()]
      : Array.from(document.querySelectorAll(`[data-ui="${anchor.ui}"]`)).filter(
          (s) => !inCmtUi(s),
        );
  for (const scope of scopes) {
    const el = walk(scope, anchor.path);
    if (el !== null && !inCmtUi(el) && snip(el) === anchor.text) {
      return { el, moved: false };
    }
  }
  for (const scope of scopes) {
    const candidates = Array.from(scope.querySelectorAll(anchor.tag)).slice(0, scanCap);
    const el = candidates.find((c) => !inCmtUi(c) && snip(c) === anchor.text);
    if (el !== undefined) {
      return { el, moved: false };
    }
  }
  const section = anchor.ui === null ? undefined : scopes[0];
  return section === undefined ? null : { el: section, moved: true };
}
