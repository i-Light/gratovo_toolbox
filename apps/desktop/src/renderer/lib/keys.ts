import { createKeyStack } from "@gratovo/core";
import type { KeyMap, KeyStack } from "@gratovo/core";
import { useEffect, useLayoutEffect, useRef } from "react";

/** The app's one key stack: every layer of keyboard handling sits on it. */
export const keyStack: KeyStack<KeyboardEvent> = createKeyStack<KeyboardEvent>();

/**
 * Adds a layer of key handlers while the component is mounted (and `active` is not false).
 * The layer always runs the newest map passed in, so handlers can read current props.
 * A barrier layer stops keys it doesn't handle from reaching layers below it.
 */
export function useKeys(
  keys: KeyMap<KeyboardEvent>,
  options: { readonly active?: boolean; readonly barrier?: boolean } = {},
): void {
  const { active = true, barrier = false } = options;
  const latest = useRef(keys);
  useLayoutEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    return keyStack.push({ keys: () => latest.current, barrier });
  }, [active, barrier]);
}

/** True when the target is a field the user types in, so plain keys must not fire shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.contentEditable === "true"
  );
}

const quietMs = 400;
let quietTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Marks the page as keyboard-driven for a moment (`data-input="kbd"` on the root element), which
 * switches animation off so a key press never waits for a transition. Each call restarts the timer.
 */
export function quietAnimations(): void {
  const root = document.documentElement;
  root.dataset["input"] = "kbd";
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    delete root.dataset["input"];
  }, quietMs);
}
