import { createRequire } from "node:module";
import { join } from "node:path";

import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// Windows is the only system the app supports, so these tests run there (in CI and on team
// machines).
const appDir = join(__dirname, "..");

// Run from Node, the electron package exports the path to its binary.
const electronBinary = createRequire(__filename)("electron") as string;

/** Each test gets a fresh copy of the built app and its one window. */
export const test = base.extend<{ app: ElectronApplication; page: Page }>({
  // Playwright reads a fixture's dependencies from this pattern, so it can't be left out.
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const app = await electron.launch({ executablePath: electronBinary, args: [appDir] });
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    await use(await app.firstWindow());
  },
});

export { expect } from "@playwright/test";
