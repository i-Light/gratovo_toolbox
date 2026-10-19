import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _electron as electron,
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

/** Each test gets a fresh copy of the built app, with its own data folder, and its one window. */
export const test = base.extend<{ app: ElectronApplication; page: Page }>({
  // Playwright reads a fixture's dependencies from this pattern, so it can't be left out.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    // Nothing is shared with the installed app, `pnpm dev` or the test before, so a test also
    // runs while the app is open on the same machine.
    const userData = await mkdtemp(join(tmpdir(), "gratovo-e2e-"));
    const app = await electron.launch({
      executablePath: electronBinary,
      args: [appDir],
      env: environmentWith({ GRATOVO_USER_DATA: userData }),
    });
    await use(app);
    await app.close();
    // Windows can hold a file for a moment after the app exits.
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    // firstWindow() can resolve before the app's page has loaded.
    // The app writes "#/today" into the URL at start, so any fragment will do.
    await page.waitForURL((url) => url.href.startsWith(appPage));
    // The frame is there once the rail is.
    await page.getByRole("navigation", { name: strings.rail.label }).waitFor();
    await use(page);
  },
});

export { expect } from "@playwright/test";
