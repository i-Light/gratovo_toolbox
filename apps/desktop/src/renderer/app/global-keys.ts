import { createGoPrefix } from "@gratovo/core";
import { useEffect } from "react";

import { redo, setPalette, setShortcuts, undo } from "../lib/actions";
import { isTyping, keyStack, quietAnimations, useKeys } from "../lib/keys";
import { getPrefs, setPref } from "../lib/prefs";
import { firstTab, goLetters, type ScreenKey } from "../lib/routes";
import { appStore, back, forward, go, selectRoute } from "../lib/store";

const goPrefix = createGoPrefix();

/**
 * The bottom key layer, always on: Ctrl+K and `/` for the palette, `?` for the shortcut sheet,
 * Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y for undo and redo (left to the field while typing in one, so a
 * text field keeps its own undo), Alt+Left and Alt+Right for history, `[` for the rail, Ctrl+,
 * for Settings, and `g` to start "G then a letter".
 */
export function useGlobalKeys(): void {
  useKeys({
    "mod+k": () => {
      setPalette(!appStore().getState().ui.palette);
    },
    "/": () => {
      setPalette(true);
    },
    "?": () => {
      setShortcuts(true);
    },
    "mod+z": (event) => {
      if (isTyping(event.target)) {
        return false;
      }
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return true;
    },
    "mod+y": (event) => {
      if (isTyping(event.target)) {
        return false;
      }
      redo();
      return true;
    },
    "alt+arrowleft": back,
    "alt+arrowright": forward,
    "[": () => {
      setPref("rail", getPrefs().rail === "min" ? "" : "min");
    },
    "mod+,": () => {
      const route = selectRoute(appStore().getState());
      go("settings", route.screen === "settings" ? route.tab : "profile");
    },
    g: () => {
      goPrefix.arm(Date.now());
    },
  });
}

function goScreen(letter: string): ScreenKey | undefined {
  return Object.hasOwn(goLetters, letter) ? goLetters[letter] : undefined;
}

/**
 * Adds the one `keydown` listener on the document. It first lets "G then a letter" jump to a
 * screen (not while typing, while letters are off, or while a dialog holds the keys), then hands
 * the key to the key stack. A key that something took is kept from the browser and switches
 * animation off for a moment.
 */
export function useKeyListener(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = isTyping(event.target);
      const lettersOff = getPrefs().letters === "off";
      if (!typing && !lettersOff && !keyStack.hasBarrier()) {
        const letter = goPrefix.take(event, Date.now());
        const screen = letter === undefined ? undefined : goScreen(letter);
        if (screen !== undefined) {
          event.preventDefault();
          quietAnimations();
          go(screen, firstTab(screen));
          return;
        }
      }
      if (keyStack.dispatch(event, { typing, lettersOff })) {
        event.preventDefault();
        quietAnimations();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}
