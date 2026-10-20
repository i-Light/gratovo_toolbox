import type { DataSource } from "@gratovo/core/data";
import type { Handlers } from "@gratovo/ipc";

import type { Account } from "./account/account";
import type { SecretStore } from "./secret-store";

/** What the handlers need from the rest of the main process. */
export interface HandlerContext {
  version: string;
  secrets: SecretStore;
  account: Pick<Account, "status" | "source" | "signIn" | "recheck" | "signOut">;
}

/** The main process's answer to each channel in `channels`. */
export function createHandlers({ version, secrets, account }: HandlerContext): Handlers {
  /** The account's open source. The page never asks for data while none is open. */
  function openSource(): DataSource {
    const source = account.source();
    if (source === null) {
      throw new Error("No data is open: the account is signed out or waiting for access.");
    }
    return source;
  }

  return {
    "app:ping": () => ({ ok: true, version }),
    "secrets:status": async ({ name }) => ({ set: await secrets.has(name) }),
    "frame:load": () => openSource().frame(),
    // A rejection goes up to the dispatcher, which logs it; the page learns only that it failed.
    "data:write": async ({ writes }) => {
      await openSource().write(writes);
      return {};
    },
    "auth:status": () => account.status(),
    // The password goes to the account once and is neither kept nor logged here.
    "auth:sign-in": ({ email, password }) => account.signIn(email, password),
    "auth:recheck": () => account.recheck(),
    "auth:sign-out": async () => {
      await account.signOut();
      return {};
    },
  };
}
