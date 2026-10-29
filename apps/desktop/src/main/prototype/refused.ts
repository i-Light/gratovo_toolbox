import type { Channel } from "@gratovo/ipc";

/** What a refused call throws; the dispatcher logs it and the page learns only that it failed. */
export const prototypeRefused = "Not available in prototype mode.";

/**
 * The channels main refuses while prototype mode is on (plan D6): while on, nothing leaves the
 * computer. Each of these writes a secret, opens a browser, a Google window or a dialog, starts the
 * Gemini bridge, sends mail, runs a live mail or gateway job, or imports. `handlers.ts` makes them
 * throw before the real handler runs; the page sees a failed call.
 *
 * The audit of every other channel, with the source in `mode: "example"` (2026-10-27):
 * - `app:ping`, `secrets:status`, `writing:rules`: read only, local (a secret's presence, never its
 *   value; the playbook's files).
 * - `frame:load`, `data:write`, `log:*`, `find:views*`, `toolbox:list`, `toolbox:counts`,
 *   `toolbox:archived`: the open source and `pipeline.db`, the prototype copy's while on. The
 *   shortlist's email lookup is live only (`liveContext` is null on example data).
 * - `find:*` (state, add, remove, start-at, start, stop, query, item, runs), `rules:set`: the queue
 *   and rules are files in `prototype-pipeline`; a search runs the Python example source
 *   (`source: "example"`), which reads `channels.json` and never touches the network, and the
 *   YouTube key is looked up for live only. `find:ideas` answers its stand-in on example data.
 * - `insights:read`, `insights:list`, `insights:hide`, `insights:goal`: local reads of the open source
 *   and `pipeline.db` (read-only), and two local settings (`insights.hidden`, `insights.goal`); no
 *   secret, no network, no mail. None is refused.
 * - `toolbox:restore`, `toolbox:sweep`: the archive jobs run on example data locally; the refetch
 *   after a restore is live only.
 * - `reach:*` but `send-test`: example data has stand-ins on main's side. Sends are recorded locally
 *   (`sender.ts`), drafts and rewrites are filled without Gemini (`drafter.ts`), the mailbox check
 *   and the reply sweep answer without a job, and every mail job needs `liveJobContext`, null on
 *   example data. Mailbox caps, pauses, sequences and pasted replies write the open source only.
 * - `connections:status`: a snapshot; it reads (never writes) whether the team's YouTube key
 *   exists, from the account's own server, as the live account does in the background anyway.
 * - `auth:*`, `sync:*`: the real account's own session and the live copy's sync, which the plan
 *   keeps running in the background while on; no prototype data is in them. `auth:sign-out` turns
 *   prototype mode off (`withPrototype`). `presence:set` is answered, and ignored while on.
 * - `gemini:stop`: stopping is always safe.
 * - `prototype:*`, `comments:*`: prototype mode's own; never refused.
 */
export const refusedWhileOn: ReadonlySet<Channel> = new Set<Channel>([
  // A secret written (the Gmail app, keys, proxies) or a setting saved for the live data.
  "connections:set",
  // Main's folder dialog: its only use is `connections:set`, refused above.
  "connections:pick-folder",
  // Google's consent page in the browser, then a token in the secret store.
  "mail:connect",
  // `mail.status` and the gateway jobs: live mail and AWS.
  "mail:check",
  "gateways:deploy",
  "gateways:remove",
  // The old app's data: an open-file dialog, then writes to the live `pipeline.db`.
  "import:candidates",
  "import:pick",
  "import:dry-run",
  "import:run",
  // A real test email (example data has a stand-in, but nothing of the kind may run).
  "reach:send-test",
  // The Gemini bridge: a Python process, a browser window and prompts to Google.
  "gemini:start",
  "gemini:open-window",
]);
