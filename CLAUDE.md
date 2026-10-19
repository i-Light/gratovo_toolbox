# Working in gratovo_toolbox

The rebuild of Gratovo's internal app. Electron, React and TypeScript for the desktop app, Python for the pipeline, and Supabase for the backend. The old Flutter app is in `legacy/` for reference only.

## Read first, every session

1. [docs/handoff.md](docs/handoff.md): where work stopped, what is next, and how to check it.
2. [docs/migration-plan.md](docs/migration-plan.md): the steps, in order, with acceptance checks.
3. Before you touch a topic, read the matching doc in [docs/](docs/README.md): architecture, conventions, workflow, or a decision record.

When you finish a piece of work, update `docs/handoff.md` and the plan's status table **in the same commit**. Cloud sessions see only this repository, so anything not committed is lost.

## The owner's standing rules

These come from the owner and hold until the owner changes them. The detail and the reasons are in [docs/product/owner-rules.md](docs/product/owner-rules.md).

- **Git:** commit only when the owner asks, or when the task is a plan step that ends in a commit. Never push to `main` directly; work on a branch and open a pull request. Never force-push or rewrite history.
- **Secrets:** never print, log, commit or copy a secret. This includes `.env*` files, `*.local.json` files, tokens and keys. See [SECURITY.md](SECURITY.md).
- **Email:** never send an email, and never read the connected mailbox. Every outgoing message waits for a person to approve it.
- **Gemini:** one prompt per fresh chat, thinking level verified as high, at most 3 tabs, 60 s between sends. Never run two Gemini bridge runs at once (port 8765).
- **Example data is about AI:** creators who cover AI tools and AI news, and brands that sponsor them. Never woodworking, travel or anything outside the niche.
- **Drafted emails** are never templated and never use the banned words. Rules come only from the course (lessons and coach calls).
- **On hold:** the four noted gaps `search-1`, `first-1`, `mail-1` and `mail-2` wait for the owner. Don't build them.
- **Cleanup is the last step.** Don't delete or merge files from `legacy/` or the docs until step 10 (the 100% check) has passed. Step 11 does the cleanup.
- **Language:** English only for now. Keep every user-facing string in one place so other languages can come later.
- **Prototype mode** is owner-only and off by default. When off it leaves no trace: no buttons, keys, pins, bars or network calls.

## How to work

- **Plan first:** non-trivial work starts from the plan step's acceptance checks. Big steps use the `smart-task-router` skill: `.router/` holds the state of the step in progress, and it is committed so another session can resume.
- **Verify:** tests, typecheck and lint all pass before you call anything done. UI work is also checked by looking at it, in light and dark, at desktop width and at 400 px.
- **Skills in `.claude/skills/`:** use them where they apply.
  - UI work: `impeccable`, `emil-design-eng`, `ui-ux-pro-max`, `web-design-guidelines`, `ux-heuristics`, `break-ui`.
  - React: `vercel-react-best-practices`.
  - Tests: `playwright-best-practices`.
  - Database: `supabase` and `supabase-postgres-best-practices`.
  - Security: `sentry-security-review`.
  - Planning and decisions: `grill-with-docs`.
- **Plugins:** the project settings turn on `superpowers` (brainstorming, plans, TDD, debugging, verification), `claude-md-management` and `claude-security`.
- **Writing for the owner:** plain words, short sentences, no jargon. Give a recommendation, not a survey. Say what you checked and how.

## Commands

None yet: the foundation step creates the toolchain. The prototype runs as it is. Open `design/workbench-prototype/index.html`, or run its tests as described in [its README](design/workbench-prototype/README.md).
