# Progress: step 3e (the Python pipeline)

Started 2026-10-21 on branch `feat/3e-pipeline`, from `main` at c66858c (3d-2b merged as #12; its progress record is in git history at c66858c). `CONTEXT.md` is the 3e recon; `PLAN.md` the 3e plan: three pull requests, 3e-1 in full (P1 to P14, L1), 3e-2 and 3e-3 outlined.

Owner answers (2026-10-21): **three pull requests** (3e-1 search on this computer, 3e-2 R2 sharing, 3e-3 the rest with tests); **proxies, AWS gateway rotation and parallel search stay**.

Carried from 3d-2b: an `r2-access` call with a real member's token and a presigned list against the real bucket (3e-2); the packaged build must ship `@supabase/realtime-js` with main (3h); the two known sync limits in ADR 0012.

| Task | Tier | Commit | Note |
|---|---|---|---|
| Recon | lead | (this commit) | `.router/CONTEXT.md`. The lead did it (the owner asked for fewer agents) |
| Plan | lead | 18d5750 | `.router/PLAN.md` |
| P1 | lead | d4086e6 | Zod schemas in `main/pipeline/protocol.ts`; the JSON Schema is kept current by a Vitest file snapshot (`pnpm pipeline:schema` rewrites it), not a Node script: plain Node can't resolve the extensionless imports |
| P2 | lead | 6a39b10 | `protocol.py` (hand-written start check, Emitter, stop listener), the socket guard, `tests/helpers.py`. curl_cffi 0.16.3; jsonschema 4.26.0 and types-jsonschema as dev |
| P3+P4 | lead | fc06296 | `config.py` from the start line (the owner's settings.json as defaults, frozen dataclasses), `run_control.py`, `parallel.py` without `LineWriter` (the Emitter's lock keeps lines whole). Proxy URLs with no switch sent count as on. 73 pytest |

Skills: the owner asked (2026-10-21) to find and use every skill that helps. Installed for the user (reviewed first): `trailofbits/skills@modern-python`, `astral-sh/claude-code-plugins@uv`, `wshobson/agents@python-testing-patterns`. Their `ty` and coverage-threshold advice is not taken: pyright strict is pinned (ADR 0007). TDD throughout: each old test is ported first and seen to fail.

| P5 | lead | fcbf9a4 | `store.py`: the old schema folded into version 1 (`user_version`; a newer file is refused), every search and R2 function typed; news, transcripts and the enrichment queries wait for 3e-3, the old-database hand-over (`reclaim_pre_catalog_rows`) and the Flutter app's sort indexes are dropped. One per-file S608 ignore (placeholders only). The old test_archive, test_run_reconcile and test_video_backfill (store half) ported, plus frozen-number, WAL, version and rollup tests. 127 pytest |
| P6 | lead | cc3d547 | `net.check_url` (HTTPS only, YouTube, Google API and AWS gateway hosts, no login in the URL; the error names the host, never the URL). `scrapetube/proxy_pool.py`: proxies and gateways come as URLs from the start message secrets; least recently used, never twice in a row, a minimum gap, one request at a time, cooldowns; labels are the host, never the login. `scrapetube/scrapetube.py` on curl_cffi with a typed `Session` protocol; every attempt passes `check_url`; the skip-wait file became `request_skip_wait()`; the old `[route]` and `[backoff]` print lines go to a log sink. 199 pytest |
| P7 | lead | (this commit) | `youtube.py`: `YouTubeApi(key).channels({handle: id})` and `.videos(ids)`, 50 a call, over urllib; the key as an unredirected `X-Goog-Api-Key` header on an opener that ignores proxy settings and follows no redirect. Failures: quota reasons end the run as `quota`, a refused key (invalid, expired, restricted, API off) as `no_youtube_key` (the plan said `blocked`; that code stays scrapetube's), 5xx, rate limits and network errors retried twice then `network` (or `quota` for rate limits); any other refusal fails only the batch, as before. Messages carry a reason word at most, never Google's text or the key. Missing banner is now None, not "No Banner". 225 pytest |

Next: P8 (`search/*.py`: `process_keyword` and its helpers, with the auto-clean, sponsorship, found-emails and backfill tests).
