import type { PrototypeStatus, ScenarioKey } from "@gratovo/ipc";
import type { IconName } from "@gratovo/ui";

import { strings } from "../strings";
import { toast } from "./toast";

const text = strings.prototype;

const toastKey = "gratovo.proto.toast";

export function rememberSwitch(value: string | null): void {
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

/** What a toast takes. */
export type SwitchToast = Parameters<typeof toast>[0];

/** Whether the switch remembered before the reload is what main now has open. */
function happened(value: string, status: PrototypeStatus): boolean {
  if (value === "on") {
    return status.on;
  }
  if (value === "off") {
    return !status.on;
  }
  return status.on && value === `scenario:${status.scenario}`;
}

/**
 * The toast that confirms a switch made before the reload, once; null when there is none. Main
 * reloads after a switch that failed too, so with `status` (what is open now) a switch that didn't
 * happen gets a toast that says so instead.
 */
export function takeSwitchToast(status?: PrototypeStatus | null): SwitchToast | null {
  let value: string | null;
  try {
    value = sessionStorage.getItem(toastKey);
    sessionStorage.removeItem(toastKey);
  } catch {
    return null;
  }
  if (value !== null && status !== undefined && (status === null || !happened(value, status))) {
    return { msg: text.toastFailed, sub: text.toastFailedSub, icon: "alert", tone: "info" };
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

/** Shows the switch toast, if one is waiting, checked against what main has open now. */
export function showSwitchToast(status: PrototypeStatus | null): void {
  const waiting = takeSwitchToast(status);
  if (waiting !== null) {
    toast(waiting);
  }
}
