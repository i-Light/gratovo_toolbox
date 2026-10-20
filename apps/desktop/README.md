# Desktop app

The Electron app, built with electron-vite.

| Folder | What it holds |
|---|---|
| `src/main/` | The main process: the window, the `app://` protocol, the security guards, the IPC bridge and its handlers, the secrets store, and the local database (`db/`: open and migrate; `data/`: the repositories and the example and live sources). Later sync and jobs. |
| `src/preload/` | The bridge: one function, `window.gratovo.invoke`, and nothing else. |
| `src/renderer/` | The React UI. Every user-facing string lives in `strings.ts`. |
| `scripts/` | Build-time code: the fuses every release build ships with. |
| `e2e/` | Playwright tests: the built app (`smoke`, `security`) and the release fuses. |

`resources/` (icons, installer assets) arrives in step 3c.

## Adding an IPC channel

1. Add it to `channels` in `packages/ipc/src/channels.ts`, with a zod schema for the request and the response. Name it `domain:verb`.
2. TypeScript then asks for its handler in `src/main/handlers.ts`.
3. The page calls it with `window.gratovo.invoke("domain:verb", input)` and gets `{ ok: true, value }` or `{ ok: false, reason }`.

A channel never returns a secret's value, and never takes a file path or URL without checking it against an allowlist.

## Commands

From the repository root: `pnpm dev` (the app with hot reload), `pnpm build`, `pnpm test:e2e` (builds, then runs the Playwright tests).

The app supports Windows only, and the end-to-end tests run there: in CI on every pull request, and on team machines.

An unpackaged app keeps its data apart from the installed one: `pnpm dev` uses a "Gratovo Toolbox (dev)" folder, and each end-to-end test gets a fresh temporary folder (through `GRATOVO_USER_DATA`, which a packaged app ignores). So the tests also run while the app is open. Without Supabase settings the app keeps its data in `example.db` in that folder; delete the file to start again from the example fixtures. With them, it keeps the signed-in account's copy of the team's data in `gratovo.db` in the same folder, and deletes that file at sign-out.

## Connecting to Supabase

The app reads two build values, `MAIN_VITE_SUPABASE_URL` and `MAIN_VITE_SUPABASE_PUBLISHABLE_KEY`, from the environment or from `apps/desktop/.env.local`. Without them it runs unconfigured: example data, no sign-in. Never put a secret key there; the app refuses it. The steps are in [docs/setup.md](../../docs/setup.md).

## Dependencies

electron-vite bundles everything the app uses, so all packages are `devDependencies`. Only a main-process module that must stay outside the bundle (a native one, such as the SQLite driver in step 3d) goes in `dependencies`.
