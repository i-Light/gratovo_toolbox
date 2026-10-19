# Progress: step 3a

| Task | Status | Note |
|---|---|---|
| T1 root workspace and pins | done | pnpm 10.28.0, Node 22.22.0, TypeScript 6.0.3 (not 7: typescript-eslint peer), ESLint 10.13.0 (jsx-a11y peer warning, rules verified) |
| T2 packages/core DEAL_FLOW | done | `key` instead of the prototype's `k`; 3 tests |
| T3 packages/ui tokens | done | copied from prototype lines 11-49 and 609-611, not run through Prettier; 4 tests |
| T4 packages/ipc zod | done | `app:ping` schema; 5 tests |
| T5 apps/desktop shell and smoke | done | secure BrowserWindow, blank frame, Electron e2e passes under xvfb. Deviation: dropped the renderer unit test (the e2e covers it), and no ipc handler yet (3b) |
| T6 quality tooling | done | lefthook runs prettier, eslint, ruff and gitleaks (if installed). Deviation: no lint-staged (17.x needs Node 22.22.1; we pin 22.22.0) |
| T7 services/pipeline | done | hatchling build, ruff strict-ish rule set, pyright strict, pytest placeholder |
| T8 CI | written, not yet run | `.github/workflows/ci.yml`: Ubuntu and Windows checks, secret scan. Needs the push to confirm |
| T9 docs and handoff | done | architecture Versions, ADR 0007, status table, handoff |

## Open
- Confirm CI on the pull request (Ubuntu and Windows). Not run yet.
- Clean-clone run: done, all green (see handoff).
