# Plan: step 3e-3, the rest of the Python pipeline

Written 2026-10-21 by the lead (Opus) on branch `feat/3e-3-pipeline-rest`, from `main` at 11b3c7a. 3e-1's plan is in git history at dc13dd5; its decisions are ADR 0013, and this plan builds on them without changing them. 3e-2 (R2) is step T1: nothing here touches `r2.py`, `sync.py` or team work.

Read `.router/CONTEXT.md` §1 to §3 first (3e-1's recon, still true), then this. Bash commands start with `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";`. **Never read `.env*`, `*.local.json`, `aws_gateways.json` or `gmail_accounts*`**, and never read, print or handle a key or token value. Nothing here touches production Supabase. Never send an email, never read the mailbox, never run two Gemini bridges (port 8765).

**Status: the owner answered on 2026-10-21 (§Questions). Two pull requests: 3e-3a (the Gemini bridge and the comms engine) and 3e-3b (mail and the remaining jobs). Building 3e-3a.**

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

### 3e-3b: mail and the remaining jobs (outline; next session)

C1 (H) the job additions in `protocol.ts` and the Python mirror; C2 (H) `mail/gmail.py` over urllib, `mail/mailbox.py`, `mail/send.py`, test_mailbox and test_email_send_no_auto_send ported, D9's rules; C3 (N) `video_stats` with its tests; C4 (N) `refetch` and `backfill` from 3e-1's store and the old enrich and import_handles; C5 (H) `aws_sign.py` and `gateways`; C6 (N) main's handling of `result` and the secret-store keys of D9 and D11; C7 (E) ADR 0015, docs, status; L1.

## Questions for the owner (answered 2026-10-21)

1. **Split:** three pull requests were proposed. **Answer: two.** 3e-3a the bridge and comms, 3e-3b mail and the rest.
2. **The comms quality tools** (coach, graduate bar, pairwise judge, scenarios, call mining, quote review, Whisper check): port them, or leave them in `legacy/` until they're deleted in step 11? Recommended: port them, under `comms/studio/`, as tools a session runs by hand (the app never calls them). They are how the "graduate bar" is measured. **Answer: port them.**
3. **The course text for the copy check** lives only on your PC. (a) The app reads your course folder from a path in Settings; on a machine without it, that one check is skipped and the draft says so. (b) Commit a fingerprint file: a hash of every 8-word run, not the text, so the check works on every machine and in CI. Recommended: (b). **Answer: (a), the folder path in Settings** (D8).
4. **News and the Email library** are "Decide" rows (parity §6, step 9 at the latest). Port their pipeline half now, or wait for the decision? Recommended: wait. **Answer: wait.** `feeds.py`, `news.py` and `email_library.py` aren't ported in 3e-3.
