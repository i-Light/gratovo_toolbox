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

/** Each test gets a fresh copy of the built app, with its own data folder, and its one window. */
export const test = base.extend<{ app: ElectronApplication; page: Page }>({
  app: [
    // Playwright reads a fixture's dependencies from this pattern, so it can't be left out.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Nothing is shared with the installed app, `pnpm dev` or the test before, so a test also
      // runs while the app is open on the same machine.
      const userData = await mkdtemp(join(tmpdir(), "gratovo-e2e-"));
      const app = await electron.launch({
        executablePath: electronBinary,
        args: [appDir],
        env: environmentWith({ GRATOVO_USER_DATA: userData }),
        timeout: startTimeout,
      });
      await use(app);
      await app.close();
      // Windows can hold a file for a moment after the app exits.
      await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
    { timeout: startTimeout },
  ],
  page: [
    async ({ app }, use) => {
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
      await use(page);
    },
    { scope: "test", timeout: startTimeout },
  ],
});

export { expect } from "@playwright/test";
