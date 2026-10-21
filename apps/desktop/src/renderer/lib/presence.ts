import type { PresenceScreen } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";

import { appStore, selectRoute, subscribeApp } from "./store";

/** No click or key for this long counts as idle (milliseconds). */
export const idleAfterMs = 5 * 60 * 1000;

/**
 * Tells main which screen the person is on and whether they are idle (no click or key for five
 * minutes, or the window hidden). It sends once at the start and then only when one of the two
 * changes. Returns a function that stops it.
 */
export function installPresenceReporting(invoke: Bridge["invoke"]): () => void {
  let sentScreen: PresenceScreen | null = null;
  let sentIdle: boolean | null = null;
  let quiet = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const report = (): void => {
    const screen = selectRoute(appStore().getState()).screen;
    const idle = quiet || document.visibilityState === "hidden";
    if (screen === sentScreen && idle === sentIdle) {
      return;
    }
    sentScreen = screen;
    sentIdle = idle;
    invoke("presence:set", { screen, idle }).then(
      (result) => {
        if (!result.ok) {
          console.error("The page couldn't tell main where it is:", result.reason);
        }
      },
      (reason: unknown) => {
        console.error("The page couldn't tell main where it is:", reason);
      },
    );
  };

  const arm = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      quiet = true;
      report();
    }, idleAfterMs);
  };

  const onInput = (): void => {
    arm();
    if (quiet) {
      quiet = false;
      report();
    }
  };

  arm();
  report();
  const unsubscribe = subscribeApp(report);
  document.addEventListener("pointerdown", onInput, true);
  document.addEventListener("keydown", onInput, true);
  document.addEventListener("visibilitychange", report);

  return () => {
    unsubscribe();
    document.removeEventListener("pointerdown", onInput, true);
    document.removeEventListener("keydown", onInput, true);
    document.removeEventListener("visibilitychange", report);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
