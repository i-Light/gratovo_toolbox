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
import { useSyncExternalStore } from "react";

import { rememberSwitch } from "./prototype-toast";

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
export async function loadPrototype(invoke?: Bridge["invoke"]): Promise<PrototypeStatus | null> {
  const status = await ask("prototype:status", {}, invoke ?? bridge()?.invoke);
  if (status === null) {
    return null;
  }
  set({ status });
  if (!status.on) {
    return status;
  }
  const list = await ask("comments:list", {}, invoke ?? bridge()?.invoke);
  if (list !== null) {
    set({ comments: list.comments });
  }
  return status;
}

/** Turns prototype mode on or off. Main reloads the window; the toast follows from the reload. */
export async function setPrototype(on: boolean): Promise<void> {
  rememberSwitch(on ? "on" : "off");
  const status = await ask("prototype:set", { on });
  if (status === null) {
    rememberSwitch(null);
    return;
  }
  set({ status });
}

/** Starts a fresh example copy for the scenario. Main reloads the window. */
export async function pickScenario(scenario: ScenarioKey): Promise<void> {
  rememberSwitch(`scenario:${scenario}`);
  const status = await ask("prototype:scenario", { scenario });
  if (status === null) {
    rememberSwitch(null);
    return;
  }
  set({ status });
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

/** What a comment action answers: it worked (with its result), or it did not (off, or the call failed). */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const failed = { ok: false } as const;

/** Saves a new comment. */
export async function addComment(c: CommentNew): Promise<Outcome<Comment>> {
  if (!isPrototypeOn()) {
    return failed;
  }
  const saved = await ask("comments:add", c);
  if (saved === null) {
    return failed;
  }
  set({ comments: [...current.comments, saved] });
  return { ok: true, value: saved };
}

/** Changes a comment's text or status. */
export async function patchComment(p: CommentPatch): Promise<Outcome<Comment>> {
  if (!isPrototypeOn()) {
    return failed;
  }
  const saved = await ask("comments:update", p);
  if (saved === null) {
    return failed;
  }
  set({ comments: current.comments.map((c) => (c.id === saved.id ? saved : c)) });
  return { ok: true, value: saved };
}

/** Deletes a comment; the value is the deleted one (so an Undo can restore it), or null when there was none. */
export async function deleteComment(id: string): Promise<Outcome<Comment | null>> {
  if (!isPrototypeOn()) {
    return failed;
  }
  const result = await ask("comments:delete", { id });
  if (result === null) {
    return failed;
  }
  set({
    comments: current.comments.filter((c) => c.id !== id),
    open: current.open === id ? null : current.open,
  });
  return { ok: true, value: result.comment };
}

/** Puts a deleted comment back (Undo). */
export async function restoreComment(c: Comment): Promise<Outcome<Comment>> {
  if (!isPrototypeOn()) {
    return failed;
  }
  const saved = await ask("comments:restore", { comment: c });
  if (saved === null) {
    return failed;
  }
  const rest = current.comments.filter((x) => x.id !== saved.id);
  set({ comments: [...rest, saved].sort((a, b) => a.at - b.at) });
  return { ok: true, value: saved };
}

/** Writes the comments for Claude into the repository. Null when off or the call failed. */
export async function exportComments(): Promise<CommentsExportResult | null> {
  if (!isPrototypeOn()) {
    return null;
  }
  return ask("comments:export", {});
}
