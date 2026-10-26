import { z } from "zod";

import { authStatusSchema, signInRequestSchema, signInResultSchema } from "./auth";
import {
  connectionsChangeSchema,
  connectionsSetResultSchema,
  connectionsStatusSchema,
  gatewaysDeployRequestSchema,
  gatewaysDeployResultSchema,
  gatewaysRemoveRequestSchema,
  gatewaysRemoveResultSchema,
  mailCheckResultSchema,
  mailConnectResultSchema,
  pickFolderRequestSchema,
} from "./connections";
import {
  dataWriteSchema,
  frameSchema,
  logForRequestSchema,
  logForResultSchema,
  logPageRequestSchema,
  logPageResultSchema,
} from "./data";
import {
  reachCheckRepliesResultSchema,
  reachCreatorRequestSchema,
  reachDraftActionResultSchema,
  reachDraftIdRequestSchema,
  reachDraftNowRequestSchema,
  reachDraftNowResultSchema,
  reachMailboxSetRequestSchema,
  reachMailboxSetResultSchema,
  reachParkRequestSchema,
  reachPasteReplyRequestSchema,
  reachPasteReplyResultSchema,
  reachReclassifyRequestSchema,
  reachReclassifyResultSchema,
  reachRefreshResultSchema,
  reachRewriteRequestSchema,
  reachRewriteResultSchema,
  reachSendTestRequestSchema,
  reachSendTestResultSchema,
  reachRestoreRequestSchema,
  reachSequenceResultSchema,
  reachSequenceSkipResultSchema,
  reachSituationsResultSchema,
  reachThreadRequestSchema,
  reachThreadResultSchema,
} from "./reach";
import {
  findAddRequestSchema,
  findAddResultSchema,
  findEditResultSchema,
  findIdeasRequestSchema,
  findIdeasResultSchema,
  findIndexRequestSchema,
  findItemRequestSchema,
  findItemResultSchema,
  findQueryRequestSchema,
  findQueryResultSchema,
  findRulesSchema,
  findRunsResultSchema,
  findStartResultSchema,
  findStateSchema,
  findViewsResultSchema,
  findViewsSetRequestSchema,
  findViewsSetResultSchema,
} from "./find";
import { geminiOpenWindowRequestSchema, geminiStatusSchema } from "./gemini";
import {
  importCandidatesSchema,
  importDryRunRequestSchema,
  importResultSchema,
  importRunRequestSchema,
  pickedPathSchema,
} from "./import";
import { presenceSetSchema } from "./presence";
import { syncStatusSchema } from "./sync";
import {
  toolboxArchivedRequestSchema,
  toolboxArchivedResultSchema,
  toolboxCountsSchema,
  toolboxListRequestSchema,
  toolboxListResultSchema,
  toolboxRestoreRequestSchema,
  toolboxRestoreResultSchema,
} from "./toolbox";
import { writingRulesSchema } from "./writing";

/**
 * A secret's name: lowercase words joined by dots or hyphens, such as "gemini.api-key" or
 * "gmail.token.mailbox-1". Names are not secret; values never cross the bridge.
 */
export const secretName = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/, "Use lowercase words joined by dots or hyphens");

/**
 * Every IPC channel the renderer may call, with the schema of its request and of its response.
 * The main process checks each call against this map, so a channel that is not here does not
 * exist. Names follow `domain:verb`.
 */
