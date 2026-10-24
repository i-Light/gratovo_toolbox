import type { DataSource } from "@gratovo/core/data";
import type {
  ConnectionsChange,
  ConnectionsSetResult,
  ConnectionsStatus,
  FolderPurpose,
  PickedPath,
  SyncState,
} from "@gratovo/ipc";

import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";
import type { SecretStore } from "../secret-store";
import type { ConnectionsService, GeminiControl } from "../services";

import { createGateways } from "./connections-gateways";
import { createMailboxes } from "./connections-mail";
import { applyChange } from "./connections-settings";
import { buildStatus } from "./connections-status";

export { defaultMailLabel, maxMailboxes, startSettings } from "./connections-store";

/**
 * Settings › Connections (plan D7, D11). Settings live in the open source's `local_settings`;
 * secrets live in the secret store. `status()` answers counts and flags, never a secret value.
 * Nothing here imports Electron: dialogs and jobs come in as functions.
 *
 * The parts: `connections-store` reads the rows and tokens, `connections-settings` writes one
 * change, `connections-status` builds the snapshot, `connections-mail` adds, counts and checks
 * mailboxes, and `connections-gateways` runs the gateway jobs.
 */

export interface ConnectionsDeps {
  secrets: SecretStore;
  /** The open data source, or null (signed out). */
  source(): DataSource | null;
  gemini: Pick<GeminiControl, "status">;
  pythonPath(): string | null;
  youtubeKeyAvailable(): Promise<boolean>;
  syncState(): SyncState;
  /** Where a non-search job runs: the data folder and worker id; null when no live data is open. */
  jobContext(): { dataDir: string; worker: string } | null;
  /** Runs one job on the quick lane to its end. */
  runQuickJob(start: Start): Promise<JobOutcome>;
  pickFolder(purpose: FolderPurpose): Promise<string | null>;
  pathExists(path: string): Promise<boolean>;
  emit(status: ConnectionsStatus): void;
  now?: () => number;
}

/**
 * `known` on a failure: a token for this address is still in the store (it was there before, or
 * the new one couldn't be taken back out). The consent then must not revoke the new token:
 * revoking at Google ends the account's whole grant, which kills the stored token too.
 */
export type AddMailboxResult =
  { ok: true } | { ok: false; reason: "no_data" | "too_many" | "failed"; known: boolean };

export interface ConnectionsServiceFull extends ConnectionsService {
  /** Stores a consented mailbox's token and gives it default settings. Not an IPC channel. */
  addMailbox(address: string, refreshToken: string): Promise<AddMailboxResult>;
  /**
   * How many mailboxes are connected, counted as `addMailbox` counts them (settings rows and
   * stored tokens together). Cheap: no status build, no job, no network. Not an IPC channel.
   */
  mailboxCount(): Promise<number>;
}

export function createConnectionsService(deps: ConnectionsDeps): ConnectionsServiceFull {
  const status = (): Promise<ConnectionsStatus> => buildStatus(deps, mailboxes.healthOf);
  const publish = async (): Promise<ConnectionsStatus> => {
    const fresh = await status();
    deps.emit(fresh);
    return fresh;
  };
  const mailboxes = createMailboxes(deps, publish);
  const gateways = createGateways(deps, publish);

  async function set(change: ConnectionsChange): Promise<ConnectionsSetResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    let result: ConnectionsSetResult;
    try {
      result = await applyChange(change, {
        source,
        secrets: deps.secrets,
        forgetMailbox: mailboxes.forget,
      });
    } catch {
      console.error(`Connections: saving "${change.kind}" failed.`);
      return { ok: false, reason: "failed" };
    }
    if (result.ok) {
      await publish();
    }
    return result;
  }

  return {
    status,
    set,
    async pickFolder(purpose): Promise<PickedPath> {
      return { path: await deps.pickFolder(purpose) };
    },
    checkMailboxes: mailboxes.check,
    deployGateways: gateways.deploy,
    removeGateways: gateways.remove,
    addMailbox: mailboxes.add,
    mailboxCount: mailboxes.count,
  };
}
