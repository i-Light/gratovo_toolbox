# Progress: step 7 part 2, prototype mode and the comment tool

Branch `feat/7-prototype-mode`. Plan: `.router/PLAN.md`. Facts: `.router/CONTEXT.md`.

| Task | Tier | State | Note |
|---|---|---|---|
| TM | N | done | Talent Managers dropped from the plan, ADR 0017 and `design/workbench-v6` (b336c5e) |
| C1 | H (lead) | done | `packages/ipc/src/prototype.ts` and its channels; core `Scenario`, `ExampleHealth`; migration 0005; `findContext().folder` (find service and `pipelineFolder` read it). `handlers.ts` still lacks the nine new handlers (M2) |
| S1 | N | done | `exampleSeed(now, scenario)`; `example-scenarios.ts` for first and broke; tests in core and `packages/ipc/src/prototype.test.ts` |
| U1 | N | done | ~83 new ids (122 distinct); optional `dataUi` prop on `IconBtn` and `PageHead`; settings `Row` defaults to `settings.row.<id>`; `reach` root renamed `reach.page` |
| M1 | H | done | `createPrototype`, comments repo, export, `findRepoRoot`; `openExampleCopy` returns `{ source, db }` (one handle); owner = core `isOwner` on the base frame's `me` |
| M2 | H | done | `withPrototype`, 13 refused channels with the audit, handlers, wiring; turn-on stops a running search |
| M3 | N | done | example health: signed-out mailboxes in mail state; `geminiOffline` makes the drafter `off` and refuses rewrites |
| R1 | N | done | `lib/prototype.ts` store, Settings › Prototype mode, top-bar chip and button, palette entries, strings, CSS |
| R2 | N | done | comment layer in `renderer/prototype/` |
| T1 | N | done | `e2e/prototype.spec.ts`; full Electron suite 83 passed; fixed: menus while commenting; helpers deduped |
| D1 | lead | done | ADR 0019, plan status and history, architecture, ADR 0004 status, `docs/feedback/README.md` |
| V1 | H | next | visual check at 1440 px, then router-reviewer and sentry-security-review |

## Refused while prototype mode is on (D6, lead's list for M2)

`connections:set`, `mail:connect`, `mail:check`, `gateways:deploy`, `gateways:remove`, `import:candidates`, `import:pick`, `import:dry-run`, `import:run`, `reach:send-test`, `gemini:start`, `gemini:open-window`. M2 checks every other `reach:*` and `find:*` channel's example path for network or process use and adds any that has one. `presence:set` is ignored while on.
