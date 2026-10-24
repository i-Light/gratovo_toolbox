import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { startFakeSupabase, type FakeSupabase } from "./fake-supabase";

// Windows is the only system the app supports, so these tests run there (in CI and on team
// machines).
const appDir = join(__dirname, "..");

// Run from Node, the electron package exports the path to its binary.
const electronBinary = createRequire(__filename)("electron") as string;

/** The URL the built app's page loads from. */
export const appPage = "app://gratovo/index.html";

function environmentWith(extra: Record<string, string>): Record<string, string> {
  const current = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return { ...Object.fromEntries(current), ...extra };
}

export interface LaunchOptions {
  /** A fake Supabase to sign in against. Without one the app runs on the example data. */
  supabase?: FakeSupabase;
  /** "frame" waits for the rail; "page" returns once the app's page has loaded (sign-in, waiting). */
  ready?: "frame" | "page";
}

/**
 * Starting the app has its own time limit, apart from the test's 30 s: a busy CI runner once took
 * over 30 s to start it (main, 2026-10-19; the re-run passed), and a slow start isn't the test's fault.
 */
const startTimeout = 60_000;

/**
 * Starts the built app on a data folder and returns it with its ready page: the URL is the app's
 * and the rail is on screen. Starting again on the same folder is how a test restarts the app.
 * Console errors and uncaught page errors are added to `errors` from the first moment the window
 * exists, so start-up errors are caught too (pass the same list again to keep one list across restarts).
 */
export async function launchApp(
  userData: string,
  errors: string[] = [],
  options: LaunchOptions = {},
): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { supabase, ready = "frame" } = options;
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [appDir],
    // The Supabase address is always set, so a developer's .env.local never points a test at the
    // real project. Empty means "not configured": the example data, as every older spec expects.
    env: environmentWith({
      GRATOVO_USER_DATA: userData,
      GRATOVO_SUPABASE_URL: supabase?.url ?? "",
      GRATOVO_SUPABASE_PUBLISHABLE_KEY: supabase?.key ?? "",
    }),
    timeout: startTimeout,
  });
  const page = await app.firstWindow({ timeout: startTimeout });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  // firstWindow() can resolve before the app's page has loaded. The URL is polled rather than
  // waited for with waitForURL: that waits for a load or navigation event, and in Electron the
  // page can finish loading before Playwright listens, so it hung with the frame on screen
  // (Windows CI, 2026-10-20). The app writes "#/today" into the URL at start, so any fragment
  // will do.
  await expect(page).toHaveURL((url) => url.href.startsWith(appPage), {
    timeout: startTimeout,
  });
  if (ready === "page") {
    return { app, page, errors };
  }
  // The frame is there once the rail is.
  await page
    .getByRole("navigation", { name: strings.rail.label })
    .waitFor({ timeout: startTimeout });
  return { app, page, errors };
}

type Fixtures = {
  /** The data folder of this test; it is removed when the test ends. */
  userData: string;
  /** The running app (the first launch, or the latest one after `relaunch`). */
  app: ElectronApplication;
  /** The window of the running app. */
  page: Page;
  /** Every console error and uncaught page error since the first launch, restarts included. */
  errors: string[];
  /** Closes the app and starts it again on the same data folder; returns the new window. */
  relaunch: () => Promise<Page>;
  /** A fake Supabase, started for this test and closed after it. */
  supabase: FakeSupabase;
  /**
   * Starts the app against `supabase` (not started by the `app` and `page` fixtures, which run on
   * the example data). Each call closes the one before; the apps are closed when the test ends.
   */
  startSigned: (
    options?: Pick<LaunchOptions, "ready">,
  ) => Promise<{ app: ElectronApplication; page: Page }>;
  /** Console errors and page errors of every `startSigned` launch. */
  signedErrors: string[];
};

/** Each test gets a fresh copy of the built app, with its own data folder, and its one window. */
export const test = base.extend<
  Fixtures & { running: { app: ElectronApplication; page: Page; errors: string[] } }
>({
  userData: [
    // Playwright reads a fixture's dependencies from this pattern, so it can't be left out.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Nothing is shared with the installed app, `pnpm dev` or the test before, so a test also
      // runs while the app is open on the same machine.
      const userData = await mkdtemp(join(tmpdir(), "gratovo-e2e-"));
      await use(userData);
      // Windows can hold a file for a while after the app exits (Chromium's DIPS file did on a busy
      // CI runner). A temp folder left behind isn't the test's failure: retry for about five
      // seconds, then leave it for the system to clear.
      await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(
        (error: unknown) => {
          const code = (error as { code?: unknown }).code;
          if (code !== "EBUSY" && code !== "EPERM") {
            throw error;
          }
          console.warn(`Left the test's data folder behind (${code}): ${userData}`);
        },
      );
    },
    { scope: "test" },
  ],
  // The latest launch, shared by `app`, `page` and `relaunch`. Closed before the folder is removed.
  running: [
    async ({ userData }, use) => {
      const state = await launchApp(userData);
      const holder = { ...state };
      await use(holder);
      await holder.app.close();
    },
    { timeout: startTimeout },
  ],
  app: async ({ running }, use) => {
    await use(running.app);
  },
  errors: async ({ running }, use) => {
    await use(running.errors);
  },
  page: [
    async ({ running }, use) => {
      await use(running.page);
    },
    { scope: "test", timeout: startTimeout },
  ],
  supabase: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const fake = await startFakeSupabase();
      await use(fake);
      await fake.close();
    },
    { scope: "test" },
  ],
  signedErrors: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use([]);
    },
    { scope: "test" },
  ],
  startSigned: [
    async ({ userData, supabase, signedErrors }, use) => {
      const launched: { app: ElectronApplication | null } = { app: null };
      await use(async (options = {}) => {
        await launched.app?.close();
        const started = await launchApp(userData, signedErrors, { supabase, ...options });
        launched.app = started.app;
        return { app: started.app, page: started.page };
      });
      await launched.app?.close().catch(() => undefined);
    },
    { timeout: startTimeout },
  ],
  relaunch: [
    async ({ running, userData }, use) => {
      await use(async () => {
        await running.app.close();
        const next = await launchApp(userData, running.errors);
        running.app = next.app;
        running.page = next.page;
        return next.page;
      });
    },
    { timeout: startTimeout },
  ],
});

/**
 * Runs a sync pass now, through the page's own bridge (or waits for the one running and the one
 * after it), and returns the status it ends with. The app also syncs on its own timers; tests use
 * this so they never wait for the 20 s catch-up.
 */
export async function syncNow(page: Page): Promise<unknown> {
  return page.evaluate(() => window.gratovo.invoke("sync:now", {}));
}

export { expect } from "@playwright/test";
