import type {
  Bridge,
  Channel,
  ChannelRequest,
  ChannelResponse,
  Comment,
  CommentNew,
  CommentPatch,
  CommentsExportResult,
  PrototypeStatus,
  ScenarioKey,
} from "@gratovo/ipc";
import type { IconName } from "@gratovo/ui";
import { useSyncExternalStore } from "react";

import { strings } from "../strings";
import { screens } from "./routes";
import type { ScreenKey } from "./routes";
import { toast } from "./toast";

const text = strings.prototype;

/**
 * The page's side of prototype mode (plan step 7, D11): whether it is on, the scenario, and the
 * comments. Main owns the truth; this is what the page last heard. Nothing here calls main for
 * comments unless prototype mode is on, so off leaves no trace.
 */
export interface PrototypeState {
  /** Null until `prototype:status` answers (and when it could not). */
  readonly status: PrototypeStatus | null;
  /** Comment mode: point, click, write. */
  readonly commenting: boolean;
  /** The list of all comments is open. */
  readonly panel: boolean;
  /** The id of the comment open in its card. */
  readonly open: string | null;
  /** Show pins when not commenting. */
  readonly pins: boolean;
  /** Show done comments too. */
  readonly showDone: boolean;
  readonly comments: readonly Comment[];
}

const initial: PrototypeState = {
  status: null,
  commenting: false,
  panel: false,
  open: null,
  pins: true,
  showDone: false,
  comments: [],
};

let current: PrototypeState = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<PrototypeState>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

function bridge(): Partial<Bridge> | undefined {
  return (globalThis as { gratovo?: Partial<Bridge> }).gratovo;
}

/** One call to main. The answer, or null when the call itself failed. */
async function ask<C extends Channel>(
  channel: C,
  input: ChannelRequest<C>,
  invoke: Bridge["invoke"] | undefined = bridge()?.invoke,
): Promise<ChannelResponse<C> | null> {
  if (invoke === undefined) {
    return null;
  }
  try {
    const result = await invoke(channel, input);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The store's state; re-renders the component when it changes. */
export function usePrototype(): PrototypeState {
  return useSyncExternalStore(subscribe, () => current);
}

/** The state now, for code outside a component. */
export function getPrototype(): PrototypeState {
  return current;
}

/** Whether prototype mode is on, as main last said. */
export function isPrototypeOn(): boolean {
  return current.status?.on === true;
}

/** Whether the Prototype section may be shown: main's answer, hidden until it is known. */
export function isPrototypeAvailable(): boolean {
  return current.status?.available === true;
}

export function resetPrototypeForTests(): void {
  current = initial;
  for (const listener of listeners) {
    listener();
  }
}

/** Asks main for the status once; when prototype mode is on, reads the comments too. */
export async function loadPrototype(invoke?: Bridge["invoke"]): Promise<void> {
  const status = await ask("prototype:status", {}, invoke ?? bridge()?.invoke);
  if (status === null) {
    return;
  }
  set({ status });
  if (!status.on) {
    return;
  }
  const list = await ask("comments:list", {}, invoke ?? bridge()?.invoke);
  if (list !== null) {
    set({ comments: list.comments });
  }
}

const toastKey = "gratovo.proto.toast";

function remember(value: string | null): void {
  try {
    if (value === null) {
      sessionStorage.removeItem(toastKey);
    } else {
      sessionStorage.setItem(toastKey, value);
    }
  } catch {
    // Without session storage the confirming toast is skipped; the switch itself still works.
  }
}

/** Turns prototype mode on or off. Main reloads the window; the toast follows from the reload. */
export async function setPrototype(on: boolean): Promise<void> {
  remember(on ? "on" : "off");
  const status = await ask("prototype:set", { on });
  if (status === null) {
    remember(null);
    return;
  }
  set({ status });
}

/** Starts a fresh example copy for the scenario. Main reloads the window. */
export async function pickScenario(scenario: ScenarioKey): Promise<void> {
  remember(`scenario:${scenario}`);
  const status = await ask("prototype:scenario", { scenario });
  if (status === null) {
    remember(null);
    return;
  }
  set({ status });
}

/** What a toast takes. */
export type SwitchToast = Parameters<typeof toast>[0];

/** The toast that confirms a switch made before the reload, once; null when there is none. */
export function takeSwitchToast(): SwitchToast | null {
  let value: string | null;
  try {
    value = sessionStorage.getItem(toastKey);
    sessionStorage.removeItem(toastKey);
  } catch {
    return null;
  }
  if (value === "on") {
    return { msg: text.toastOn, sub: text.toastOnSub, icon: "flask", tone: "info" };
  }
  if (value === "off") {
    return { msg: text.toastOff, sub: text.toastOffSub, icon: "check", tone: "info" };
  }
  if (value !== null && value.startsWith("scenario:")) {
    const key = value.slice("scenario:".length);
    if (Object.hasOwn(text.scenarios, key)) {
      const scenario = text.scenarios[key as ScenarioKey];
      return {
        msg: text.toastScenario(scenario.name),
        sub: text.toastScenarioSub,
        icon: scenario.icon as IconName,
        tone: "info",
        ms: 4500,
      };
    }
  }
  return null;
}

/** Shows the switch toast, if one is waiting. */
export function showSwitchToast(): void {
  const waiting = takeSwitchToast();
  if (waiting !== null) {
    toast(waiting);
  }
}

export function toggleCommenting(force?: boolean): void {
  if (!isPrototypeOn()) {
    return;
  }
  set({ commenting: force ?? !current.commenting, open: null });
}

export function setPanel(panel: boolean): void {
  if (isPrototypeOn()) {
    set({ panel });
  }
}

export function setOpen(open: string | null): void {
  if (isPrototypeOn()) {
    set({ open });
  }
}

export function setPins(pins: boolean): void {
  set({ pins });
}

export function setShowDone(showDone: boolean): void {
  set({ showDone });
}

/** The number of comments not yet done. */
export function openCount(list: readonly Comment[]): number {
  return list.filter((c) => c.status !== "done").length;
}

/** Saves a new comment. The saved comment, or null when off or the call failed. */
export async function addComment(c: CommentNew): Promise<Comment | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  const saved = await ask("comments:add", c);
  if (saved !== null) {
    set({ comments: [...current.comments, saved] });
  }
  return saved;
}

/** Changes a comment's text or status. */
export async function patchComment(p: CommentPatch): Promise<Comment | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  const saved = await ask("comments:update", p);
  if (saved !== null) {
    set({ comments: current.comments.map((c) => (c.id === saved.id ? saved : c)) });
  }
  return saved;
}

