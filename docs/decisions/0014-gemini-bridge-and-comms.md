# 0014. The Gemini bridge and the comms engine

- **Date:** 2026-10-23
- **Status:** accepted for step 3e-3a. It records the bridge and comms decisions of the plan (`.router/PLAN.md`, D1 to D8, D10 and D12), with the changes the build made. Step 3e-3b (mail, video stats, refetch, backfill and the AWS gateways) gets its own record when it lands. It builds on ADR 0013, which still stands.

## Context

The old app ran two long-lived things beside its search: a Gemini bridge (`legacy/pipeline/gemini_bridge/`, a daemon that drove a signed-in Gemini web page through a browser add-on) and a comms engine (`legacy/pipeline/comms/`, the playbook and the checks that every drafted message must pass). It also had a set of tools a person ran by hand to measure and tune the comms work.

Step 3e-3a ports both into `services/pipeline/`. The bridge becomes one process that main starts and stops. The comms engine runs in the pipeline and reads only what the app sends it, plus the channels and videos the pipeline owns. The course text stays on the owner's computer.

## Decision

1. **One bridge process, at most one.** Main starts `<python> -I -u -m gratovo_pipeline.gemini --port 8765 --data-dir … --profile-dir … --extension-dir …`, and adds `--course-dir` and `--video-dir` when this computer has them. The environment is bare, as in ADR 0013, and the process needs no secrets. It listens on port 8765 and says `listening` on its first line. A second start is refused while one runs, and a port that is taken ends the start as `port_in_use`.
   *Why:* the owner's rule is one bridge, on one port. The browser add-on connects to the bridge, not the other way round, so the bridge has to stay up for that connection to exist (DAEMON.md).
1a. **Only the add-on may connect, never a web page.** Listening on 127.0.0.1 keeps other computers out, but not the pages open in the person's browser: any of them can open `ws://127.0.0.1:8765`. The bridge refuses every WebSocket handshake whose `Origin` is a web page (`http://`, `https://`, `null`). It lets in an add-on (`moz-extension://`, `chrome-extension://`) and a program on this computer, which sends no `Origin`.
   *Why:* a page that got in would read every prompt (creators, brands, threads) and could send back answers that look like Gemini's. The old bridge accepted any origin; the review of 3e-3a found it. A program on this computer could reach the bridge anyway. Step 6 can add a token the add-on must show, if the owner wants more.
2. **Answers are matched by id.** A request has an `id`. Its answer carries the same `id`, and answers may come out of order. Events (`event` lines) are not answers.
   *Why:* two calls can be in flight at once, and a slow call must not hold up a fast one.
   Main waits for each call as long as the bridge itself may take, plus 30 s, so the bridge's own answer (which says what stalled) comes first: the call's `timeoutS` (a draft carries it in its `request`), or the bridge's default for the method (`bridge.ask` 240 s, a keyword batch 240 s per chat, a draft three times its timeout plus the subtitle read). Calls that use the Gemini page wait their turn behind each other in the bridge, so a call queued behind a long one can time out in main while it still waits.
3. **Every line is checked.** The bridge checks each request it reads. Main checks each line it reads and each typed result against `gemini-protocol.ts` and `gemini.schema.json`. A line that fails its check is logged (its first 200 characters) and ignored. A result that fails its method's schema counts as `INTERNAL`. Three bad lines in a row end the bridge.
   *Why:* the same rule as ADR 0013 §3. Nothing is trusted because it came from our own process.
4. **Stop by closing stdin.** End of stdin stops the bridge. `bridge.shutdown` does the same. On app quit main closes stdin and kills the process 5 s later if it has not ended.
   *Why:* closing the pipe is the one stop that always works, even when the bridge is stuck.
5. **Logs.** The bridge's output goes to `<userData>/logs/gemini-<stamp>.log`, with the same rule as the job logs: newest 40 kept, and no secret in a line.
6. **The wire is the old DAEMON.md, minus the drafting actions.** The methods are `bridge.*` (status, browser info, ensure window, install add-on, ask, shutdown) and `action.*` (keywords, channel classification, gems, skills, comms). The old drafting actions are not ported. A test (`test_old_drafting_removed`) keeps them out.
   *Why:* drafting now runs through the comms engine. Two paths to a draft would drift apart.
7. **Every error code is listed once.** Every error code that Python can raise is in main's code list (`gemini-protocol.ts`), and a test compares the two lists. That includes the extension's own codes and the engine's `WRONG_CHAT`.
   *Why:* a code main does not know would reach the page as an unknown string.
8. **The extension comes in step 6.** Until then, `bridge.browser_info` reports the add-on as `missing`. `ensure_window` fails with `ADDON_INSTALL_FAILED` (reason: no extension), and installing fails cleanly. The browser profile moves from `%LOCALAPPDATA%\gratovo\gemini-profile` to `<userData>/gemini-profile`.
   *Why:* the bridge can be built and tested before its browser part exists, and nothing pretends the add-on is there.
9. **Tests reach 127.0.0.1 only, and only on purpose.** The socket guard in `conftest.py` refuses every connection, except to `127.0.0.1` and `::1` when a test asks for the opt-in `loopback` fixture. Only the bridge's tests use it, to talk to a fake extension.
   *Why:* the bridge's tests need a real socket. Everything else still stays off the network.
