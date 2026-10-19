import { createRequire } from "node:module";
import { join } from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// Windows is the only system the app supports, so these tests run there (in CI and on team
// machines).
const appDir = join(__dirname, "..");

// Run from Node, the electron package exports the path to its binary.
const requireFromHere = createRequire(__filename);
const electronBinary = requireFromHere("electron") as string;

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  app = await electron.launch({ executablePath: electronBinary, args: [appDir] });
  page = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
});

test("opens one window with the app's name", async () => {
  await expect(page.getByRole("heading", { level: 1, name: "Gratovo Toolbox" })).toBeVisible();
  await expect(page).toHaveTitle("Gratovo Toolbox");
  expect(app.windows()).toHaveLength(1);
});

test("applies the design tokens in light and in dark", async () => {
  const light = "rgb(242, 245, 249)"; // --bg, light
  const dark = "rgb(6, 19, 29)"; // --bg, dark
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const chooseTheme = (theme: "light" | "dark") =>
    page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);

  await page.emulateMedia({ colorScheme: "light" });
  expect(await background()).toBe(light);

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe(dark);

  // A theme chosen in Settings wins over the system's.
  await chooseTheme("light");
  expect(await background()).toBe(light);

  await page.emulateMedia({ colorScheme: "light" });
  await chooseTheme("dark");
  expect(await background()).toBe(dark);
});

test("keeps Node out of the page", async () => {
  const globals = await page.evaluate(() => {
    const scope = globalThis as Record<string, unknown>;
    return [typeof scope["require"], typeof scope["process"], typeof scope["module"]];
  });
  expect(globals).toEqual(["undefined", "undefined", "undefined"]);
});

test("runs the page in the operating system's sandbox", async () => {
  const renderers = await app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((metric) => metric.type === "Tab")
      .map((metric) => metric.sandboxed),
  );
  expect(renderers.length).toBeGreaterThan(0);
  expect(renderers.every((sandboxed) => sandboxed === true)).toBe(true);
});

test("refuses to open new windows", async () => {
  const opened = await page.evaluate(() => window.open("https://example.com") === null);
  expect(opened).toBe(true);
  expect(app.windows()).toHaveLength(1);
});

test("ships a strict content security policy", async () => {
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self';");
  expect(policy).not.toContain("unsafe-inline");
});
