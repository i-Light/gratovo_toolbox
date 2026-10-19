# Conventions

Rules that keep the code easy to read for people and agents. When the code and this file disagree, fix one of them in the same pull request.

## Naming

| Thing | Style | Example |
|---|---|---|
| Folders and TS/TSX files | kebab-case | `today-queue.tsx`, `next-actions.ts` |
| React components | PascalCase | `TodayQueue`, `DraftCard` |
| Functions, variables | camelCase, verbs for functions | `sendDraft`, `itemsFor` |
| Types, interfaces | PascalCase, no `I` prefix | `Deal`, `DraftGate` |
| Constants | camelCase, or UPPER_SNAKE for true constants shared across modules | `DEAL_FLOW` |
| IPC channels | `domain:verb` | `drafts:send`, `runs:start` |
| CSS custom properties | `--kebab-case`, tokens grouped by role | `--accent`, `--ink-2`, `--ease-out` |
| `data-ui` ids (comment anchors) | `screen.part.thing` | `today.queue.row`, `reach.draft.send` |
| Python modules and functions | snake_case | `video_stats.py`, `derive_signals()` |
| Python classes | PascalCase | `MailboxStore` |
| SQL tables and columns | snake_case, plural tables | `deals`, `invoice_due_at` |
| Migrations | `YYYYMMDDHHMMSS_short_description.sql` | `20261020120000_baseline.sql` |
| Branches | `type/short-description` | `feat/today-queue`, `fix/peek-esc-order` |

Words follow the product: **creator** (not influencer), **brand**, **deal**, **draft**, **thread**, **mailbox**, **run**, **find**, **owner**. Use the five phase names exactly: Find, Reach, Close, Deliver, plus Today.

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noImplicitOverride`. No `any`; `unknown` plus a zod parse at the boundaries.
- Named exports only. One component per file. A file stays under about 300 lines; split by responsibility, not by size alone.
- Pure logic lives in `packages/core` with no I/O. Side effects stay at the edges: IPC handlers and the data layer.
- Errors: expected failures are values (`{ok: false, reason}`) and are shown to the user in plain words. Unexpected ones throw, are logged in the main process, and become a toast with what to do next.
- Dates: store UTC instants, display in the user's time zone through one formatter. Money: integers in cents, plus a currency code.

## React

- Function components and hooks. No class components.
- Server and local data come from query hooks backed by IPC, invalidated by data-change events. Don't copy query data into component state.
- Components read the tokens through CSS. No colour literals in components.
- Every interactive element is a real `button`, `a` or form control, with a label. Focus is always visible. Keyboard comes first: every frequent action has a key, shown where it applies.
- Motion: only `transform` and `opacity`, using the custom curves, under 300 ms. Never animate keyboard-initiated actions. Respect reduced motion.
- Follow the `vercel-react-best-practices` skill for rendering and data fetching.

## Copy

- Plain English, short sentences, sentence case, no jargon. A label says what happens: "Send invoice", not "Submit".
- Every action answers four questions: did it work, where did it go, what happens next, and how do I take it back. That means a toast with Undo where data changed.
- All user-facing strings live in one module per feature, keyed, so translation can come later. English only for now.
- Example data is always about the AI niche (AI tool reviewers, AI news, coding with AI) and AI sponsors.

## Python

- Python 3.12+, `uv` for environments, `pyproject.toml`, a `src/` layout.
- ruff for lint and format, pyright in strict mode for new code, and pytest with no network (fixtures for every external call).
- Talk to the app only through the JSON-lines protocol on stdin and stdout. Every message type has a schema shared with `packages/ipc`.
- Never read `.env` files. Configuration and secrets arrive from the app at launch.

## SQL and Supabase

- Every change is a new migration file, and it is additive until cutover (see the migration plan, ground rule 1).
- Row-level security on every table, with policies tested in `supabase/tests/`.
- Follow the `supabase` and `supabase-postgres-best-practices` skills.

## Tests

- **Unit:** `packages/core` aims at 100% branch coverage of the engines. Use Vitest.
- **Component:** React Testing Library for components with logic.
- **End to end:** Playwright against the built Electron app on example data, for every flow in the parity checklist that a person would notice breaking. The prototype's Python Playwright tests are the starting list.
- **Python:** pytest. **SQL:** tests run in Docker in CI.
- A bug fix starts with a failing test.

## Docs

- Each folder that isn't obvious has a short `README.md` saying what it holds.
- Decisions with lasting effect get a record in `docs/decisions/`: short, dated, with the reason and the alternatives considered.
- Comments explain *why*, not *what*. Match the density of the code around them.
