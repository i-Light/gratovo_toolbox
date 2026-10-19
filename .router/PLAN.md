# Step 3b: security baseline

## Goal

The Electron settings, the typed IPC bridge, the `secrets` module and the security checks in CI, as listed in [migration-plan.md step 3b](../docs/migration-plan.md#step-3-foundation) and [handoff.md](../docs/handoff.md#next-step-3b-security-baseline).

**Acceptance (from the plan):** a test proves the renderer cannot reach Node or any IPC channel outside the allowlist; gitleaks and the audit pass in CI.

Also done when:
- the page loads from `app://gratovo/index.html` with the CSP as a meta tag and as a header;
- navigation away (`will-navigate`, `will-frame-navigate`, `will-redirect`) is refused; allowlisted links open in the browser;
- the release fuses are defined, and a test flips them on a copy of the Electron binary and reads them back;
- CodeQL (JS/TS and Python) and the dependency audit run in CI and fail on a finding; Dependabot is configured;
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; CI is green on Windows.

**Non-goals:** packaging (3h applies the fuses to the installer), a settings screen for secrets, the data layer.

## Decisions

1. **One Electron IPC channel** (`gratovo:invoke`). The page calls `window.gratovo.invoke(channel, input)`; the main process checks the sender, then `createDispatcher` (in `packages/ipc`) validates the request, runs the handler and validates the response. App channels stay in the `channels` map, so the allowlist is one object.
2. **Sender check:** only the app page's main frame may call (`frame.parent === null` and `isAppPage(frame.url)`).
3. **`app://gratovo/`** serves the built renderer from disk. Files are read with `fs`, never `net.fetch(file://)`, so it keeps working with the `GrantFileProtocolExtraPrivileges` fuse off. Only known file types are served; anything outside the renderer folder is a 404. Every response carries the CSP and `nosniff`.
4. **External links:** https only, no credentials in the URL, host on an allowlist (YouTube and Gmail for now; features add hosts). Everything else is refused silently.
5. **Secrets:** one JSON file in `userData`, values encrypted with `safeStorage`, written atomically, writes queued. No plain-text fallback. The page can only ask whether a secret is set (`secrets:status`).
6. **Audit:** OSV-Scanner v2.7.0 (built with `go install`, like gitleaks) over `pnpm-lock.yaml` and `services/pipeline/uv.lock`. One stable tool for both ecosystems; `uv audit` is still experimental.
7. **CodeQL without upload:** the repository is private without GitHub Advanced Security, so results can't go to code scanning. CI runs the analysis with `upload: never` and fails when the SARIF has any result.
8. **Analysis jobs run on Linux** (secret scan, audit, CodeQL): they read files and never run the app, and Windows minutes count double on a private repository.
9. **Fuses:** all nine set explicitly (`strictlyRequireAllFuses`), so an Electron upgrade that adds a fuse fails until it is decided.

## Contracts

### `packages/ipc`

```ts
// src/channels.ts (additions)
/** A secret's name: lowercase words joined by dots or hyphens, e.g. "gemini.api-key". */
export const secretName = z.string().max(100).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);
// channels["secrets:status"] = { request: z.strictObject({ name: secretName }), response: z.strictObject({ set: z.boolean() }) }
export type ChannelInput<C extends Channel> = z.output<(typeof channels)[C]["request"]>; // what a handler receives

// src/bridge.ts (type-only imports, so the preload bundle stays free of zod)
export const bridgeChannel = "gratovo:invoke";
export const bridgeGlobal = "gratovo";
export type InvokeResult<C extends Channel> = { ok: true; value: ChannelResponse<C> } | { ok: false; reason: string };
export interface Bridge { invoke<C extends Channel>(channel: C, input: ChannelRequest<C>): Promise<InvokeResult<C>>; }

// src/dispatch.ts
export type Handlers = { [C in Channel]: (input: ChannelInput<C>) => ChannelResponse<C> | Promise<ChannelResponse<C>> };
export function createDispatcher(handlers: Handlers, onError: (channel: Channel, error: unknown) => void):
  (channel: unknown, input: unknown) => Promise<InvokeResult<Channel>>;
// non-string channel or parseRequest failure -> {ok:false, reason}; handler throws -> onError + {ok:false, reason:"The call failed"};
// response fails its schema -> onError + {ok:false, reason:"The call failed"}. Never echoes the input.
```
`package.json` exports: `"."` and `"./bridge"`.

### `apps/desktop/src/main` (pure modules, no `electron` import, unit-tested)

```ts
// app-page.ts
export const appScheme = "app"; export const appHost = "gratovo";
export const appOrigin = "app://gratovo";
export function localDevServer(url: string | undefined): string | undefined; // moved from window.ts
export function isAppPage(url: string, pageUrl: string): boolean;            // ignores #fragment
export function isTrustedSender(frame: { url: string; parent: unknown } | null, pageUrl: string): boolean;

// app-files.ts
export function resolveAppFile(root: string, requestUrl: string): string | undefined; // inside root, known type, else undefined
export function contentType(file: string): string | undefined;                         // by extension

// external-links.ts
export function isAllowedExternalLink(url: string): boolean;

// secret-store.ts
export interface Cipher { isAvailable(): boolean; encrypt(plainText: string): Buffer; decrypt(cipherText: Buffer): string; }
export interface SecretStore {
  get(name: string): Promise<string | undefined>; set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>; has(name: string): Promise<boolean>; names(): Promise<string[]>;
}
export function createSecretStore(file: string, cipher: Cipher): SecretStore;
```

### Release fuses (`apps/desktop/scripts/release-fuses.ts`)

```ts
export const releaseFuses /* satisfies FuseV1Config, strictlyRequireAllFuses: true */;
// RunAsNode off, EnableCookieEncryption on, EnableNodeOptionsEnvironmentVariable off, EnableNodeCliInspectArguments off,
// EnableEmbeddedAsarIntegrityValidation on, OnlyLoadAppFromAsar on, LoadBrowserProcessSpecificV8Snapshot off,
// GrantFileProtocolExtraPrivileges off, WasmTrapHandlers on
export async function applyReleaseFuses(electronBinary: string): Promise<void>;
```

## Tasks

| id | title | tier | depends | files |
|---|---|---|---|---|
| T0 | Dependencies and project references | H (self) | | `apps/desktop/package.json`, `apps/desktop/tsconfig.*.json`, `pnpm-lock.yaml` |
| T1 | IPC contracts: `secretName`, `secrets:status`, bridge types, dispatcher | H (self) | T0 | `packages/ipc/src/*`, `packages/ipc/package.json` |
| T2 | Secret store + tests | N | T1 | `src/main/secret-store.ts`, `src/main/secret-store.test.ts` |
| T3 | App files and external links + tests | N | T0 | `src/main/app-files.ts`, `src/main/app-files.test.ts`, `src/main/external-links.ts`, `src/main/external-links.test.ts` |
| T4 | Release fuses + e2e check | N | T0 | `scripts/release-fuses.ts`, `e2e/fuses.spec.ts` |
| T5 | CI: audit, CodeQL, Dependabot, weekly run | N | | `.github/workflows/ci.yml`, `.github/codeql/codeql-config.yml`, `.github/dependabot.yml` |
| T6 | Main-process wiring: app page, protocol, bridge, handlers, secrets, guards, preload, CSP header | H (self) | T1-T3 | `src/main/*`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `electron.vite.config.ts` |
| T7 | Acceptance e2e: fixture, security spec | H (self) | T6 | `e2e/fixtures.ts`, `e2e/smoke.spec.ts`, `e2e/security.spec.ts` |
| T8 | Verify on Windows CI (workflow_dispatch), fix | H (self) | T4-T7 | |
| T9 | Docs: SECURITY.md, architecture, ADR 0008, workflow, READMEs, handoff, plan status | N/self | T8 | `docs/*`, `SECURITY.md`, READMEs |
| T10 | Review (router-reviewer), fixes, PR, merge | H | T9 | |

Done-checks: each task runs its own Vitest file, ESLint on its files and `tsc -b`; the step ends with `pnpm lint && pnpm typecheck && pnpm test` and a green Windows CI run.
