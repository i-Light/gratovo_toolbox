/** The parts of a keyboard event the key system reads. A DOM KeyboardEvent has them all. */
export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * "mod+k", "alt+arrowleft", "escape", "?", "[", "space", "shift+tab". Lower case. "mod" is Ctrl or
 * Meta. Shift is named only for keys longer than one character, so Shift+/ is "?" and Shift+G is "g".
 */
export function keyName(input: KeyInput): string {
  let name = input.key.toLowerCase();
  if (name === " ") {
    name = "space";
  }
  let prefix = "";
  if (input.ctrlKey || input.metaKey) {
    prefix += "mod+";
  }
  if (input.altKey) {
    prefix += "alt+";
  }
  if (input.shiftKey && name.length > 1) {
    prefix += "shift+";
  }
  return prefix + name;
}

/** Return false to let the key fall through to the layer below. */
// `void` lets a handler that returns nothing count as handled; only an explicit false falls through.
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type KeyHandler<E extends KeyInput = KeyInput> = (input: E) => boolean | void;
export type KeyMap<E extends KeyInput = KeyInput> = Readonly<Record<string, KeyHandler<E>>>;
export interface KeyLayer<E extends KeyInput = KeyInput> {
  /** Read at dispatch time, so a layer always runs its newest handlers. */
  readonly keys: () => KeyMap<E>;
  /** A barrier (a dialog, a menu) stops keys it doesn't handle from reaching the layers below it. */
  readonly barrier: boolean;
}
export interface KeyContext {
  readonly typing: boolean; // the key was pressed in a text field, select or editable element
  readonly lettersOff: boolean; // Settings > Keyboard turned single-character keys off
}
export interface KeyStack<E extends KeyInput = KeyInput> {
  /** Adds a layer on top. Returns a function that removes exactly that layer. */
  push(layer: KeyLayer<E>): () => void;
  hasBarrier(): boolean;
  /**
   * Runs the newest layer's handler for the key. True when a handler took it (the caller then prevents
   * the default and quiets animation). False, and nothing runs, when: the event was already handled
   * (defaultPrevented); it is a plain key (no mod or alt; not escape; not F1 to F24) while typing; or
   * letters are off and the name is one character. Walks layers newest first; a handler that returns
   * false falls through; a barrier layer that didn't take the key stops the walk. Map lookups use
   * own properties only (Object.hasOwn).
   */
  dispatch(input: E, context: KeyContext): boolean;
}

const functionKey = /^f\d{1,2}$/;

/** A plain key is one a text field needs for itself: no Ctrl, Meta or Alt, and not Escape or an F-key. */
function isPlainKey(name: string): boolean {
  return (
    !name.startsWith("mod+") &&
    !name.startsWith("alt+") &&
    name !== "escape" &&
    !functionKey.test(name)
  );
}

/**
 * Makes the stack of key layers. Screens, dialogs and menus each push a layer; the newest layer gets
 * the key first. Ported from the prototype's `keyStack` and `W.dispatchKey` (core.js).
 */
export function createKeyStack<E extends KeyInput = KeyInput>(): KeyStack<E> {
  let layers: KeyLayer<E>[] = [];

  return {
    push(layer) {
      layers.push(layer);
      return () => {
        layers = layers.filter((l) => l !== layer);
      };
    },

    hasBarrier: () => layers.some((layer) => layer.barrier),

    dispatch(input, context) {
      if (input.defaultPrevented === true) {
        return false;
      }
      const name = keyName(input);
      if (context.typing && isPlainKey(name)) {
        return false;
      }
      if (context.lettersOff && name.length === 1) {
        return false;
      }
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        if (layer === undefined) {
          continue;
        }
        const map = layer.keys();
        if (Object.hasOwn(map, name)) {
          const handler = map[name];
          if (handler !== undefined && handler(input) !== false) {
            return true;
          }
        }
        if (layer.barrier) {
          return false;
        }
      }
      return false;
    },
  };
}

/** "G then a letter": the G handler arms it; the next key within the timeout is the letter. */
export interface GoPrefix {
  arm(now: number): void;
  /**
   * When armed, within the timeout, and no Ctrl, Meta or Alt is held: disarms and returns the key in
   * lower case (the caller looks it up and, if it's not a screen letter, dispatches the key as usual).
   * Otherwise returns undefined and leaves the state as it was (an expired arm is cleared).
   */
  take(input: KeyInput, now: number): string | undefined;
}

/** Makes the "G then a letter" helper. The timeout is how long the second key may take. */
export function createGoPrefix(timeoutMs = 1200): GoPrefix {
  let armedAt: number | undefined;

  return {
    arm(now) {
      armedAt = now;
    },

    take(input, now) {
      if (armedAt === undefined) {
        return undefined;
      }
      if (now - armedAt > timeoutMs) {
        armedAt = undefined;
        return undefined;
      }
      if (input.ctrlKey || input.metaKey || input.altKey) {
        return undefined;
      }
      armedAt = undefined;
      return input.key.toLowerCase();
    },
  };
}
