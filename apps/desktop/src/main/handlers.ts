import type { DataSource, DataWrite } from "@gratovo/core/data";
import type { Handlers } from "@gratovo/ipc";

import type { Account } from "./account/account";
import type { FindCatalog } from "./find/catalog-types";
import type { FindService } from "./find/find-service";
import type { SecretStore } from "./secret-store";
import type { HandlerServices } from "./services";

/**
 * What the handlers need from the rest of the main process. The step 4 services (`importer`,
 * `connections`, `gemini`, `writingRules`, `mailConsent`) are typed in `services.ts`; their
 * handlers only delegate.
 */
export interface HandlerContext extends HandlerServices {
  version: string;
  secrets: SecretStore;
  find: FindService;
  /** The Find catalog: pages, one channel's detail and the run history. */
  catalog: FindCatalog;
  /**
   * Called after a stored `data:write` batch that changes what the catalog shows: a creator's
   * stage, a log line about a creator, or a settled conflict (plan D1). The catalog rebuilds on it.
   */
  onCreatorsWritten?: () => void;
  account: Pick<
    Account,
    | "status"
    | "source"
    | "signIn"
    | "recheck"
    | "signOut"
    | "syncStatus"
    | "syncNow"
    | "setPresence"
  >;
}

/**
 * Whether one write can change a catalog row: a stage, a log line on a creator (add) or any
 * removal, or a conflict settled (keeping yours puts your stage back).
 */
function changesCatalog(write: DataWrite): boolean {
  return (
    write.kind === "creator.stage" ||
    write.kind === "conflict.resolve" ||
    (write.kind === "log.add" && write.ref !== null) ||
    write.kind === "log.remove"
  );
}

/** The main process's answer to each channel in `channels`. */
export function createHandlers(context: HandlerContext): Handlers {
  const { version, secrets, account, find, catalog } = context;
  const { importer, connections, gemini, writingRules, mailConsent } = context;

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
      if (writes.some(changesCatalog)) {
        context.onCreatorsWritten?.();
      }
      return {};
    },
    "auth:status": () => account.status(),
    // The password goes to the account once and is neither kept nor logged here.
    "auth:sign-in": ({ email, password }) => account.signIn(email, password),
    "auth:recheck": () => account.recheck(),
    "auth:sign-out": async () => {
      // A running search ends first: its data folder is the signed-in account's.
      await find.shutdown();
      await account.signOut();
      return {};
    },
    // Counts and a state only: no row data, no token.
    "sync:status": () => account.syncStatus(),
    "sync:now": () => account.syncNow(),
    // A screen name and a flag only (D26); the account ignores it unless signed in.
    "presence:set": ({ screen, idle }) => {
      account.setPresence({ screen, idle });
      return {};
    },
    "find:state": () => find.state(),
    "find:add": ({ keywords }) => find.add(keywords),
    "find:remove": ({ index }) => find.remove(index),
    "find:start-at": ({ index }) => find.startAt(index),
    "find:start": () => find.start(),
    "find:stop": () => {
      find.stop();
      return {};
    },
    "find:query": (request) => catalog.query(request),
    "find:item": ({ id }) => catalog.item(id),
    "find:runs": () => catalog.runs(),
    "rules:set": ({ rules }) => {
      find.setRules(rules);
      return {};
    },
    "import:candidates": () => importer.candidates(),
    "import:pick": () => importer.pick(),
    "import:dry-run": ({ path }) => importer.dryRun(path),
    "import:run": ({ path, useOldRules }) => importer.run(path, useOldRules),
    "writing:rules": () => writingRules.list(),
    "connections:status": () => connections.status(),
    // The change may carry a secret: it goes to the service and is neither kept nor logged here.
    "connections:set": (change) => connections.set(change),
    "connections:pick-folder": ({ purpose }) => connections.pickFolder(purpose),
    "mail:connect": () => mailConsent.connect(),
    "mail:check": () => connections.checkMailboxes(),
    "gateways:deploy": ({ regions }) => connections.deployGateways(regions),
    "gateways:remove": ({ region }) => connections.removeGateways(region),
    "gemini:start": () => gemini.start(),
    "gemini:stop": () => gemini.stop(),
    "gemini:open-window": ({ browser }) => gemini.openWindow(browser),
  };
}
