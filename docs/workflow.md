# Workflow

## Git

- `main` is always releasable and protected (from step 3g): changes land through pull requests with green CI.
- One branch per piece of work: `type/short-description` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`). Cloud sessions may use their own `claude/...` branch names.
- Commits are small and say why. The subject is in the imperative and under about 70 characters; the body says what changed and why. Commits made by Claude end with the co-author line.
- Never force-push a shared branch, never rewrite `main`, never commit secrets (see [SECURITY.md](../SECURITY.md)).
- Commits and pushes happen when the owner asks, or as the planned end of a plan step.

## How a plan step runs

1. **Start.** Read [handoff.md](handoff.md) and the step in the [migration plan](migration-plan.md). Write the step's working plan with the `smart-task-router` skill: `.router/CONTEXT.md` and `.router/PLAN.md`, with tasks, tiers and done-checks.
2. **Build** in small tasks, each with a check (a test, typecheck, lint, a screenshot). Use the skills listed in [CLAUDE.md](../CLAUDE.md).
3. **Verify** the step's acceptance checks, then look at the result yourself: light and dark, 1440 px and 400 px.
4. **Review.** Run an independent reviewer (the `router-reviewer` agent, or a fresh agent), fix what it finds, and re-run the checks.
5. **Finish.** Update [handoff.md](handoff.md) and the plan's status table, and remove `.router/` if the step is complete. Commit, push the branch, and open a pull request that lists what was checked and how.
6. **Merge.** When CI is green on both systems and the review findings are fixed, the session merges its own pull request. The owner doesn't merge or do anything by hand on GitHub (their rule of 2026-10-19).
7. **Owner check.** The owner tries it, with prototype mode on for new screens, and comments. Their comments start the next round.

**Stopping mid-step.** Commit the work in progress on the branch, with `.router/PROGRESS.md` and `handoff.md` saying exactly where you stopped and what is next. A cloud session sees only what is pushed.

## Continuous integration (from step 3g)

| Job | Runs |
|---|---|
| lint | ESLint, Prettier check, ruff |
| typecheck | `tsc --noEmit` on every package, pyright |
| unit | Vitest, pytest |
| e2e | Playwright against the Electron build on Windows, on example data |
| sql | Supabase migrations plus SQL and RLS tests in Docker |
| security | gitleaks, dependency audit, CodeQL |

## Releases (from step 3h)

- The version follows SemVer from commit types: `feat` → minor, `fix` → patch, breaking → major.
- A tag `vX.Y.Z` builds the signed Windows installer and publishes it where the owner decides (migration plan §9 Q12). The in-app updater installs signed builds only.
- The release notes come from the merged pull requests.

## The prototype

`design/workbench-prototype/` stays runnable until step 11. Changes to the design are tried there first when that is faster than in the real app. The published copy is at https://claude.ai/artifact/96e8HtK58oyRqVcYdUcZNn. Republishing it needs a session with the Artifact tool, and the owner's comments on it live in its `comments` collection.
