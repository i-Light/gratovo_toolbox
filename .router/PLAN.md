# Plan: step 3e-3, the rest of the Python pipeline

Written 2026-10-21 by the lead (Opus) on branch `feat/3e-3-pipeline-rest`, from `main` at 11b3c7a. 3e-1's plan is in git history at dc13dd5; its decisions are ADR 0013, and this plan builds on them without changing them. 3e-2 (R2) is step T1: nothing here touches `r2.py`, `sync.py` or team work.

Read `.router/CONTEXT.md` §1 to §3 first (3e-1's recon, still true), then this. Bash commands start with `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";`. **Never read `.env*`, `*.local.json`, `aws_gateways.json` or `gmail_accounts*`**, and never read, print or handle a key or token value. Nothing here touches production Supabase. Never send an email, never read the mailbox, never run two Gemini bridges (port 8765).

**Status: the owner answered on 2026-10-21 (§Questions). Two pull requests: 3e-3a (the Gemini bridge and the comms engine) merged as #16 on 2026-10-23; 3e-3b (mail and the remaining jobs) detailed at the end of §Tasks and being built.**

## What 3e-3 ports (recon, 2026-10-21)

| Old part | Lines (src / tests) | Old caller | Part |
|---|---|---|---|
| `gemini_bridge/` (daemon, server, client, actions for keywords, classify, gems, skills; Firefox detect, profile, session, RDP; window guard) | 5,500 / 2,100 | `run_gemini_daemon.py daemon` (DAEMON.md) | **3e-3a** |
| `data/gemini skills/` (keyword generator, channel classifier) | 2 files | the two actions | 3e-3a |
| `comms/` runtime: engine, checks, playbook, live_case, moments, readiness, example_bank, course | 2,400 / 1,300 | `action.comms_propose`, `action.comms_check` | 3e-3a |
| `comms/` quality tools: coach, gradbar, pairwise, scenarios, mine_calls, pool, skill_build, verify, quote_review, review_claims, video_check | 3,300 / 900 | sessions, by hand | 3e-3a (Q2: port) |
| `data/comms/` (playbook, skill, tests; 3.8 MB) | data | the engine | 3e-3a |
| `tools/transcript.py` (yt-dlp), `video_transcripts` table | 260 / 60 | moments | 3e-3a |
| `gratovo/gmail.py`, `mailbox.py`, `tools/email_send.py` | 2,700 / 900 | Reach's send button, the reply sweep | **3e-3b** |
| `tools/video_stats.py` | 130 / 120 | Deliver's 30-day report | 3e-3b |
| `tools/enrich.py` (channels, videos, backfill), `tools/import_handles.py`, `run_manual_refetch` | 870 / – | "Pull more videos", the catch-up job, imports | 3e-3b |
| `tools/aws_gateway_setup.py` | 290 / – | Settings › AWS accounts | 3e-3b |
| `gratovo/feeds.py`, `tools/news.py`; `tools/email_library.py` | 990 / 330 | News, Email library | not now: parity §6 "Decide", step 9 (Q4) |
| `tools/derive_signals.py`, `get_subtitles.py`, `firefox_smoke.py`, `gemini_extension/` | – | one-off; dev smoke; step 6 | not ported (see D13) |

About 16,700 lines of source and 6,300 of tests: too much for one pull request. **Two pull requests, one per session (plan §10 rule 5): 3e-3a (the bridge and comms), 3e-3b (mail and the rest)** (owner, Q1).

## Acceptance

For each part: its ported pytest suites pass, each old test ported first and seen to fail; pyright strict, ruff, Vitest, typecheck, lint and Windows CI green; every new stdin/stdout message is in a zod schema with its JSON Schema file committed and checked by both sides (ADR 0013 §3); secrets only on stdin; no test reaches the network beyond `127.0.0.1`. Callers in the app (screens, IPC) arrive with steps 5 to 9: 3e-3 builds the pipeline side and main's process supervisor for it, no UI.

- **3e-3a:** the daemon starts from main, says `listening`, answers `bridge.status` and `bridge.browser_info` in a real-process Vitest test, and stops on quit. Every bridge test runs against the fake extension. And: `action.comms_propose` on a case built from a request plus `pipeline.db` returns a checked proposal with a fake Gemini; `comms_check` makes no Gemini call; `python -m gratovo_pipeline.comms.verify` passes on the moved playbook (with an invented test course); the course data is in `services/pipeline/data/`; the quality tools' tests pass (in the flat `comms/` package, D1).
- **3e-3b:** the mail jobs report status, send exactly once per `sendKey`, and never send without one (tests prove no automatic send); `video_stats`, `refetch`, `backfill` and `gateways` jobs run on fakes; the `search` job is unchanged.

## Decisions

- **D1. Where it goes.** `services/pipeline/src/gratovo_pipeline/`: `gemini/` (the bridge: `daemon.py`, `server.py`, `client.py`, `actions.py`, `gems.py`, `skills.py`, `keywords_batch.py`, `browser/` for detect, profile, session, rdp, window guard, manager), `comms/` (all of it, flat as in the old code: the engine imports the hand-run tools lazily, so a `studio/` subfolder would only rewrite imports; the package docstring says which modules the app uses and which a person runs by hand), `mail/` (`gmail.py`, `mailbox.py`, `send.py` from email_send), `jobs/` (`mail.py`, `video_stats.py`, `refetch.py`, `backfill.py`, `gateways.py`), `transcript.py`, `aws_sign.py`. Data in `services/pipeline/data/` (`comms/`, `gemini-skills/`), found through `gratovo_pipeline/paths.py` (the one module that knows where), never the old `REPO / "data"`. `extract_json` moves out of actions.py into `gemini/json_reply.py`, so comms uses it without the actions. Every Gemini error class lives in `gemini/errors.py`, its code list equal to `geminiErrorCodes` (a test). One test file per old one, typed.
- **D2. The Gemini bridge is a long-lived service, not a job.** Main starts `<python> -I -u -m gratovo_pipeline.gemini --port 8765 --data-dir <dir> --profile-dir <userData>/gemini-profile --extension-dir <repo>/services/gemini-extension`, with the bare environment of ADR 0013 §1. At most one runs (owner rule); a second start while one is up is refused by main, and `port_in_use` ends it. The wire is DAEMON.md as it stands (requests with `id`, responses `ok`/`error`, `event` lines, out-of-order answers), with the retired drafting actions left out (test_old_drafting_removed ported). It needs no secrets. Its stdout lines are checked against their own schema (D4). EOF on stdin, `bridge.shutdown` or app quit stops it; main kills it 5 s after quit.
- **D3. The extension comes in step 6** (plan §7). Until `services/gemini-extension/` exists, `bridge.browser_info` reports the add-on `missing` and `ensure_window` fails with `ADDON_INSTALL_FAILED` (reason `no extension`). The browser profile moves from `%LOCALAPPDATA%\gratovo\gemini-profile` to `<userData>/gemini-profile`.
- **D4. Two more schemas, same rule as ADR 0013 §3.** `apps/desktop/src/main/pipeline/gemini-protocol.ts` (envelope, the `bridge.*` and `action.*` params and results the app will call, the events) writes `gemini.schema.json` (3e-3a); the job protocol in `protocol.ts` gains the new job kinds (D9, D11) in 3e-3b and stays version 1 (only additions). Proxied extension methods are typed as `params: object` → `result: unknown` at the envelope level; their shapes are PROTOCOL.md's and the extension is step 6. pytest checks every captured line against the files; Vitest snapshots fail when a file is stale.
- **D5. Loopback in tests.** The socket guard gains an opt-in fixture `loopback` that allows `connect` to `127.0.0.1` and `::1` only (the fake extension); everything else is still refused. Only the bridge's tests use it.
- **D6. The pipeline never reads the app's database.** The old `live_case` read `channel_state`, `brands`, `deals`, `outreach_*` and `agency_settings` from `gratovo.db`. Now main sends those facts in the request (`facts`, D10), and Python reads only what it owns: `channels` and `videos` from `pipeline.db`. `live_case.build_case(conn, request, facts)` keeps the old rules (policy, readiness, HC-08, HC-09, BRD-PRES-15) on plain dicts. Main's half (reading its tables into `facts`) is step 6.
- **D7. `pipeline.db` version 2** adds `video_transcripts` (as the old store, keyed by video id) through `user_version`. `mailbox.db` stays its own file, `<userData>/mail/mailbox.db`, per machine, live data only (the old reasons hold: a Gmail thread id means nothing outside its mailbox).
- **D8. The course check** (FND-WRITE-15, a message never reuses 8 words in a row from the course) needs the lesson and video text, which lives only on the owner's PC (owner, Q3: a folder path in Settings). The bridge is started with `--course-dir` and `--video-dir` when main's per-machine settings hold them (`comms.courseDir`, `comms.videoDir` in `local_settings`; the Settings row to edit them is step 9). Without them, `course.lessons()` and `videos()` are empty, `checks` skips that one check and adds the finding `COURSE_CHECK_SKIPPED` (severity `warn`: the course wasn't on this computer, so wording copied from it wasn't checked), and the proposal still runs. The rule quotes and roast examples (in the repository) are always checked. The studio tools take the same flags (or `GRATOVO_COURSE_DIR` / `GRATOVO_VIDEO_DIR` when run by hand) and stop with a clear message when the course is missing. Tests use a small invented course (AI niche, written for the tests), never the real one.
- **D9. Mail is jobs, one process each** (ADR 0013 §1): `mail.status`, `mail.send`, `mail.replies` (check for replies), `mail.ack`, `mail.cancel`. The Google client id and secret and each mailbox's refresh token come in `start.secrets.mail`; they are kept in the secret store as `mail.client` and `mail.mailboxes`. Python refreshes the access token and calls Gmail over `urllib` (as ADR 0013 §7: no Google client libraries). The consent flow (opening the browser once to connect a mailbox) runs in main, with the mailbox screen, in step 6: no refresh token is ever written to stdout. **No automatic send:** `mail.send` sends the one message it is given, only with a `sendKey` and an `approvedBy` (the user id), at most once per key (`duplicate` / `send_uncertain` as the old tool); nothing queues, and `run-due`'s old follow-up path is not ported. The daily cap (HC-02, 35, within 10 to 50) stays.
- **D10. Comms over the bridge.** `action.comms_propose` takes `{request, facts}` (D6) and `action.comms_check` `{request, facts, text}`, as DAEMON.md's Comms section otherwise says. The bridge opens `pipeline.db` read-only for channels and videos and writes only `video_transcripts`.
- **D11. Other jobs** (3e-3b), each a `job.kind` on protocol v1: `video_stats {videoUrl}` → `{views, fetchedAt}`; `refetch {handles, autoClean}` (the old `run_manual_refetch` and import_handles); `backfill {only: "channels"|"videos"|"backfill", handles?, months?, maxApiCalls?}` (enrich.py without its sync); `gateways {action: "list"|"deploy"|"enable"|"disable"|"test"|"destroy", regions?}`. Their results come as one new `result` line before `end`. The AWS keys come in `secrets.aws` from the secret store (`aws.keys`); the gateway URLs a deploy makes are sent back in `result` and main stores them as `pipeline.gateways` (the deploy's only secret output, and it goes to main alone: main blanks it from logs).
- **D12. The network rule grows by host, per job.** `net.py`'s allowlist adds, only for the jobs that need them: `gmail.googleapis.com` and `oauth2.googleapis.com` (mail), `apigateway.<region>.amazonaws.com` and `sts.amazonaws.com` (gateways), `gemini`: none (the bridge only listens on `127.0.0.1`). yt-dlp (transcripts) makes its own requests and can't be checked by `net.py`: it is called only with a watch URL built from a checked 11-character video id, with no config files, no plugins and no cache (`--ignore-config`, `--no-cache-dir`), recorded as an exception in the ADR. Deno, which yt-dlp needs for YouTube's player code, is packaged in 3h; until then a missing Deno reports `no_deno` and moments are skipped (the draft still proceeds without a personal line, as the old app did on a failed read).
- **D13. Not ported:** `derive_signals.py` (a one-off backfill; 3e-1's store derives signals as it writes), `get_subtitles.py` (an old script superseded by `transcript.py`), `firefox_smoke.py` (a dev smoke for the extension: comes with step 6), `test_build_addon` (step 6), and the bridge's command line `gemini_bridge/cli.py` with its tests (main drives the bridge through the daemon's methods; step 6, which works on the extension, ports it if it still needs one). AWS requests are signed by a small SigV4 module over `urllib` (`aws_sign.py`, tested against AWS's published examples), not boto3, for ADR 0013 §7's reason.

## Contracts (3e-3a in full; 3e-3b to the level above, completed by the lead at its start)

### Gemini service (3e-3a)

```ts
// stdin, one per line
type Request = { id: string /* 1..100 */; method: string /* known method */; params: Record<string, unknown> };
// stdout
type Response = { type: "response"; id: string | null; ok: true; result: unknown }
              | { type: "response"; id: string | null; ok: false; error: { code: GeminiCode; message: string; details: Record<string, unknown> } };
type Event = { type: "event"; event: "daemon" | "hello" | "job" | "status" | "log" | "progress"; data: Record<string, unknown> };
// first line: event daemon {state: "listening", port, pid, version} | {state: "failed", reason: "port_in_use", port}
```

`GeminiCode` is PROTOCOL.md §2's list plus DAEMON.md §2's table. Typed params and results (zod, strict) for: `bridge.status`, `bridge.browser_info`, `bridge.ensure_window`, `bridge.install_addon`, `bridge.ask`, `bridge.shutdown`, `action.generate_keywords`, `action.classify_channel`, `action.gem_create`, `action.gem_update`, `action.gem_read`, `action.skills_list`, `action.skill_read`, `action.skill_set_active`, `action.skill_delete`, `action.skill_deploy`, and the `progress` event (DAEMON.md "progress events"). A response whose result fails its method's schema is treated by main as `INTERNAL` and logged (first 200 characters).

Main: `apps/desktop/src/main/pipeline/gemini-service.ts`: `start(): Promise<{ok: true} | {ok: false, problem: "running" | "no_python" | "port_in_use"}>`, `call(method, params, {timeoutS}) → Promise<Result>` (correlates by `id`, a timeout answers `TIMEOUT` and leaves the request to finish), `onEvent(listener)`, `stop()`. Logs to `<userData>/logs/gemini-<stamp>.log` like the job logs (newest 40).

### Comms over the bridge (3e-3a, B5; D6, D10)

```ts
// action.comms_propose params; action.comms_check takes the same plus { subject: string; body: string }
type CommsRequest = {
  kind: "first" | "reply" | "followUp" | "decision";
  threadId?: string; channelId?: string; brandId?: string; contactEmail?: string;
  pitchChannelIds?: string[];          // a brand pitch's creators, at most 10
  followUpNumber?: number;             // 1..5
  steer?: Record<string, string>;      // the Steer panel: knob id → option id, plus "note"
  cashOffer?: boolean;                 // HC-10 for this case only
  timeoutS?: number;
};
// The app's side of the case, read by main from its own tables (step 6). Python reads nothing else
// of the app's; channels and videos come from pipeline.db, which Python owns.
type CommsFacts = {
  agency: { name: string | null; sender: string | null; whatWeDo: string | null; website: string | null;
            trueClaims: string[]; pastCampaigns: unknown[]; incubator: boolean;
            boycott: { countries: string[]; brands: string[] } } | null;     // null: the defaults, as before
  thread: { id: string; channelId: string | null; brandId: string | null; contactEmail: string | null;
            dealId: string | null;
            messages: { direction: "outbound" | "inbound"; subject: string; body: string; at: string }[] } | null;
  creators: Record<string, { pipelineStage: string | null; mediaKit: Record<string, unknown> | null;
                             creatorGender: string | null }>;   // channel_state by channel id
  brand: { id: string; name: string; website: string | null; category: string | null; country: string | null;
           campaignBrief: string | null; contactName: string | null;
           contacts: { name?: string; email?: string; primary?: boolean }[] } | null;
  deal: { brandName: string | null; stage: string | null; creatorReceives: number | null; currency: string | null;
          deliverables: string | null; deadline: string | null; paymentTerms: string | null } | null;
          // the channel's latest deal; never the brand's price (HC-04)
  recentOutbound: { threadId: string | null; body: string }[];  // our recent sent emails, newest first, at most 50; the case leaves out its own thread by id (the templated check)
};
// comms_propose → { status: "ready" | "needs_human" | "blocked" | "no_message"; proposal; findings; gates;
//                   case: { side, stage, goal }; moments; momentsNote; seconds; model; thinking }  (as the old action)
// comms_check  → { findings; gates; blocking: boolean }   (no Gemini call)
```

### Job additions (3e-3b)

```ts
// start.job, alongside kind "search"
| { kind: "mail.status" } | { kind: "mail.send"; message: { to; subject; body; mailbox?; conversationKey?; replyTo?: {gmailThreadId, messageId}; sendKey: string; approvedBy: string; labels? } }
| { kind: "mail.replies"; mailbox? } | { kind: "mail.ack"; messageIds: string[] } | { kind: "mail.cancel"; conversationKey: string }
| { kind: "video_stats"; videoUrl: string } | { kind: "refetch"; handles: string[]; autoClean: Rules["autoClean"] | null }
| { kind: "backfill"; only; handles?; months?; maxApiCalls? } | { kind: "gateways"; action; regions? }
// start.secrets gains: mail?: { client: {id, secret}; mailboxes: {address, refreshToken}[] }; aws?: { accessKeyId, secretAccessKey }
// stdout gains: { type: "result"; kind; data } — the job's answer, at most once, before end
// end.error.code gains: "mail_not_connected" | "mail_auth" | "daily_cap_reached" | "send_uncertain" | "not_a_video" | "not_found" | "no_aws_keys" | "aws"
```

## Tasks

### 3e-3a: the Gemini bridge and the comms engine (this session)

| id | tier | depends | files | spec | done_check |
|---|---|---|---|---|---|
| A1 | H | – | `main/pipeline/gemini-protocol.ts` + test, `scripts/pipeline-schema.ts` (second file), `gratovo_pipeline/gemini/gemini.schema.json` | The schemas above from DAEMON.md and PROTOCOL.md §2, `parseGeminiLine` | Vitest; script output equals the file |
| A2 | N | A1 | `gemini/{__init__,__main__,errors,progress,server}.py`, `pyproject.toml` (websockets, exact pin), `uv.lock`, `tests/conftest.py` (D5), `tests/fake_extension.py`, `tests/test_gemini_bridge.py` | server.py ported and typed; the fake extension from test_gemini_bridge | pytest, pyright, ruff |
| A3 | N | A2 | `gemini/client.py`, `gemini/actions.py`, `gemini/keywords_batch.py`, `data/gemini-skills/`, `tests/test_gemini_actions.py`, `tests/test_keywords_batch.py`, `tests/test_old_drafting_removed.py` | The client and the keyword and classify actions; `comms_*` registered but answering `NOT_IMPLEMENTED` until B5 | pytest |
| A4 | N | A2 | `gemini/gems.py`, `gemini/skills.py`, `tests/test_gems.py`, `tests/test_gemini_skills.py` | Ported, paths from `--data-dir` | pytest |
| A5 | N | A2 | `gemini/browser/*.py`, `tests/test_firefox_detect.py`, `tests/test_firefox_session.py`, `tests/test_window_guard.py` | Ported; D3's paths from argv; Windows-only code stays (the app is Windows only) | pytest |
| A6 | H | A3–A5 | `gemini/daemon.py`, `tests/test_gemini_daemon.py`, `tests/test_gemini_contract.py`, `tests/test_bridge_browser_admission.py`, `tests/test_run_gemini_daemon.py` | The daemon on the new entry point (D2), `--course-dir` and `--video-dir` passed through (D8); every captured line checked against `gemini.schema.json` | pytest |
| A7 | H | A1, A6 | `main/pipeline/gemini-service.ts` + test, `main/index.ts` (quit hook) | D2's start, call, events, stop and kill; one real-process test (`bridge.status`, `bridge.browser_info`, shutdown) | Vitest |
| B1 | H | A2 | `comms/{__init__,course,playbook,checks,engine,readiness,example_bank}.py`, `tests/course_fixture/`, `tests/test_comms_{checks,engine,example_bank,course}.py` | The runtime on config paths (D1, D8), the invented test course, `COURSE_CHECK_SKIPPED`; tests needing coach or scenarios skipped until B3 | pytest |
| B2 | N | B1 | `comms/{verify,skill_build,quote_review,review_claims,video_check}.py`, `tests/test_comms_{examples,references,skill_build,quote_review,videos}.py` (the data moved already, with the lead) | verify passes on the moved data (with the course) and stops clearly without | pytest; `verify` by hand with the owner's course path |
| B3 | N | B1, A2 | `comms/{coach,pool,pairwise,gradbar,scenarios,mine_calls}.py`, `tests/test_comms_{coach,pool,pairwise,gradbar,scenarios,mining,thinking}.py`, B1's skip marks lifted | Hand-run tools (owner, Q2); outputs and course paths from flags or the environment, never the old `E:` defaults | pytest |
| B4 | H | B1 | `transcript.py`, `comms/moments.py`, `store.py` (v2, `video_transcripts`), `tests/test_transcript_timed.py`, `tests/test_comms_moments.py` | D7, D12 (yt-dlp exact pin, its flags, `no_deno`) | pytest |
| B5 | H | A6, B1, B4 | `comms/live_case.py`, `gemini/actions.py` (comms actions), `gemini-protocol.ts` (their schemas), `tests/test_comms_live_case.py`, `tests/test_comms_actions.py` | D6, D10: facts from the request, channels and videos from `pipeline.db` read-only | pytest; Vitest |
| A8 | E | all | `docs/decisions/0014-gemini-bridge-and-comms.md`, `services/pipeline/README.md`, `docs/architecture.md`, `docs/migration-plan.md`, `.router/PROGRESS.md` | D1 to D8, D10 and D12 (transcripts) as an ADR; the status table | read through |
| L1 | lead | all | – | Full checks; `router-reviewer` on the diff; fixes; Windows CI by workflow_dispatch; PR, CI green, merge | all green |

### 3e-3b: mail and the remaining jobs (detailed 2026-10-23 by the lead, on `feat/3e-3b-mail-and-refetch` from `main` at f5a9e7a)

3e-3a merged as #16. This section replaces the outline and, where they differ, overrides D9, D11, D12 and "Job additions" above.

#### Decisions for 3e-3b (D14 to D21)

- **D14. Two lanes in main.** ADR 0013 §2 ran one job at a time; a Send must not wait hours for a search. Main keeps two supervisors: the **store lane** (`search`, `refetch`, `backfill`: they write `pipeline.db`, so never two at once) and the **quick lane** (`mail.*`, `video_stats`, `gateways.*`: one at a time, so `mailbox.db` has one writer). `laneFor(kind)` decides. Both stop on quit.
- **D15. One envelope, every kind.** `start` keeps its shape; `job` becomes a union on `kind`. `secrets.youtubeKey/proxyUrls/gatewayUrls` stay required (null and `[]` when a job needs none). Every kind except `search` needs `source: "live"` (example mode fakes these on main's side in steps 5 to 9); `source: "example"` with another kind is `bad_start`. For kinds other than `search`, `end.at`, `found` and `kept` are 0: the answer is in `result`. `Config.from_start` works for every kind (search fields neutral when the kind isn't `search`; the refetch job's `autoClean` feeds `auto_clean`).
- **D16. `result` and `reply`.** `{type: "result", kind, data}` is the job's answer: at most once, before `end`; always on `done`, and on `stopped` for `refetch` and `backfill` (partial counts); never on `failed`. Replies stream as one `{type: "reply", …}` line each (a sweep's bodies would pass the 64 KiB line limit): a body is cut to 16,000 characters, then halved until the line fits, with `bodyCut: true`.
- **D17. Mail (amends D9).** `mail/gmail.py` (Gmail over `urllib`: token refresh at `oauth2.googleapis.com/token`, REST at `gmail.googleapis.com/gmail/v1/users/me/…`; no redirects, no proxies, timeout 30 s; retries 429 and 5xx as the old `_call`, 4 tries, backoff with jitter; the access token lives only in memory and only in the `Authorization` header), `mail/mailbox.py` (the old store, same tables so an old `mailbox.db` opens unchanged; adds `approved_by TEXT` to `sent_messages` and `send_keys` by a guarded `ALTER`; `user_version` 1), `jobs/mail.py` (the five jobs). `mailbox.db` is `<dataDir>/mailbox.db`; main passes `<userData>/mail` as `dataDir`. **`sendKey` and `approvedBy` are required** (the schema refuses a send without them; the old "no key" path is gone). `mail.replies` sweeps the named mailbox or every connected one; one failing mailbox is reported in its entry and the rest go on. Replies stay unreported until `mail.ack` (no `--ack-now`). Queued follow-ups from an old file are cancelled by the sweep, never sent (test_email_send_no_auto_send). Not ported: `--authorize` and `--sign-out` (consent in main, step 6), `--pending` (nothing queues any more), `--test-send` (step 9 decides; the Settings card can use `mail.send` to the mailbox's own address), the `replyTo` header, `--dry-run`, `--ack-now`.
- **D18. Refetch and backfill (amends D11).** `refetch` is the old `run_manual_refetch` (import_handles' file reading stays in main: it sends parsed handles). Each handle is emitted as a `channel` line (`keyword` = the job's keyword, default `__manual_refetch__`), so the screen can show it live. `YouTubeApi` gains `channel_for_handle(handle)` (`channels.list?forHandle=`). `backfill` ports enrich.py's three jobs without the report and without the sync, plus `backlog` (3e-1's `backfill_missing_videos` over the whole store: the old catch-up button). Run kinds: `re-enrich` for both jobs, `catch-up` while `backlog` runs. A stop ends `stopped` with what was saved.
- **D19. Gateways (amends D11).** `list`, `enable` and `disable` change only main's stored state, so they stay in main (C6). Python does `gateways.deploy {regions}`, `gateways.destroy {gateways: [{region, apiId}]}` and `gateways.test` (every URL in `secrets.gatewayUrls`, `GET <url>/generate_204`, `ok` when the status is below 500). Requests to `apigateway.<region>.amazonaws.com` (API Gateway v2 REST: `POST /v2/apis`, `/v2/apis/{id}/integrations`, `/routes`, `/stages`; `DELETE /v2/apis/{id}`), signed by `aws_sign.py` (SigV4, service `apigateway`). STS isn't needed. One region failing doesn't stop the others. `pipeline.gateways` in the secret store becomes `{enabled, gateways: [{region, apiId, url}]}`; the old plain list is still read (as enabled, with no api ids).
- **D20. The network rule per job (amends D12).** `net.allow_job_hosts(kind)` is called once by the entry point before the job runs. `mail.*` adds `gmail.googleapis.com` and `oauth2.googleapis.com`; `gateways.*` adds `apigateway.<region>.amazonaws.com`. Everything else keeps 3e-1's list.
- **D21. Secrets in main.** `mail.client` (`{id, secret}`), `mail.mailboxes` (`[{address, refreshToken}]`) and `aws.keys` (`{accessKeyId, secretAccessKey}`) are JSON in the secret store, read and checked by `pipeline-secrets.ts` (bad JSON or shape → treated as missing, logged by name only). `secretsOf` blanks the client secret, each refresh token, both AWS keys, and each gateway's `apiId`. A deploy's `result` is merged into `pipeline.gateways` and never logged.

#### Contracts (zod in `protocol.ts`; Python mirrors them in `protocol.py`)

```ts
const email = z.string().min(3).max(320).regex(/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/);
const handle = z.string().regex(/^@[A-Za-z0-9._-]{1,100}$/);
const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);
const apiId = z.string().regex(/^[a-z0-9]{1,32}$/);
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const conversationKey = z.string().min(1).max(200);
const channelId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// start.job: discriminatedUnion("kind", [searchJob (unchanged), …])
{ kind: "mail.status" }
{ kind: "mail.send"; message: { to: email; subject: string /*0..998*/; body: string /*1..100_000*/;
    mailbox?: email; conversationKey?: conversationKey; newThread?: boolean; channelId?: channelId;
    labels?: string[] /*≤10, each 1..100*/; sendKey: string /*8..200, [A-Za-z0-9_:.-]*/; approvedBy: string /*1..100*/ } }
{ kind: "mail.replies"; mailbox?: email; conversationKey?: conversationKey; limit?: number /*1..500, default 60*/ }
{ kind: "mail.ack"; messageIds: gmailId[] /*1..500*/ }
{ kind: "mail.cancel"; conversationKey: conversationKey }
{ kind: "video_stats"; videoUrl: string /*1..2000*/ }
{ kind: "refetch"; handles: handle[] /*1..2000, unique ignoring case*/; keyword?: keyword; autoClean: AutoClean | null }
{ kind: "backfill"; only: ("channels"|"videos"|"backfill"|"backlog")[] /*1..4, unique*/; handles?: handle[] /*1..500*/;
    months?: number /*1..24, default 2*/; maxApiCalls?: number /*0..10_000, default 100; 0 = no ceiling*/;
    includeAbsent?: boolean; limit?: number /*1..100_000*/ }
{ kind: "gateways.deploy"; regions: region[] /*1..20, unique*/ }
{ kind: "gateways.destroy"; gateways: { region; apiId }[] /*1..50*/ }
{ kind: "gateways.test" }
// refine: source "example" only with kind "search"

// start.settings gains (optional):
mail?: { label: string /*1..100*/; senderName: string | null /*≤100*/;
         mailboxes: { address: email; dailyCap: number /*10..50*/; warmupStartedOn: string | null /*YYYY-MM-DD*/ }[] /*≤20*/ }
// start.secrets gains (optional):
mail?: { client: { id: string /*1..300*/; secret: string /*1..300*/ }; mailboxes: { address: email; refreshToken: string /*1..2000*/ }[] /*≤20*/ }
aws?: { accessKeyId: string /*[A-Z0-9]{16,128}*/; secretAccessKey: string /*1..200*/ }

// stdout gains:
{ type: "reply"; account: email; conversationKey; channelId: channelId | null; messageId: gmailId; from: string /*≤320*/;
  fromName: string | null /*≤300*/; subject: string /*≤998*/; body: string; bodyCut: boolean; receivedAt: string | null;
  isFirstReply: boolean; cancelledFollowUps: number }
{ type: "result"; kind: "mail.status"; data: { configured: boolean; label: string; senderName: string | null;
    accounts: { account: string | null; connected: boolean;
      counters: { conversations; sent; awaitingReply; replied; pendingSteps; dueSteps; failedSteps; unreportedReplies } | null;
      limits: { dailyCap; warmupStartedOn: string | null; sentToday; leftToday } | null;
      lastSweepAt: string | null; error: { code: "mail_auth" | "mail_api" | "network"; message } | null }[] } }
{ type: "result"; kind: "mail.send"; data: { duplicate: boolean; account: email; conversationKey; messageId: gmailId;
    threadId: gmailId | null; rfcMessageId: string | null /*≤998*/; labelled: boolean; threaded: boolean; to: email;
    subject: string | null; sentAt: string } }
{ type: "result"; kind: "mail.replies"; data: { accounts: { account: email; checked; replies; cancelledQueued;
    error: { code: "mail_auth" | "mail_api" | "network"; message } | null }[] } }
{ type: "result"; kind: "mail.ack"; data: { acknowledged } }
{ type: "result"; kind: "mail.cancel"; data: { cancelled; closed: boolean } }
{ type: "result"; kind: "video_stats"; data: { videoId: string /*11*/; views: size; fetchedAt: string } }
{ type: "result"; kind: "refetch"; data: { processed; swept; deferred; failedCount; failed: string[] /*≤200 handles*/ } }
{ type: "result"; kind: "backfill"; data: { channels: { targets; filled } | null; videos: { targets; filled } | null;
    backfill: { channels; saved } | null; backlog: { stamped } | null; apiCalls; budgetReached: boolean } }
{ type: "result"; kind: "gateways.deploy"; data: { deployed: { region; apiId; url }[]; failed: { region; message }[] } }
{ type: "result"; kind: "gateways.destroy"; data: { deleted: { region; apiId }[]; failed: { region; apiId; message }[] } }
{ type: "result"; kind: "gateways.test"; data: { results: { region: region | null; status: number | null; ok: boolean; message: string | null }[] } }
// end.error.code gains: "mail_not_connected" | "mail_auth" | "mail_api" | "daily_cap_reached" | "send_uncertain"
//                       | "not_a_video" | "not_found" | "no_aws_keys" | "aws"
// (numbers not typed above are `count`; messages are 1..500, cut by the Emitter)
```

Python side, written by C1 for the others to use: `protocol.Job` (union of TypedDicts), `Emitter.result(kind, data)`, `Emitter.reply(...)`, `jobs.run(start, emitter)` dispatching on `kind` (each job module exports `run(start: Start, emitter: Emitter) -> None` and always ends with `end`), `net.allow_job_hosts(kind)`.

Mail error mapping (jobs/mail.py): no client or no mailbox in `secrets.mail` → `mail_not_connected` (`mail.status` reports `configured: false` instead); the named mailbox not connected → `mail_not_connected`; two or more connected and none named for `mail.send` → `bad_start`; token refused (`invalid_grant`, `invalid_client`, 401) → `mail_auth` (message as the old `_describe_auth_failure`, without the CLI command); other Gmail refusals → `mail_api`; unreachable → `network`; the cap → `daily_cap_reached`; a claimed key never confirmed → `send_uncertain`; a bad address → `bad_start`. `mail.ack` and `mail.cancel` need no secrets and make no request.

#### Tasks

| id | tier | depends | files | spec | done_check |
|---|---|---|---|---|---|
| C1 | H | – | `main/pipeline/protocol.ts` + `protocol.test.ts`, `protocol.schema.json`, `protocol.py`, `config.py`, `net.py`, `__main__.py`, `jobs/__init__.py`, stub `jobs/{mail,video_stats,refetch,backfill,gateways}.py`, `tests/test_protocol.py`, `tests/test_net.py`, `tests/test_config.py` | The contracts above on both sides; D15, D16, D20; stubs end `failed`/`crash` "not built yet" | Vitest, pytest, pyright, ruff; schema file equals the script's output |
| C2a | N | C1 | `mail/__init__.py`, `mail/gmail.py`, `tests/test_gmail.py` | D17's transport through a fake opener; the old parsing helpers and their tests (MessageParsingTest) | pytest, pyright, ruff |
| C2b | N | C1 | `mail/mailbox.py`, `tests/test_mailbox.py` | The old store, typed; `approved_by`; the store halves of test_mailbox (Sequence, Threading, ReplyReporting, Counters, SendKey store parts) | pytest |
| C2c | H | C2a, C2b | `jobs/mail.py`, `tests/test_mail_jobs.py`, `tests/test_email_send_no_auto_send.py` | The five jobs on a fake client (ToolSweep, SendKey, DailyCap, NoAutomaticSend ported); every line checked against the schema; a test that no request is made without a send job | pytest |
| C3 | N | C1 | `jobs/video_stats.py`, `tests/test_video_stats.py` | The old tool as a job; `video_id_from` kept; one `videos.list` call; codes per the contract | pytest |
| C4a | N | C1 | `jobs/refetch.py`, `youtube.py` (`channel_for_handle`), `tests/test_refetch_job.py`, `tests/test_youtube.py` | D18; fakes local to the test file | pytest |
| C4b | N | C1 | `jobs/backfill.py`, `store.py` (enrich's queries), `tests/test_enrich_job.py` | D18; budget and stop as the old tool | pytest |
| C5a | H | – | `aws_sign.py`, `tests/test_aws_sign.py` | SigV4 over plain dicts; AWS's published IAM ListUsers example as a test; no secret in any error | pytest |
| C5b | N | C1, C5a | `jobs/gateways.py`, `tests/test_gateways_job.py` | D19 against a fake transport | pytest |
| C6 | H | C1 | `main/pipeline/supervisor.ts` (+test: `result` and `reply` passed on, `ended` carries the result), `main/pipeline/logs.ts` (+test), `main/pipeline/pipeline-secrets.ts` (+test), `main/pipeline/jobs.ts` (+test: `laneFor`, `runJob`), `main/index.ts` (the second supervisor and its shutdown), `find/find-service.ts` (reads the new `pipeline.gateways` shape) | D14, D19 (main's half), D21 | Vitest, typecheck, lint |
| C7 | E | all | `docs/decisions/0015-pipeline-mail-and-jobs.md`, `services/pipeline/README.md`, `docs/architecture.md`, `docs/migration-plan.md`, `.router/PROGRESS.md` | D14 to D21 as an ADR; the status table | read through |
| L1 | lead | all | – | Full checks; `router-reviewer` on the diff; fixes; PR, CI green, merge | all green |

Parallel after C1: C2a, C2b, C3, C4a, C4b, C5a and C6 share no files. Only C1 edits `fakes.py`, `conftest.py` or `helpers.py`; the others keep their fakes in their own test file.

## Questions for the owner (answered 2026-10-21)

1. **Split:** three pull requests were proposed. **Answer: two.** 3e-3a the bridge and comms, 3e-3b mail and the rest.
2. **The comms quality tools** (coach, graduate bar, pairwise judge, scenarios, call mining, quote review, Whisper check): port them, or leave them in `legacy/` until they're deleted in step 11? Recommended: port them, under `comms/studio/`, as tools a session runs by hand (the app never calls them). They are how the "graduate bar" is measured. **Answer: port them.**
3. **The course text for the copy check** lives only on your PC. (a) The app reads your course folder from a path in Settings; on a machine without it, that one check is skipped and the draft says so. (b) Commit a fingerprint file: a hash of every 8-word run, not the text, so the check works on every machine and in CI. Recommended: (b). **Answer: (a), the folder path in Settings** (D8).
4. **News and the Email library** are "Decide" rows (parity §6, step 9 at the latest). Port their pipeline half now, or wait for the decision? Recommended: wait. **Answer: wait.** `feeds.py`, `news.py` and `email_library.py` aren't ported in 3e-3.
