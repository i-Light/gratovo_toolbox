import type { Bridge } from "@gratovo/ipc/bridge";
import { useSyncExternalStore } from "react";

import { onPersistenceIdle } from "./persist";

/** Who is signed in, as the page knows it. `email` is null when there is no account (example data). */
export interface AccountView {
  readonly signedIn: boolean;
  readonly email: string | null;
}

const none: AccountView = { signedIn: false, email: null };
let view: AccountView = none;
const listeners = new Set<() => void>();

/** Set at start from `auth:status`; "Sign out" shows only when `signedIn`. */
export function setAccountView(next: AccountView): void {
  view = next;
  for (const listener of listeners) {
    listener();
  }
}

export function resetAccountViewForTests(): void {
  setAccountView(none);
  leaving = false;
}

let leaving = false;

/** True once the page has asked main to sign out: main is closing the copy and will reload the window. */
export function signingOut(): boolean {
  return leaving;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAccount(): AccountView {
  return useSyncExternalStore(subscribe, () => view);
}

/** How long sign-out waits for pending changes to reach the database. */
export const signOutWaitMs = 5000;

function settled(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    onPersistenceIdle(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

type Invoke = Bridge["invoke"];

/** How long sign-out waits for the last sync before going ahead. */
export const lastSyncWaitMs = 5000;

/**
 * Signs out: lets pending changes reach the database first (up to 5 s), asks main for one last sync
 * (up to 5 s; its answer and errors are ignored: unsent changes are kept either way), then asks main to sign out,
 * which clears the local copy and reloads the window. The page starts again from `auth:status`.
 */
export async function signOut(invoke?: Invoke): Promise<void> {
  await settled(signOutWaitMs);
  const call = invoke ?? window.gratovo.invoke;
  // At most a few seconds: a pass can be deep in a long pull, and main's sign-out gives the outbox
  // its own 5 s anyway. A failed or slow last sync must not stop the sign-out.
  await Promise.race([
    call("sync:now", {}).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, lastSyncWaitMs)),
  ]);
  // From here main closes the copy, so a read already on its way may fail. Main reloads the window
  // after a sign-out; a refused one clears the mark and the page carries on. (With no account, main
  // answers without a reload, but the page offers Sign out only to a signed-in account.)
  leaving = true;
  let ok = false;
  try {
    ok = (await call("auth:sign-out", {})).ok;
  } finally {
    if (!ok) {
      leaving = false;
    }
  }
}
