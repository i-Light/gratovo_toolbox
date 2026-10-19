import type { ReactNode } from "react";
import { createPortal } from "react-dom";

let root: HTMLDivElement | null = null;
/** The open modal dialogs, oldest first; the container sits in the last one. */
const hosts: HTMLElement[] = [];
const moveListeners = new Set<() => void>();

/** Where the container belongs now: the newest open modal, or the page. */
function currentHost(): HTMLElement {
  return hosts.at(-1) ?? document.body;
}

/** The one container toasts, menus and the tooltip render into. Made on first use. */
function floatingRoot(): HTMLDivElement {
  if (root === null) {
    root = document.createElement("div");
    root.style.display = "contents";
  }
  if (!root.isConnected) {
    currentHost().append(root);
  }
  return root;
}

/** Puts the container where it belongs now and tells the listeners it moved. */
function moveFloating(): void {
  currentHost().append(floatingRoot());
  for (const listener of moveListeners) {
    listener();
  }
}

/**
 * Moves the floating container into a modal dialog that just opened, until the returned function
 * is called. A modal `<dialog>` sits in the browser's top layer, above every z-index, and makes the
 * rest of the page inert; the prototype drew toasts, menus and tooltips above its dialogs, so they
 * must live inside the newest one. Moving the container keeps the React tree as it is (no remount,
 * so a toast keeps its time), but the browser restarts CSS animations in it: see
 * {@link onFloatingMoved}.
 */
export function hostFloating(dialog: HTMLElement): () => void {
  hosts.push(dialog);
  moveFloating();
  return () => {
    const i = hosts.lastIndexOf(dialog);
    if (i !== -1) {
      hosts.splice(i, 1);
    }
    moveFloating();
  };
}

/**
 * Calls `listener` right after each move of the floating container, before the page is drawn
 * again. Moving an element restarts its CSS animations, so content that is part-way through one
 * (a toast's life bar) sets it back to where it was. Returns the function that stops the calls.
 */
export function onFloatingMoved(listener: () => void): () => void {
  moveListeners.add(listener);
  return () => {
    moveListeners.delete(listener);
  };
}

/** Renders its children above everything, modal dialogs included (see {@link hostFloating}). */
export function Floating({ children }: { readonly children: ReactNode }) {
  return createPortal(children, floatingRoot());
}
