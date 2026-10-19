import type { IconName } from "@gratovo/ui";

import { appStore } from "./store";
import type { Toast, ToastAction } from "./store";

// Apart from actions.ts so the persister can show a toast without importing actions.ts, which
// imports the persister (the save state waits for it). actions.ts re-exports both functions.

/** How long a toast stays when it does not say, in milliseconds. */
const defaultToastMs = 6500;
/** How many toasts show at once; the oldest go first. */
const maxToasts = 3;

let toastCounter = 0;

/** Shows a toast. Defaults: tone info, ms 6500 (also when ms is 0). Keeps the newest three. Returns its id. */
export function toast(t: {
  readonly msg: string;
  readonly sub?: string;
  readonly icon?: IconName;
  readonly tone?: "good" | "info";
  readonly ms?: number;
  readonly actions?: readonly ToastAction[];
}): string {
  const tone = t.tone ?? "info";
  toastCounter += 1;
  const made: Toast = {
    id: `t${String(toastCounter)}`,
    msg: t.msg,
    ...(t.sub === undefined ? {} : { sub: t.sub }),
    icon: t.icon ?? (tone === "good" ? "check" : "info"),
    tone,
    ms: t.ms === undefined || t.ms === 0 ? defaultToastMs : t.ms,
    actions: t.actions ?? [],
  };
  appStore().ui((ui) => {
    ui.toasts = [...ui.toasts, made].slice(-maxToasts) as typeof ui.toasts; // immer drafts drop `readonly` on arrays
  });
  return made.id;
}

/** Removes a toast. */
export function dismissToast(id: string): void {
  appStore().ui((ui) => {
    ui.toasts = ui.toasts.filter((t) => t.id !== id);
  });
}
