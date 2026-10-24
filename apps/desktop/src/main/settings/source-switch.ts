import type { DataSource } from "@gratovo/core/data";

import type { Account } from "../account/account";

/**
 * Tells when the account's open data source changes (plan D12, ADR 0014's open item): the Gemini
 * bridge started from Connections works in the folder of the source it started with, so main stops
 * it on every switch.
 *
 * The account has no "source changed" callback. A source opens or closes only inside its calls
 * (`signIn`, `recheck`, `signOut`) or before it asks for a reload (`reloadWindow`: a session that
 * ended, an access check that changed the state). So the check runs after each of those, and
 * compares the open source with the one it saw last: a switch is any change of that object,
 * including one source closing and the same account's copy opening again.
 */

export interface SourceWatch {
  /** Compares the open source with the last one seen; calls `onSwitch` when it differs. */
  check: () => void;
  /** Takes the open source as seen without calling `onSwitch` (after the account's start). */
  prime: () => void;
}

export function createSourceWatch(
  source: () => DataSource | null,
  onSwitch: () => void,
): SourceWatch {
  let seen: DataSource | null = null;
  return {
    check() {
      const open = source();
      if (open !== seen) {
        seen = open;
        onSwitch();
      }
    },
    prime() {
      seen = source();
    },
  };
}

/**
 * The same account, with `check` run after every call that can open or close a source, whether the
 * call answered or threw. The account's methods are closures (no `this`), so a copy works the same.
 */
export function withSourceChecks(account: Account, check: () => void): Account {
  async function after<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      check();
    }
  }
  return {
    ...account,
    signIn: (email, password) => after(() => account.signIn(email, password)),
    recheck: () => after(() => account.recheck()),
    signOut: () => after(() => account.signOut()),
  };
}