/** Deletes a comment; answers the deleted one so an Undo can restore it. */
export async function deleteComment(id: string): Promise<Comment | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  const result = await ask("comments:delete", { id });
  if (result === null) {
    return null;
  }
  set({
    comments: current.comments.filter((c) => c.id !== id),
    open: current.open === id ? null : current.open,
  });
  return result.comment;
}

/** Puts a deleted comment back (Undo). */
export async function restoreComment(c: Comment): Promise<Comment | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  const saved = await ask("comments:restore", { comment: c });
  if (saved !== null) {
    const rest = current.comments.filter((x) => x.id !== saved.id);
    set({ comments: [...rest, saved].sort((a, b) => a.at - b.at) });
  }
  return saved;
}

/** Writes the comments for Claude into the repository. Null when off or the call failed. */
export async function exportComments(): Promise<CommentsExportResult | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  return ask("comments:export", {});
}

type RefName = (ref: { readonly kind: string; readonly id: string }) => string | null;

/** Where a comment was left, as words: "Find › Review new › Maya Chen", or "Everywhere · Back". */
function whereText(c: Comment, refName: RefName): string {
  if (c.place.global) {
    return text.forClaude.everywhere;
  }
  const screen = c.place.screen;
  const info =
    screen !== null && Object.hasOwn(screens, screen) ? screens[screen as ScreenKey] : undefined;
  const tab =
    info !== undefined && c.place.tab !== null
      ? (info.tabs.find((t) => t.key === c.place.tab)?.name ?? c.place.tab)
      : null;
  const bits = [info?.name ?? screen ?? ""]
    .concat(tab === null ? [] : [tab])
    .concat(c.place.record === null ? [] : [refName(c.place.record) ?? text.forClaude.aRecord])
    .concat(c.place.peek === null ? [] : [refName(c.place.peek) ?? text.forClaude.aRecord]);
  return bits.filter((b) => b !== "").join(" › ");
}

/**
 * The open comments as text for Claude: a heading, then each comment numbered by its place in the
 * whole list, with its kind, where it was left, what it was pinned to and what it says.
 */
export function commentsForClaude(
  list: readonly Comment[],
  options: { readonly now?: number; readonly refName?: RefName } = {},
): string {
  const when = new Date(options.now ?? Date.now());
  const stamp = `${when.toLocaleDateString("en-GB")} ${when.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  const refName = options.refName ?? (() => null);
  const open = list.filter((c) => c.status !== "done");
  const lines = [text.forClaude.head(open.length, stamp), ""];
  for (const c of open) {
    const number = list.indexOf(c) + 1;
    const scenario =
      c.scenario === "normal" ? "" : text.forClaude.scenario(text.scenarios[c.scenario].name);
    lines.push(
      `${String(number)}. [${text.forClaude.kinds[c.kind]}] ${whereText(c, refName)} · ${c.anchor.label}${scenario}`,
    );
    lines.push(`   ${c.text.replace(/\n/g, "\n   ")}`);
  }
  return lines.join("\n");
}
