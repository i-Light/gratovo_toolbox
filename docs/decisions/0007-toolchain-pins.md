# 0007. Toolchain pins for step 3a

- **Date:** 2026-10-19
- **Status:** accepted. Item 3 changed the same day at the owner's request: TypeScript 7 for the repository, TypeScript 6 only for the linter. Revisit the two holds below at each upgrade.

## Context

Step 3a pins the toolchain at the current stable releases (checked with `npm view`, nodejs.org and PyPI on 2026-10-19). Four choices needed more than "take the latest".

## Decision

1. **Node 24.22.0** (`.nvmrc`; `engines` asks for `^24.22.0`). It is the active LTS line, and it is the exact Node inside Electron 44.9.0, so the tools and the app run the same Node. Node 26 is newer but not LTS yet.
2. **pnpm 12.14.0, with its settings in `pnpm-workspace.yaml`.** pnpm 12 ignores settings in `.npmrc` (tested: `save-exact` there had no effect), so `saveExact`, `engineStrict`, `minimumReleaseAge` (one day) and `allowBuilds` live in `pnpm-workspace.yaml`. No `.npmrc` is kept, because a file that is silently ignored would mislead.
3. **TypeScript 7.0.2 for the repository; TypeScript 6 for the linter only** (the owner's choice). `pnpm typecheck` runs TypeScript 7's `tsc -b`, which builds every project in about a second. typescript-eslint 8.71.2 accepts only `typescript <6.1.0`, because TypeScript 7 doesn't offer the API it needs yet. So the lint plugins live in a small workspace package, `tooling/eslint-config`, whose own `typescript` is `@typescript/typescript6` (the TypeScript team's TypeScript 6 package, which bundles 6.0.3). Inside that package typescript-eslint loads TypeScript 6; everywhere else `typescript` is 7. The root `eslint.config.mjs` imports the plugins from that package. Checked: the root `tsc` reports 7.0.2; typescript-eslint and its helpers load 6.0.3; pnpm reports no peer problems; TypeScript 7 catches a planted type error, a Node import in `packages/core` and `fetch` there; the typed lint rules still fire.
4. **ESLint 10.13.0 with eslint-plugin-jsx-a11y 6.10.2.** The plugin still declares a peer range that stops at ESLint 9. Its rules were checked under ESLint 10 (a planted `<img>` without `alt` is reported, as are a conditional hook and a floating promise), so the peer range is allowed in `pnpm-workspace.yaml` with a pointer here. ESLint 9 is out of support.

Everything else is the latest stable release, pinned exactly: Electron 44.9.0, electron-vite 6.0.0, Vite 8.3.4, React 19.3.1, Vitest 5.0.5, Playwright 1.64.1, zod 4.6.7, Python 3.14, uv 0.13.1, ruff 0.17.1, pyright 1.1.414 and pytest 9.1.1. The full table is in [architecture.md](../architecture.md#versions).

## Alternatives considered

- **TypeScript 6 everywhere:** the first version of this record. The owner asked for TypeScript 7.
- **TypeScript 7 everywhere:** would mean dropping typescript-eslint's typed rules or running it on a version it doesn't support.
- **pnpm `overrides` to hand typescript-eslint TypeScript 6:** tested, and they don't reach peer dependencies, so typescript-eslint still got 7.
- **ESLint 9:** out of support. **Dropping jsx-a11y:** loses the accessibility checks the conventions require.
- **pnpm 10 (the version some machines already have):** older, and settings would move again on the next upgrade.

## Consequences

- Two upgrades to watch: typescript-eslint supporting TypeScript 7 (then fold `tooling/eslint-config` back into the root and drop `@typescript/typescript6`), and a jsx-a11y release that declares ESLint 10 (then remove the peer rule).
- Editors: TypeScript 7 has no `tsserver.js`, so VS Code uses its own bundled TypeScript unless the TypeScript 7 (native) extension is installed. The checks that count are `pnpm typecheck` and CI.
- `minimumReleaseAge` means a version published less than a day ago won't install. Pick the one before it, or wait a day.
