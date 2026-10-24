# 0015. The pipeline's mail and the remaining jobs

- **Date:** 2026-10-23
- **Status:** accepted for step 3e-3b (mail, video stats, refetch, backfill and the AWS gateways). It records the decisions of the plan (`.router/PLAN.md`, D14 to D21), with the changes the build made. It amends ADR 0013 §2 (one job at a time), and builds on ADR 0013 and ADR 0014, which still stand.

## Context

Step 3e-3b ports the rest of the old pipeline. That is the mail (Gmail, the mailbox file, the send and reply jobs), the video stats report, the refetch of handles and the backfill (the catch-up work of `enrich.py`), and the AWS gateways. The search (ADR 0013) and the bridge (ADR 0014) stay as they are.

Two things are new. A send must not wait for a search that runs for hours. And the jobs need more secrets: a Gmail client, refresh tokens and AWS keys. The rules of ADR 0013 still hold. Each job runs in a bare environment, every line is checked against one schema on both sides, and Python checks its own network requests.

## Decision

1. **Two lanes in main.** Main keeps two supervisors. The **store lane** runs `search`, `refetch` and `backfill`. They write `pipeline.db`, so never two at once. The **quick lane** runs `mail.*`, `video_stats` and `gateways.*`, one at a time, so `mailbox.db` has one writer. `laneFor(kind)` picks the lane. Both lanes stop on quit. The quick lane logs to `<userData>/logs/quick-<stamp>.log`.
   *Why:* a Send must not wait for a search. Each lane keeps the one-writer rule for the file it owns. This amends ADR 0013 §2, which ran one job at a time.

2. **One envelope for every kind.** `start` keeps its shape, and `job` is a union on `kind`. `secrets.youtubeKey`, `proxyUrls` and `gatewayUrls` stay required (null or `[]` when a job needs none). Every kind except `search` needs `source: "live"`. `source: "example"` with any other kind is `bad_start`, because the example data has no mail, no keys and no AWS. For every kind except `search`, `end.at`, `found` and `kept` are 0. The answer is in `result`. `Config.from_start` builds for every kind: the search fields are neutral for the others, and refetch's `autoClean` feeds `auto_clean`.
   *Why:* one reader for the start line keeps main and Python in step. The search's counts don't fit the other jobs, so their answer gets its own line.

3. **`result` and `reply` lines.**
   - `result` is `{type: "result", kind, data}`, the job's answer. It comes at most once, before `end`. It is always sent on `done`. On `stopped` it is sent for `refetch` and `backfill` only, with the partial counts. It is never sent on `failed`. Main enforces this too: a result the end doesn't allow is noted in the log (without its text) and left out of `ended.result`.
   - `reply` is one line per reply a sweep finds. A body is cut to 16,000 characters. If the line is still too long, the body is halved until it fits, and `bodyCut: true` says so. The line is measured in UTF-8 bytes.
   *Why:* a sweep's bodies would pass the 64 KiB line limit of ADR 0013 §3 if they went in one line.

