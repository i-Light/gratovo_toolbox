import type { DataSource } from "@gratovo/core/data";
import type { Handlers } from "@gratovo/ipc";

import type { SecretStore } from "./secret-store";

/** What the handlers need from the rest of the main process. */
export interface HandlerContext {
  version: string;
  secrets: SecretStore;
  data: DataSource;
}

/** The main process's answer to each channel in `channels`. */
export function createHandlers({ version, secrets, data }: HandlerContext): Handlers {
  return {
    "app:ping": () => ({ ok: true, version }),
    "secrets:status": async ({ name }) => ({ set: await secrets.has(name) }),
    "frame:load": () => data.frame(),
    // A rejection goes up to the dispatcher, which logs it; the page learns only that it failed.
    "data:write": async ({ writes }) => {
      await data.write(writes);
      return {};
    },
  };
}
