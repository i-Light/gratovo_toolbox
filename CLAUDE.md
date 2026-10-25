# Working in gratovo_toolbox

The rebuild of Gratovo's internal app. Electron, React and TypeScript for the desktop app, Python for the pipeline, and Supabase for the backend. The old Flutter app is in `legacy/` for reference only.

## Read first, every session

1. [docs/migration-plan.md](docs/migration-plan.md): the steps, in order, with acceptance checks. Its status table (§5) says where work stands and what is next.
2. `.router/PROGRESS.md`, if it exists: the step in progress, where it stopped and what is next.
3. [docs/workflow.md](docs/workflow.md): how a step runs, how to set up the tools, and the lessons so far.
4. Before you touch a topic, read the matching doc in [docs/](docs/README.md): architecture, conventions, workflow, or a decision record.

When you finish a piece of work, update the plan's status table (and `.router/PROGRESS.md` while a step is in progress) **in the same commit**. There is no hand-off file: the owner removed it on 2026-10-20. Cloud sessions see only this repository, so anything not committed is lost.

## The owner's standing rules

These come from the owner and hold until the owner changes them. The detail and the reasons are in [docs/product/owner-rules.md](docs/product/owner-rules.md).

- **Git:** commit only when the owner asks, or when the task is a plan step that ends in a commit. Never push to `main` directly; work on a branch and open a pull request. Never force-push or rewrite history.
- **GitHub is yours to run:** open the pull request, run `pnpm verify --status` until it passes, fix the review findings, then merge it yourself. Never ask the owner to merge or to do anything by hand on GitHub. Stop only for a critical question about the workflow or the migration that the docs don't answer.
- **Secrets:** never print, log, commit or copy a secret. This includes `.env*` files, `*.local.json` files, tokens and keys. See [SECURITY.md](SECURITY.md).
- **Email:** never send an email, and never read the connected mailbox. Every outgoing message waits for a person to approve it.
- **Gemini:** one prompt per fresh chat, thinking level verified as high, at most 3 tabs, 60 s between sends. Never run two Gemini bridge runs at once (port 8765).
- **Example data is about AI:** creators who cover AI tools and AI news, and brands that sponsor them. Never woodworking, travel or anything outside the niche.
- **Drafted emails** are never templated and never use the banned words. Rules come only from the course (lessons and coach calls).
- **On hold:** the four noted gaps `search-1`, `first-1`, `mail-1` and `mail-2` wait for the owner. Don't build them.
- **Cleanup is the last step.** Don't delete or merge files from `legacy/` or the docs until step 10 (the 100% check) has passed. Step 11 does the cleanup.
- **Checks run on this computer, not GitHub** (2026-10-25): the Actions minutes ran out. `pnpm verify` is the gate a pull request must pass; the GitHub workflow runs only when the owner asks.
- **Solo first:** team work waits until the app is fully functional for one person. It is all in plan step T (after step 9): R2 sharing, a teammate's run, hand-offs, the Team screen, new-VA onboarding, and packaging (the installer, the bundled Python, updates for other machines). Don't build it earlier. What 3d-2 already built stays as it is.
- **Pipeline-first, no dead screens:** build in pipeline order (step 4 live data, 5 Find, 6 Reach, 7 Today and prototype mode, 8 Close, 9 Deliver and Insights). In live mode, only what is wired to real data can be reached; hide the rest until its step.
- **Two-tier testing:** a sub-step's pull request needs lint, typecheck, unit tests and at most one new light Electron smoke test. The full Playwright flow suite runs once at the end of a major step.
- **Windows only:** the app targets Windows desktop alone. Don't spend effort on Linux, macOS or phones (CI jobs, workarounds, docs, phone-sized or 400 px layout checks) until the owner asks for another system.
- **Language:** English only for now. Keep every user-facing string in one place so other languages can come later.
- **Dark only, for now:** the app always runs dark, with no theme switch. Don't build, test or check the light theme until the owner asks. The light tokens stay in `tokens.css`.
- **Prototype mode** is owner-only and off by default. When off it leaves no trace: no buttons, keys, pins, bars or network calls.

## How to work

- **Plan first:** non-trivial work starts from the plan step's acceptance checks. Big steps use the `smart-task-router` skill: `.router/` holds the state of the step in progress, and it is committed so another session can resume.
- **Model use:** pick each task's model by [the plan's §10](docs/migration-plan.md#10-model-use). Where it disagrees with the `smart-task-router` skill, §10 wins.
- **Verify:** tests, typecheck and lint all pass before you call anything done. UI work is also checked by looking at it, in dark, at desktop width (1440 px). The app is dark only for now: no light-theme checks, and no phone or narrow-width (400 px) checks.
- **Skills in `.claude/skills/`:** use them where they apply.
  - UI work: `impeccable`, `emil-design-eng`, `ui-ux-pro-max`, `web-design-guidelines`, `ux-heuristics`, `break-ui`.
  - React: `vercel-react-best-practices`.
  - Tests: `playwright-best-practices`.
  - Database: `supabase` and `supabase-postgres-best-practices`.
  - Security: `sentry-security-review`.
  - Planning and decisions: `grill-with-docs`.
- **New Supabase tables need explicit grants** (Supabase's change of 2026-10-30): in the same migration as the table, with nothing for `anon`. The rule and the check are in [supabase/README.md](supabase/README.md#every-new-table-needs-its-own-grants-supabase-from-2026-10-30).
- **Plugins:** the project settings turn on `superpowers` (brainstorming, plans, TDD, debugging, verification), `claude-md-management` and `claude-security`.
- **Writing for the owner:** plain words, short sentences, no jargon. Give a recommendation, not a survey. Say what you checked and how.

## Commands

Node 24.22.0, pnpm 12, uv and gitleaks. A cloud container lacks most of them: [docs/workflow.md](docs/workflow.md#setting-up-and-things-to-know) says how to get them, on Windows and in the cloud.

- `pnpm install`: dependencies and the git hooks.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: each covers TypeScript and Python. All three must pass.
- `pnpm test:e2e`: builds the app and runs the Electron tests, on Windows. Cloud sessions (Linux containers) can't run them.
- `pnpm verify`: every check a pull request must pass (secrets, dependency audit, lint, typecheck, tests, Electron tests, and the Docker tests when the change needs them). [docs/workflow.md](docs/workflow.md#the-local-gate-pnpm-verify-since-2026-10-25) says how it works.
- `pnpm dev`, `pnpm build`, `pnpm format`.

The prototype runs as it is. Open `design/workbench-prototype/index.html`, or run its tests as described in [its README](design/workbench-prototype/README.md).
