# Progress: step 3b

| id | tier used | state | files | note |
|---|---|---|---|---|
| T0 | H (self) | done | `apps/desktop/package.json`, tsconfigs, lockfile | `@gratovo/ipc`, `@electron/fuses` 2.1.3, `zod` added; references to `packages/ipc` |
| T1 | H (self) | done | `packages/ipc/src/{bridge,dispatch,channels,index}.ts`, tests | `secretName`, `secrets:status`, `Bridge`, `createDispatcher`; `parseRequest` needed a commented assertion once there were two channels |
| T2 | N | done | `src/main/secret-store.ts`, test | 25 tests; checked by me |
| T3 | N | done | `src/main/app-files.ts`, `external-links.ts`, tests | I added the backslash refusal so the answer is the same on every system |
| T4 | N | done | `scripts/release-fuses.ts`, `e2e/fuses.spec.ts` | passes locally (no Electron launch) |
| T5 | N | done | `.github/workflows/ci.yml`, `.github/codeql/codeql-config.yml`, `.github/dependabot.yml` | actionlint clean |
| T6 | H (self) | done | `src/main/*`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `electron.vite.config.ts` | preload builds to 0.42 kB CommonJS, no zod |
| T7 | H (self) | done | `e2e/fixtures.ts`, `smoke.spec.ts`, `security.spec.ts` | not yet run: Windows CI |
| T8 | | next | | run CI on the branch with workflow_dispatch; fix what fails |
| T9 | | | | docs |
| T10 | | | | review, PR, merge |

Local checks after T7: `pnpm lint`, `pnpm typecheck`, `pnpm test` (120 Vitest, 1 pytest) pass.
