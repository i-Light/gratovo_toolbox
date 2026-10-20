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

type Invoke = (channel: "auth:sign-out", input: Record<string, never>) => Promise<unknown>;

/**
 * Signs out: lets pending changes reach the database first (up to 5 s), then asks main, which deletes
 * the local copy and reloads the window. The page starts again from `auth:status`.
 */
export async function signOut(invoke?: Invoke): Promise<void> {
  await settled(signOutWaitMs);
  await (invoke ?? window.gratovo.invoke)("auth:sign-out", {});
}
