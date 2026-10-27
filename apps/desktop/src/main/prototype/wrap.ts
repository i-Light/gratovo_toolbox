import type { DataSource } from "@gratovo/core/data";

import type { Account, FindContext } from "../account/account";

import { kindOf } from "./kind-of";
import { prototypeFolder, type Prototype } from "./prototype";

/**
 * The account as the rest of the main process sees it while prototype mode may be on (plan D2,
 * D3). While on, the open source is the prototype's example copy and Find works in its own
 * folder, as example data: every `mode === "example"` stand-in applies. Presence is not sent.
 * Everything else is the real account's.
 *
 * The base source going away while on (a sign-out, access lost) turns prototype mode off: the
 * person it was for is gone. The base's values are answered meanwhile, so nothing reads the copy
 * of someone signed out.
 */

/** Find's context while on: example data, in the prototype's own pipeline folder. */
export const prototypeContext: FindContext = {
  mode: "example",
  workerId: "prototype",
  folder: prototypeFolder,
};

export function withPrototype(account: Account, proto: Prototype): Account {
  // One turn-off at a time: every read in the meantime would otherwise ask again.
  let turningOff = false;

  function turnOff(): void {
    if (turningOff) {
      return;
    }
    turningOff = true;
    proto
      .set(false)
      .catch((error: unknown) => {
        console.warn(
          `Prototype mode couldn't turn off after the account closed (${kindOf(error)}).`,
        );
      })
      .finally(() => {
        turningOff = false;
      });
  }

  /** Whether the prototype copy is what shows: on, with the base account still open. */
  function showing(): boolean {
    if (!proto.isOn()) {
      return false;
    }
    if (account.source() === null) {
      turnOff();
      return false;
    }
    return true;
  }

  // Written member by member, typed `Account`, with no spread: a member added to `Account` later
  // fails the typecheck here until it is delegated (or overridden) on purpose.
  const wrapped: Account = {
    status: () => account.status(),
    source(): DataSource | null {
      return showing() ? proto.source() : account.source();
    },
    signIn: (email, password) => account.signIn(email, password),
    recheck: () => account.recheck(),
    signOut: () => account.signOut(),
    syncStatus: () => account.syncStatus(),
    syncNow: () => account.syncNow(),
    setPresence(p) {
      // The owner is looking at made-up data: the team would see screens nobody is on.
      if (proto.isOn()) {
        return;
      }
      account.setPresence(p);
    },
    start: () => account.start(),
    close: () => {
      account.close();
    },
    teamKeys: account.teamKeys,
    findContext(): FindContext | null {
      const base = account.findContext();
      return base !== null && showing() ? prototypeContext : base;
    },
  };
  return wrapped;
}