export const channels = {
  /** Checks that the bridge is up, and reports the app's version. */
  "app:ping": {
    request: z.strictObject({}),
    response: z.strictObject({
      ok: z.literal(true),
      version: z.string().min(1),
    }),
  },
  /** Whether a secret is set. The page can ask this; no channel ever returns a secret's value. */
  "secrets:status": {
    request: z.strictObject({ name: secretName }),
    response: z.strictObject({ set: z.boolean() }),
  },
  /** Everything the frame shows, in one read. */
  "frame:load": {
    request: z.strictObject({}),
    response: frameSchema,
  },
  /** Saves a batch of changes, in order, all or none. */
  "data:write": {
    request: z.strictObject({ writes: z.array(dataWriteSchema).min(1).max(100) }),
    response: z.strictObject({}),
  },
  /** Where the account stands, and its own email. The page asks this first. */
  "auth:status": {
    request: z.strictObject({}),
    response: authStatusSchema,
  },
  /** Signs in with email and password. The password is used once and never stored or echoed. */
  "auth:sign-in": {
    request: signInRequestSchema,
    response: signInResultSchema,
  },
  /** The waiting screen's "Check again": asks the server for the access and the team again. */
  "auth:recheck": {
    request: z.strictObject({}),
    response: authStatusSchema,
  },
  /** Signs out, deletes this computer's copy of the team's data, then reloads the window. */
  "auth:sign-out": {
    request: z.strictObject({}),
    response: z.strictObject({}),
  },
  /** How the sync stands right now. */
  "sync:status": {
    request: z.strictObject({}),
    response: syncStatusSchema,
  },
  /** Runs one sync pass now (or waits for the running one) and answers with the status. */
  "sync:now": {
    request: z.strictObject({}),
    response: syncStatusSchema,
  },
  /** Tells teammates which screen this person is on, and whether they are idle. */
  "presence:set": {
    request: presenceSetSchema,
    response: z.strictObject({}),
  },
  /** The Find screen's queue, rules, run and results. */
  "find:state": {
    request: z.strictObject({}),
    response: findStateSchema,
  },
  /** Adds keywords to the end of the queue; blanks and repeats are skipped. */
  "find:add": {
    request: findAddRequestSchema,
    response: findAddResultSchema,
  },
  /** Removes one queue entry. Refused while a search runs. */
  "find:remove": {
    request: findIndexRequestSchema,
    response: findEditResultSchema,
  },
  /** Sets where the next run begins. Refused while a search runs. */
  "find:start-at": {
    request: findIndexRequestSchema,
    response: findEditResultSchema,
  },
  /** Starts the search from the queue's next keyword. */
  "find:start": {
    request: z.strictObject({}),
    response: findStartResultSchema,
  },
  /** Asks the search to pause after the keyword in progress. */
  "find:stop": {
    request: z.strictObject({}),
    response: z.strictObject({}),
  },
  /** One page of the catalog with its total and facet counts (plan step 5, D2). */
  "find:query": {
    request: findQueryRequestSchema,
    response: findQueryResultSchema,
  },
  /** One channel's detail: its fit, description and up to 15 videos; null when unknown. */
  "find:item": {
    request: findItemRequestSchema,
    response: findItemResultSchema,
  },
  /** The newest search runs, with what each found and kept (D10). */
  "find:runs": {
    request: z.strictObject({}),
    response: findRunsResultSchema,
  },
  /** The gallery's saved views for the open data source (D16, D20). */
  "find:views": {
    request: z.strictObject({}),
    response: findViewsResultSchema,
  },
  /** Replaces the saved views. More than 20 is refused as `too_many`, and nothing is stored. */
  "find:views-set": {
    request: findViewsSetRequestSchema,
    response: findViewsSetResultSchema,
  },
  /** Keyword ideas from Gemini for the queue (plan step 5, D33); `bridge_off` until it is on. */
  "find:ideas": {
    request: findIdeasRequestSchema,
    response: findIdeasResultSchema,
  },
  /** One creator's activity lines, newest first (a record's Activity tab, D23). */
  "log:for": {
    request: logForRequestSchema,
    response: logForResultSchema,
  },
  /** The whole activity log, a page at a time, with each person's line count (D40). */
  "log:page": {
    request: logPageRequestSchema,
    response: logPageResultSchema,
  },
  /** One page of Toolbox's archive countdown or never-contact list (plan step 5d, D36, D39). */
  "toolbox:list": {
    request: toolboxListRequestSchema,
    response: toolboxListResultSchema,
  },
  /** The channels archived for good, newest first, searchable (D36). */
  "toolbox:archived": {
    request: toolboxArchivedRequestSchema,
    response: toolboxArchivedResultSchema,
  },
  /** Brings channels back from "Archived for good" (D38); `busy` while a search runs. */
  "toolbox:restore": {
    request: toolboxRestoreRequestSchema,
    response: toolboxRestoreResultSchema,
  },
  /** Archives for good the rejected channels past their date (D37); answers at once. */
  "toolbox:sweep": {
    request: z.strictObject({}),
    response: z.strictObject({}),
  },
  /** The numbers beside the Toolbox tools (D34). */
  "toolbox:counts": {
    request: z.strictObject({}),
    response: toolboxCountsSchema,
  },
  /** Replaces the search rules (Settings › Search rules); `find:changed` follows. */
  "rules:set": {
    request: z.strictObject({ rules: findRulesSchema }),
    response: z.strictObject({}),
  },
  /** The old app's databases main found on this computer. */
  "import:candidates": {
    request: z.strictObject({}),
    response: importCandidatesSchema,
  },
  /** Main's file dialog for an old database the owner picks. */
  "import:pick": {
    request: z.strictObject({}),
    response: pickedPathSchema,
  },
  /** Counts what an import would copy, and writes nothing. */
  "import:dry-run": {
    request: importDryRunRequestSchema,
    response: importResultSchema,
  },
  /** Backs up, then imports the old file. The old file is only ever read. */
  "import:run": {
    request: importRunRequestSchema,
    response: importResultSchema,
  },
  /** The course's playbook rules, for Settings › Writing rules. */
  "writing:rules": {
    request: z.strictObject({}),
    response: writingRulesSchema,
  },
  /** Everything Settings › Connections shows. Never a secret's value. */
  "connections:status": {
    request: z.strictObject({}),
    response: connectionsStatusSchema,
  },
  /** Saves one connection setting or secret. Secrets go in and never come back. */
  "connections:set": {
    request: connectionsChangeSchema,
    response: connectionsSetResultSchema,
  },
  /** Main's folder dialog for the course folder or its videos. */
  "connections:pick-folder": {
    request: pickFolderRequestSchema,
    response: pickedPathSchema,
  },
  /** Connects a Gmail mailbox through Google's consent page. Consent only: nothing is sent or read. */
  "mail:connect": {
    request: z.strictObject({}),
    response: mailConnectResultSchema,
  },
  /** Checks each connected mailbox's sign-in (`mail.status`). */
  "mail:check": {
    request: z.strictObject({}),
    response: mailCheckResultSchema,
  },
  /** Deploys AWS gateways in these regions. */
  "gateways:deploy": {
    request: gatewaysDeployRequestSchema,
    response: gatewaysDeployResultSchema,
  },
  /** Removes the gateways in one region. */
  "gateways:remove": {
    request: gatewaysRemoveRequestSchema,
    response: gatewaysRemoveResultSchema,
  },
  /** One creator's thread, oldest first (plan step 6, D4). */
  "reach:thread": {
    request: reachThreadRequestSchema,
    response: reachThreadResultSchema,
  },
  /** Queues a first email for a creator at `contact` now (D15). */
  "reach:draft-now": {
    request: reachDraftNowRequestSchema,
    response: reachDraftNowResultSchema,
  },
  /** Asks Gemini to rewrite a draft (D8); the new text arrives as the frame's `reach`. */
  "reach:rewrite": {
    request: reachRewriteRequestSchema,
    response: reachRewriteResultSchema,
  },
  /** Drafts a failed draft again (D6). */
  "reach:retry": {
    request: reachDraftIdRequestSchema,
    response: reachDraftActionResultSchema,
  },
  /** A send that may have gone out did: records it from the draft, sends nothing (D11). */
  "reach:mark-sent": {
    request: reachDraftIdRequestSchema,
    response: reachDraftActionResultSchema,
  },
  /** A send that may have gone out didn't: a copy of the draft, `ready`, with its own send key (D11). */
  "reach:send-new": {
    request: reachDraftIdRequestSchema,
    response: reachDraftActionResultSchema,
  },
  /** Reads each mailbox's numbers from Gmail again (`mail.status`, D9). */
  "reach:mailboxes-refresh": {
    request: z.strictObject({}),
    response: reachRefreshResultSchema,
  },
  /** Sets a mailbox's daily cap or pause at once (D20); not an undo step. */
  "reach:mailbox-set": {
    request: reachMailboxSetRequestSchema,
    response: reachMailboxSetResultSchema,
  },
  /** Sends a test email from a mailbox to its own address, on a person's click (D20). */
  "reach:send-test": {
    request: reachSendTestRequestSchema,
    response: reachSendTestResultSchema,
  },
  /** Stops a creator's follow-ups (D22); its open follow-up drafts are skipped. */
  "reach:sequence-stop": {
    request: reachCreatorRequestSchema,
    response: reachSequenceSkipResultSchema,
  },
  /** Runs a sequence the person stopped again (D22); due steps are drafted, never sent. */
  "reach:sequence-resume": {
    request: reachRestoreRequestSchema,
    response: reachSequenceResultSchema,
  },
  /** Parks a creator until a day (D22): the stage `parked`, the follow-ups waiting. */
  "reach:park": {
    request: reachParkRequestSchema,
    response: reachSequenceSkipResultSchema,
  },
  /** Wakes a parked creator now (D22): back to `emailed`, the steps re-timed. */
  "reach:wake": {
    request: reachRestoreRequestSchema,
    response: reachSequenceResultSchema,
  },
  /** Reads new replies from Gmail now (`mail.replies`, then `mail.ack` for those stored; D23). */
  "reach:check-replies": {
    request: z.strictObject({}),
    response: reachCheckRepliesResultSchema,
  },
  /** Adds a reply the person pasted; it is read and answered like a swept one (D23). */
  "reach:paste-reply": {
    request: reachPasteReplyRequestSchema,
    response: reachPasteReplyResultSchema,
  },
  /** "That's not it": reads the reply as another situation and drafts the answer again (D23). */
  "reach:reclassify": {
    request: reachReclassifyRequestSchema,
    response: reachReclassifyResultSchema,
  },
  /** The reply situations of each side, for the "That's not it" picker (D23). */
  "reach:situations": {
    request: z.strictObject({}),
    response: reachSituationsResultSchema,
  },
  /** Starts the Gemini bridge. Sends no prompt. */
  "gemini:start": {
    request: z.strictObject({}),
    response: geminiStatusSchema,
  },
  /** Stops the Gemini bridge. */
  "gemini:stop": {
    request: z.strictObject({}),
    response: geminiStatusSchema,
  },
  /** Starts the bridge if needed and opens the Gemini window in a browser. */
  "gemini:open-window": {
    request: geminiOpenWindowRequestSchema,
    response: geminiStatusSchema,
  },
} as const;

export type Channel = keyof typeof channels;
export type ChannelRequest<C extends Channel> = z.input<(typeof channels)[C]["request"]>;
export type ChannelResponse<C extends Channel> = z.output<(typeof channels)[C]["response"]>;
/** A request after its schema has parsed it: what a handler in the main process receives. */
export type ChannelInput<C extends Channel> = z.output<(typeof channels)[C]["request"]>;

export type ParsedRequest =
  | { [C in Channel]: { ok: true; channel: C; value: ChannelInput<C> } }[Channel]
  | { ok: false; reason: string };

export function isChannel(name: string): name is Channel {
  return Object.hasOwn(channels, name);
}

/** Checks a call from the renderer: the channel must exist and the input must match its schema. */
export function parseRequest(channel: string, input: unknown): ParsedRequest {
  if (!isChannel(channel)) {
    return { ok: false, reason: `Unknown channel "${channel}"` };
  }
  const result = channels[channel].request.safeParse(input);
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) };
  }
  // TypeScript can't tie the schema chosen by `channel` to that channel's input type, but the
  // value was parsed by exactly that schema.
  return { ok: true, channel, value: result.data } as ParsedRequest;
}