10. **The pipeline never reads the app's database.** For drafts, main reads its own tables and sends the app's side of the case as `facts` in the request. Python reads only `channels` and `videos` from its own `pipeline.db`, and writes only `video_transcripts`. A check opens `pipeline.db` read-only, so it never waits on a running search; a draft upgrades the file only when no search has yet.
    *Why:* the app's data is the app's. Python sees only what main chooses to send, and the case rules are kept on plain data.
11. **`pipeline.db` version 2.** It adds `video_transcripts`, keyed by video id, through `PRAGMA user_version`. A version 1 file is upgraded on open, and a file from a newer version is refused, as in ADR 0013 §6.
    *Why:* transcripts are pipeline data. A schema version keeps old and new files apart.
12. **The course text stays on the owner's computer.** It is the owner's choice (2026-10-21). This is about the lessons, call transcripts and video transcripts as a whole. The playbook in the repository has held short verbatim course passages since the old app (each rule's quotes, the reconstructed roast examples, and the passages the Whisper check heard), and it still does: they moved unchanged from `legacy/data/comms/`. The course folder is a path set in Settings (step 9 builds that row) and passed to the bridge as `--course-dir` (and `--video-dir` for the videos). The copy check (FND-WRITE-15, no 8 words in a row copied from the course) needs that text. Without it, the check skips the lessons and videos and adds the finding `COURSE_CHECK_SKIPPED`, a warning that never blocks. The rule quotes and the roast examples are always checked, because they are in the repository. Tests use an invented course about AI creators, never the real one.
    *Why:* the course is the owner's paid material. The repository holds none of it, and CI still tests the check.
13. **The comms quality tools are run by hand.** Coach, graduate bar, pairwise, scenarios, call mining, pool, quote review, the Whisper check, verify and skill build are ported as tools a person runs with `python -m gratovo_pipeline.comms.<tool>`. They are not called from the app. They take `--course-dir` (and `--video-dir`), or `GRATOVO_COURSE_DIR` and `GRATOVO_VIDEO_DIR`. Without the course they stop with one line that names the flag and the variable.
    *Why:* the owner chose this. The tools measure and tune the comms work. They are not part of a draft.
14. **Subtitles through yt-dlp, the recorded exception.** `transcript.py` runs yt-dlp as a module of the pipeline's own Python, with `--ignore-config`, `--no-cache-dir` and no plugins. It is called only on a watch URL built from a video id that has passed a check (11 characters, the allowed set). It is stopped after 120 s. Without Deno, yt-dlp does not run, and the video is read again once Deno is there.
    *Why:* yt-dlp makes its own requests, so the pipeline's network rule (ADR 0013 §5) can't check them. The exception is kept small: a fixed command, a checked id, no config and a time limit. It is the only such exception.
15. **Not ported:** the bridge's own command line (`cli.py`), `derive_signals.py`, `get_subtitles.py`, `firefox_smoke.py` and the add-on build tests. The add-on build tests come with step 6. News (`feeds.py`, `news.py`) and the Email library (`email_library.py`) wait for their parity decision (step 9), as the owner chose.
16. **Two old bugs fixed on the way.** Both change behaviour, and both are fixed on purpose:
    - The opener check held backspace characters where it meant word boundaries, so "my name is", "I run an agency" and "just reaching out" never matched. They match now.
    - The "50k" rule in verify wrote an octal escape, so "50k" never equalled "50000". It equals it now.

## Alternatives considered

- **One bridge per request, as the jobs are:** the add-on would lose its connection between calls and have to find the bridge again each time. One long-lived process keeps it connected.
- **Drafting actions kept beside the comms engine:** two paths to one draft would drift apart. The old drafting actions are left out (decision 6).
- **Course text in the repository:** it is the owner's material and it is not ours to publish. The check runs without it and says so (decision 12).
- **Calling the quality tools from the app:** the owner chose tools a person runs by hand (decision 13).
- **Python reading `gratovo.db`:** that would give the pipeline the app's whole database. The app sends only the facts a draft needs (decision 10).

## Consequences

- The shipped `gratovo-comms` skill in `services/pipeline/data/comms/skill/` is older than the playbook. A fresh build differs from it in five reference files. Rebuild it with `python -m gratovo_pipeline.comms.skill_build --course-dir <folder>`, then deploy it.
- `verify` on the owner's course reports 41 video quotes that still wait for a person to check them by ear. The data itself ported faithfully: the old `verify` reports the same 41, plus one more caused by the octal bug above.
- Step 3h must package Deno and `yt-dlp-ejs` (yt-dlp's player-code solver) with the app. Until then subtitles can't be read: without Deno the read is skipped, the draft goes on without a personal line, and the video is read again once Deno is there.
- Nothing starts the bridge yet. Keyword ideas (step 5) and drafts (step 6) will start it.
- The bridge reads the `pipeline.db` of the data it was started with. When step 6 starts it, a switch between example and live data must restart it (or pass the folder per call), or drafts would read the other data's channels.
- Until step 6 the add-on is missing, so no Gemini answer can come back from a real browser. Tests use the fake extension.
- A change to the bridge's messages means changing `gemini-protocol.ts`, `gemini.schema.json` and the Python code together. The tests fail until all three match.
