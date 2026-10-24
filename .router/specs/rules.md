# Rules for every step 5 task

Read first: `CLAUDE.md`, `docs/conventions.md`, `.router/CONTEXT.md` (the code map: don't re-explore what it covers), and the decisions and contracts in `.router/PLAN.md` that your task names. The prototype is the spec for what the page shows: `design/workbench-prototype/js/` (line ranges in CONTEXT.md §7).

**Shell.** Bash commands start with `export PATH="$HOME/.local/opt/node-v24.22.0-win-x64:$HOME/.local/bin:$PATH";` and run from the repository root `/e/IMA work/Code/gratovo_toolbox` (quote the path: it has a space). In Git Bash, `unset ELECTRON_RUN_AS_NODE` before any Electron test.

1. **Edit only your listed files** (and their tests). If something outside them must change, stop and report it. A fixture or fake that fails to compile because of a contract change is in scope; say which.
2. **Git:** never commit, stash, reset, checkout a file or switch branches. Other agents share the working tree. The lead commits.
3. **Contracts are fixed.** Implement the shapes in PLAN.md exactly. If one is wrong or missing something, stop and report it rather than inventing a variant.
4. **Copy the house style.** Comments say why, in plain words, at the density of the file around them. Names follow `docs/conventions.md`. Every user-facing string goes in `apps/desktop/src/renderer/strings.ts` (main's words in `apps/desktop/src/main/strings.ts`). Failures expected in normal use are values, not throws.
5. **Data and examples:** example data is about AI creators and AI sponsors only. Never read `.env*`, `*.local.json`, token or secret files. Never print a secret. Never send email, read a mailbox or send a Gemini prompt; tests use fakes. No test touches the network.
6. **Tests first where it fits:** write the test for the behaviour, see it fail, then build. Python: pyright strict, no network (the socket guard in `tests/conftest.py`).
7. **UI:** dark only, desktop width (1440 px). No light-theme or narrow-width work. Keys: never fire while typing; honour the "letters" switch; no animation after a key press. Use the components in `packages/ui` and the tokens; no colour literals.
8. **Checks before you report** (all must pass, on the whole repository, not just your files): `pnpm lint`, `pnpm typecheck`, `pnpm test`. Run `pnpm format` on your files first. If a failure is in a file you didn't touch and not caused by you, say so.
9. **Report in at most 15 lines:** pass or fail of each check, files changed, every deviation from the spec and why, open issues.
