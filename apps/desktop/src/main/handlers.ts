import type { Handlers } from "@gratovo/ipc";

import type { SecretStore } from "./secret-store";

/** What the handlers need from the rest of the main process. */
export interface HandlerContext {
  version: string;
  secrets: SecretStore;
}

/** The main process's answer to each channel in `channels`. */
export function createHandlers({ version, secrets }: HandlerContext): Handlers {
  return {
    "app:ping": () => ({ ok: true, version }),
    "secrets:status": async ({ name }) => ({ set: await secrets.has(name) }),
  };
}
