import type { DataWrite, Frame, RewriteHow } from "@gratovo/core/data";
import type {
  ChannelResponse,
  ConnectionsChange,
  ConnectionsSetResult,
  ConnectionsStatus,
  FolderPurpose,
  GatewaysDeployResult,
  GatewaysRemoveResult,
  GeminiStatus,
  ImportCandidates,
  ImportResult,
  MailCheckResult,
  MailConnectResult,
  PickedPath,
  WritingRules,
} from "@gratovo/ipc";

/**
 * The step 4 services the IPC handlers delegate to (plan step 4, "Contracts"). Each method answers
 * one channel, with that channel's response type, so a service can be built and tested on its own
 * and `handlers.ts` never changes for it. Until a service is built, `stub-services.ts` answers
 * "not built yet" in its place.
 *
 * Expected failures are values (`{ok: false, reason}`); a throw is unexpected, and the dispatcher
 * logs it and tells the page only that the call failed. No method returns a secret's value.
 */

/** Importing the old app's `gratovo.db` (D2 to D6). Owned by `main/import/` (task B4). */
export interface ImporterService {
  /** The old databases found on this computer, newest first. */
  candidates(): Promise<ImportCandidates>;
  /** Main's open-file dialog; `{path: null}` when cancelled. */
  pick(): Promise<PickedPath>;
  /** Counts what would be copied, and writes nothing. */
  dryRun(path: string): Promise<ImportResult>;
  /** Backs up `pipeline.db` and `find.json`, imports, then maps the old rules if asked. */
  run(path: string, useOldRules: boolean): Promise<ImportResult>;
}

/** Settings › Connections (D7, D11). Owned by `main/settings/` (task B5). */
export interface ConnectionsService {
  /** One snapshot; never a secret's value. */
  status(): Promise<ConnectionsStatus>;
  /** Saves one setting, or stores one secret (set only). */
  set(change: ConnectionsChange): Promise<ConnectionsSetResult>;
  /** Main's folder dialog; `{path: null}` when cancelled. */
  pickFolder(purpose: FolderPurpose): Promise<PickedPath>;
  /** Runs `mail.status` and keeps each mailbox's answer for the status. */
  checkMailboxes(): Promise<MailCheckResult>;
  deployGateways(regions: readonly string[]): Promise<GatewaysDeployResult>;
  removeGateways(region: string): Promise<GatewaysRemoveResult>;
}

/** Starting and stopping the Gemini bridge (D12, D13). Owned by `main/gemini/` (task B7). */
export interface GeminiControl {
  status(): GeminiStatus | Promise<GeminiStatus>;
  start(): Promise<GeminiStatus>;
  stop(): Promise<GeminiStatus>;
  /** Starts the bridge if needed and opens the Gemini window; `browser` null is its own choice. */
  openWindow(browser: string | null): Promise<GeminiStatus>;
}

/** The course's playbook rules, read only (D9). Owned by `main/settings/` (task B5). */
export interface WritingRulesService {
  list(): Promise<WritingRules>;
}

/** Connecting a Gmail mailbox by OAuth consent; nothing is sent or read (D10). Task B6. */
export interface MailConsentService {
  connect(): Promise<MailConnectResult>;
}

/** Reach's drafts, sends and mailboxes (plan step 6). Owned by `main/reach/reach-service.ts`. */
export interface ReachService {
  thread(creatorId: string): Promise<ChannelResponse<"reach:thread">>;
  draftNow(creatorId: string): Promise<ChannelResponse<"reach:draft-now">>;
  rewrite(draftId: string, how: RewriteHow): Promise<ChannelResponse<"reach:rewrite">>;
  retry(draftId: string): Promise<ChannelResponse<"reach:retry">>;
  markSent(draftId: string): Promise<ChannelResponse<"reach:mark-sent">>;
  sendNew(draftId: string): Promise<ChannelResponse<"reach:send-new">>;
  refreshMailboxes(): Promise<ChannelResponse<"reach:mailboxes-refresh">>;
  /** The frame with the runtime parts of `reach` and the rail count filled in. */
  overlay(frame: Frame): Frame;
  /** Called after a `data:write` batch has been stored. */
  afterWrite(writes: readonly DataWrite[]): void;
}

/** The step 4 services, as `HandlerContext` holds them. */
export interface HandlerServices {
  importer: ImporterService;
  connections: ConnectionsService;
  gemini: GeminiControl;
  writingRules: WritingRulesService;
  mailConsent: MailConsentService;
  reach: ReachService;
}
