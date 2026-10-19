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

/**
 * Starting the app has its own time limit, apart from the test's 30 s: a busy CI runner once took
 * over 30 s to start it (main, 2026-10-19; the re-run passed), and a slow start isn't the test's fault.
 */
const startTimeout = 60_000;

/**
 * Starts the built app on a data folder and returns it with its ready page: the URL is the app's
 * and the rail is on screen. Starting again on the same folder is how a test restarts the app.
 */
export async function launchApp(
  userData: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [appDir],
    env: environmentWith({ GRATOVO_USER_DATA: userData }),
    timeout: startTimeout,
  });
  const page = await app.firstWindow({ timeout: startTimeout });
  // firstWindow() can resolve before the app's page has loaded. The URL is polled rather than
  // waited for with waitForURL: that waits for a load or navigation event, and in Electron the
  // page can finish loading before Playwright listens, so it hung with the frame on screen
  // (Windows CI, 2026-10-20). The app writes "#/today" into the URL at start, so any fragment
  // will do.
  await expect(page).toHaveURL((url) => url.href.startsWith(appPage), {
    timeout: startTimeout,
  });
  // The frame is there once the rail is.
  await page
    .getByRole("navigation", { name: strings.rail.label })
    .waitFor({ timeout: startTimeout });
  return { app, page };
}

type Fixtures = {
  /** The data folder of this test; it is removed when the test ends. */
  userData: string;
  /** The running app (the first launch, or the latest one after `relaunch`). */
  app: ElectronApplication;
  /** The window of the running app. */
  page: Page;
  /** Closes the app and starts it again on the same data folder; returns the new window. */
  relaunch: () => Promise<Page>;
};

/** Each test gets a fresh copy of the built app, with its own data folder, and its one window. */
export const test = base.extend<Fixtures & { running: { app: ElectronApplication; page: Page } }>({
  userData: [
    // Playwright reads a fixture's dependencies from this pattern, so it can't be left out.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Nothing is shared with the installed app, `pnpm dev` or the test before, so a test also
      // runs while the app is open on the same machine.
      const userData = await mkdtemp(join(tmpdir(), "gratovo-e2e-"));
      await use(userData);
      // Windows can hold a file for a moment after the app exits.
      await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
  page: [
    async ({ running }, use) => {
      await use(running.page);
    },
    { scope: "test", timeout: startTimeout },
  ],
  relaunch: [
    async ({ running, userData }, use) => {
      await use(async () => {
        await running.app.close();
        const next = await launchApp(userData);
        running.app = next.app;
        running.page = next.page;
        return next.page;
      });
    },
    { timeout: startTimeout },
  ],
});

export { expect } from "@playwright/test";
