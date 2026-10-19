# Desktop app

The Electron app, built with electron-vite.

| Folder | What it holds |
|---|---|
| `src/main/` | The main process: windows and the security guards. Later the IPC handlers, data, sync, secrets and jobs. |
| `src/renderer/` | The React UI. Every user-facing string lives in `strings.ts`. |
| `e2e/` | Playwright tests that launch the built app. |

`src/preload/` arrives with the typed IPC bridge in step 3b; until then the page gets no bridge at all. `resources/` (icons, installer assets) arrives in step 3c.

## Commands

From the repository root: `pnpm dev` (the app with hot reload), `pnpm build`, `pnpm test:e2e` (builds, then runs the Playwright tests).

**The end-to-end tests need a normal user and a display.** The app forces Chromium's sandbox on, and Chromium will not run sandboxed as root. On Linux without a screen, wrap the command in `xvfb-run -a`. Cloud sessions run as root: see [docs/handoff.md](../../docs/handoff.md) for the one-line way to run them as an unprivileged user.

## Dependencies

electron-vite bundles everything the app uses, so all packages are `devDependencies`. Only a main-process module that must stay outside the bundle (a native one, such as the SQLite driver in step 3d) goes in `dependencies`.
