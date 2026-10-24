import type {
  Bridge,
  Channel,
  ChannelRequest,
  ChannelResponse,
  ConnectionsChange,
  ConnectionsStatus,
} from "@gratovo/ipc";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { flashSetting } from "../../lib/actions";
import type { RowId } from "../../lib/settings";
import { appStore, setImportState } from "../../lib/store";
import { toast } from "../../lib/toast";
import { strings } from "../../strings";

const text = strings.settings.connections;

let current: ConnectionsStatus | null = null;
/** Bumped by every status that arrives, so an older answer never replaces a newer event. */
let version = 0;
const listeners = new Set<() => void>();

function bridge(): Partial<Bridge> | undefined {
  return (globalThis as { gratovo?: Partial<Bridge> }).gratovo;
}

/** Keeps the live gate's "has the import happened" flag in step with the status (live data only). */
function followImport(status: ConnectionsStatus): void {
  if (appStore().getState().data.source !== "live") {
    return;
  }
  setImportState(status.import.state === "never" ? "never" : "imported");
}

/** Takes a status: from a read, from `connections:changed`, or with Gemini's newer state. */
export function applyConnections(next: ConnectionsStatus): void {
  current = next;
  version += 1;
  followImport(next);
  for (const listener of listeners) {
    listener();
  }
}

export function resetConnectionsForTests(): void {
  current = null;
  version = 0;
  for (const listener of listeners) {
    listener();
  }
}

/** Asks for `connections:status`. Null when it could not be read. */
export async function loadConnections(): Promise<ConnectionsStatus | null> {
  const invoke = bridge()?.invoke;
  if (invoke === undefined) {
    return null;
  }
  const asked = version;
  try {
    const result = await invoke("connections:status", {});
    if (!result.ok) {
      return null;
    }
    if (version === asked) {
      applyConnections(result.value);
    }
    return result.value;
  } catch {
    return null;
  }
}

/** One call to main. The answer, or null when the call itself failed. */
export async function ask<C extends Channel>(
  channel: C,
  input: ChannelRequest<C>,
): Promise<ChannelResponse<C> | null> {
  const invoke = bridge()?.invoke;
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

export type ConnectionsLoad = "loading" | "ready" | "failed";

/**
 * The Connections status. Reads `connections:status` when the screen opens, then follows
 * `connections:changed` and `gemini:state`. `reload` asks again after a failure.
 */
export function useConnections(): {
  readonly status: ConnectionsStatus | null;
  readonly load: ConnectionsLoad;
  readonly reload: () => void;
} {
  const status = useSyncExternalStore(subscribe, () => current);
  const [load, setLoad] = useState<ConnectionsLoad>(current === null ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    const on = bridge()?.on;
    const offs: (() => void)[] = [];
    if (on !== undefined) {
      offs.push(
        on("connections:changed", (next) => {
          if (!stopped) {
            applyConnections(next);
          }
        }),
        on("gemini:state", (gemini) => {
          if (!stopped && current !== null) {
            applyConnections({ ...current, gemini });
          }
        }),
      );
    }
    void loadConnections().then((loaded) => {
      if (!stopped) {
        setLoad(loaded === null && current === null ? "failed" : "ready");
      }
    });
    return () => {
      stopped = true;
      for (const off of offs) {
        off();
      }
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setLoad("loading");
    setAttempt((n) => n + 1);
  }, []);
  return { status, load, reload };
}

/** The toast for a refused or failed change: what happened, in plain words. */
export function failToast(msg: string, sub: string): void {
  toast({ msg, sub, icon: "alert" });
}

/**
 * Saves one change with `connections:set`. A saved change shows "Saved" on its row and a toast, then
 * reads the status again; a refused one shows the reason in words. True when it was saved.
 */
export async function saveChange(
  change: ConnectionsChange,
  options: { readonly row: RowId; readonly msg?: string; readonly sub?: string },
): Promise<boolean> {
  const answer = await ask("connections:set", change);
  if (answer === null) {
    failToast(text.notSaved, text.setReasons.failed);
    return false;
  }
  if (!answer.ok) {
    failToast(text.notSaved, text.setReasons[answer.reason]);
    return false;
  }
  flashSetting(options.row);
  toast({
    msg: options.msg ?? text.saved,
    sub: options.sub ?? text.savedSub,
    icon: "check",
    tone: "good",
  });
  void loadConnections();
  return true;
}
