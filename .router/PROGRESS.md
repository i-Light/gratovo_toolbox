# Progress: step 3a

| Task | Status | Note |
|---|---|---|
| T1 root workspace and pins | done | pnpm 12 settings in pnpm-workspace.yaml (it ignores .npmrc); minimumReleaseAge one day (it refused postcss 8.5.31, so 8.5.30) |
| T2 packages/core DEAL_FLOW | done | 5 tests; the parity test fails if a step changes on either side (mutation checked) |
| T3 packages/ui tokens | done | 11 tests via postcss; parity mutation checked |
| T4 packages/ipc | done | 7 tests; refuses inherited names like `__proto__` |
| T5 apps/desktop shell | done | Electron 44 has no getLastWebPreferences: the sandbox is checked through app metrics on Windows and macOS. Chromium refuses root with the forced sandbox, so local e2e runs as `nobody` (setpriv). Playwright overrides nativeTheme, so dark is tested with emulateMedia and data-theme |
| T6 lint, format, test config | done | planted a11y, hooks and floating-promise errors all reported under ESLint 10 |
| T7 Python project | done | Python 3.14, uv 0.13.1, pytest 9 native TOML config |
| T8 hooks | done | planted fake key blocked; a badly formatted staged file fixed |
| T9 CI | written, actionlint clean | runs on the pull request |
| T10 docs | done | architecture versions, ADR 0007, plan status, handoff, README, CLAUDE.md commands, apps/desktop README |

## Open

- Fresh-clone run of the whole check list.
- Reviewer agent on the diff, then fixes.
- CI green on the pull request (Ubuntu and Windows).