4. **Mail (amends plan D9).** Three modules do the work.
   - `mail/gmail.py` calls Gmail with `urllib` only. It refreshes the token at `oauth2.googleapis.com/token` and calls `gmail.googleapis.com/gmail/v1/users/me/…`. It follows no redirects, uses no proxy and waits at most 30 s. It retries 429 and 5xx responses and an unreachable host, four tries in all, with backoff and jitter. **A send is the exception:** it is retried on 429 alone, because after a 5xx or a lost answer Gmail may already have the message, and a second POST would send it twice. Such a send ends `mail_api` or `network` with a message saying it may have gone out. A request that never went out (urllib's `URLError`: connect, DNS, TLS) is safe to retry even for a send. If it still fails, the send ends `network` saying nothing was sent, and its key is freed. The access token lives only in memory and only in the `Authorization` header. A message over the size limit is `bad_start`. If the read-back of the RFC message id fails after a send, `rfcMessageId` is null. The send still counts, and nothing is raised or sent twice.
   - `mail/mailbox.py` is the old store with the same tables, so an old `mailbox.db` opens unchanged. It adds `approved_by` to `sent_messages` and `send_keys`, and `checked_at` to `conversations`, by a guarded `ALTER`, and sets `user_version` to 1. A file from a newer version is refused (`MailboxTooNewError`). The file is `<dataDir>/mailbox.db`, and main passes `<userData>/mail` as `dataDir`. Each machine has its own file.
   - `jobs/mail.py` runs the five jobs. `mail.send` needs `sendKey` and `approvedBy`. The schema refuses a send without them, so the old "no key" path is gone. A test shows that no request is made without a send job.
   - **Replies.** `mail.replies` checks the named mailbox, or every connected one. A mailbox that fails is reported in its own entry, and the rest go on. A reply stays unreported until `mail.ack`, so it is offered again on each sweep. The old sweep lost replies once a conversation closed. `isFirstReply` is true for the conversation's earliest reply. A sweep asks about the conversations waiting on the other side: nothing has come back yet, or the team wrote again after the last reply seen. So a creator's second answer is found too. A reply no longer closes the conversation, and a send reopens a closed one. Only a send through the app counts as writing again: a reply the team writes in Gmail itself doesn't put the conversation back in the sweep, so the creator's next answer is found only by asking about that conversation by name. The sweep takes the least recently checked first (`checked_at`), so its limit of 60 rotates through every conversation instead of asking about the oldest 60 each time. A sweep cancels queued follow-ups from an old file and never sends them.
   - **Send keys.** The key is kept when a send may have gone out (a dropped network, a 5xx, an unreadable answer, an unexpected error), so a retry comes back as `send_uncertain`. The key is freed only on a clear refusal. A repeated `sendKey` reports `duplicate`, with `labelled` and `threaded` false. An empty subject doesn't blank the stored one.
   - **Errors.** No client or no mailbox gives `mail_not_connected`, and `mail.status` reports `configured: false` instead. A refused token gives `mail_auth`. Other Gmail refusals give `mail_api`. An unreachable Gmail gives `network`. The daily cap gives `daily_cap_reached`. A key that was never confirmed gives `send_uncertain`. A bad address gives `bad_start`, and so does a line break of any kind (each one `str.splitlines` knows) in the subject or the sender name (both schemas refuse it; the Gmail module refuses it again before anything is sent). Two or more connected mailboxes with none named for a send also give `bad_start`.
   - **Not ported:** `--authorize` and `--sign-out` (consent moves to main, step 6), `--pending` (nothing queues any more), `--test-send` (step 9 decides; the Settings card can use `mail.send` to the mailbox's own address), the `replyTo` header, `--dry-run` and `--ack-now` (replies are acknowledged only by `mail.ack`).
   *Why:* the owner's rule is that nothing is sent without approval, and no session reads the connected mailbox. The old file keeps the mail history. The key rule stops a second send after a dropped connection.

5. **Video stats, refetch and backfill (amends plan D11).**
   - `video_stats` is the old tool as a job. It makes one `videos.list` call and keeps `video_id_from`. YouTube's error codes pass through. A view count that isn't a decimal number is `not_found`.
   - `refetch` is the old `run_manual_refetch`. Reading the import file stays in main, which sends the parsed handles. Each handle is emitted as a `channel` line with the job's keyword (default `__manual_refetch__`), so a screen can show it live. `YouTubeApi.channel_for_handle` calls `channels.list?forHandle=`. An unknown handle costs one API call, and its details are saved. A sweep archives with `found_via` limit 0.
   - `backfill` ports `enrich.py`'s three jobs (channels, videos and backfill) without the report and without the sync. It adds `backlog`, the old catch-up button: 3e-1's `backfill_missing_videos` run over the whole store. Run kinds are `re-enrich` for the three enrich jobs and `catch-up` while `backlog` runs. `backlog` is not budgeted. `budgetReached` is true only when the ceiling refused a batch. Signals are derived after the stamp.
   - **The sweep's `limit`.** The sweep takes a `limit`. The search keeps 15 per keyword, as before, and the gap search-1 stays on hold for the owner. Backfill asks for up to 200, as the old tool did. `maxApiCalls` defaults to 100, and 0 means no ceiling. A stop ends as `stopped`, with what was saved.
   *Why:* these are the old tools' rules, moved as they were. The search's limit is left alone because the owner has the question on hold.

6. **Gateways (amends plan D11).** `list`, `enable` and `disable` only change main's stored state, so they stay in main. Python runs three jobs. `gateways.deploy` takes regions, `gateways.destroy` takes `{region, apiId}` pairs, and `gateways.test` calls each URL in `secrets.gatewayUrls` with `GET <url>/generate_204`, which is `ok` when the status is below 500.
   - Deploy and destroy call API Gateway v2 on `apigateway.<region>.amazonaws.com`: `POST /v2/apis`, `/v2/apis/{id}/integrations`, `/routes` and `/stages`, and `DELETE /v2/apis/{id}`. Each request is signed by `aws_sign.py` (SigV4, service `apigateway`). No boto3 is used, and STS isn't needed. The signer keeps both keys out of `repr`, sends no session token, and puts no secret in an error.
   - One region failing doesn't stop the others. A half-built API is deleted, on a best-effort basis. AWS ids are checked before they go into a URL.
   - Deploy ends `aws` only when nothing was deployed and every failure was an auth refusal, and then it sends no `result`.
   - `pipeline.gateways` becomes `{enabled, gateways: [{region, apiId, url}]}`. The old plain list is still read, as enabled with no api ids. A region deployed again keeps its old entry, because that API still runs in AWS and its id is the only way `gateways.destroy` can remove it. Past the cap of 100, the oldest entries with no id go first. If that isn't enough, the merge is refused rather than forget an id, so step 9 must check there is room before a deploy.
   *Why:* the job makes five kinds of call, so one signer module is enough and the packaged app doesn't need a large AWS library. A region's failure must not block the rest.

7. **The network rule per job (amends ADR 0013 §5).** The entry point calls `net.allow_job_hosts(kind)` once, before the job runs, and it replaces the job's list rather than adding to it. `mail.*` adds `gmail.googleapis.com` and `oauth2.googleapis.com`. `gateways.*` adds `apigateway.<region>.amazonaws.com`. Every other job keeps the list from ADR 0013 §5.
   *Why:* each job reaches only the hosts it needs, so a bug in one job can't reach another job's hosts.

8. **Secrets in main (amends ADR 0013 §4).**
   - `mail.client` (`{id, secret}`), `mail.mailboxes` (`[{address, refreshToken}]`) and `aws.keys` (`{accessKeyId, secretAccessKey}`) are JSON in the secret store. `pipeline-secrets.ts` reads them and checks their shape. Bad JSON or a wrong shape counts as missing, and main logs only the name.
   - `start.settings.mail` holds the label, the sender name and each mailbox's daily cap (10 to 50) and warm-up date. `start.secrets.mail` and `start.secrets.aws` carry the keys above. Every connected mailbox must be listed in `start.settings.mail.mailboxes` (both schemas refuse a start otherwise), because the jobs read each mailbox's address from there and take only its token from the secrets. So the address that result and reply lines report never comes out of the secrets, and CodeQL can check that nothing from the secrets reaches stdout.
   - `secretsOf` blanks the client secret, each refresh token, both AWS keys and each gateway's `apiId` in any line main logs or shows. A deploy's `result` is merged into `pipeline.gateways` and is never logged.
   - Result and reply text are never logged, not even on a bad line, because reply bodies are people's mail.
   *Why:* the same rule as ADR 0013 §4. A secret is blanked before it can reach a log, and a bad secret is treated as missing, never as a value.

## Consequences

- No screen calls these jobs yet. The screens and IPC arrive in steps 6 to 9. Until a mailbox is connected, `mail.status` reports `configured: false`.
- The consent flow that connects a mailbox is step 6.
- The Settings rows for the caps, the label, the sender name, the AWS keys and the gateways are step 9.
- A test email is a `mail.send` to the mailbox's own address.
- Deno (for subtitles, ADR 0014) and the packaged Python come in step 3h.
- The tests use a fake Gmail client and a fake AWS transport. No test reaches the network, and the socket guard fails any test that tries.
- `protocol.schema.json` is written from the zod schemas. A stale file fails the Vitest snapshot, and pytest checks every captured line against the file.
- No live check of Gmail or AWS was run in this step. Such a check needs the owner's go.
