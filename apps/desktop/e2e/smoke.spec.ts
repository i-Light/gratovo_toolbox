import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

test("opens one window with the app's name and the frame on Today", async ({ app, page }) => {
  await expect(page).toHaveTitle(strings.appName);
  await expect(page.getByRole("navigation", { name: strings.rail.label })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: strings.screens.today.name }),
  ).toBeVisible();
  expect(app.windows()).toHaveLength(1);
});

test("has no application menu, so nothing sits above the frame", async ({ app }) => {
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true);
});

test("loads both fonts from the app's own files", async ({ page }) => {
  // The Ctrl K hint is set in the mono font, so it is on the page; it is checked before the fonts
  // are awaited so the browser has asked for them.
  await expect(page.locator(".cmdk .kbd")).toBeVisible();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts].map((face) => ({
      family: face.family.replaceAll(/["']/g, ""),
      status: face.status,
    }));
    return {
      // At the weights the page uses: check() says false for a face nobody has asked for yet,
      // such as Plex 400 when only the 500 key hints are on screen.
      ui: document.fonts.check("400 16px 'Readex Pro'"),
      mono: document.fonts.check("500 16px 'IBM Plex Mono'"),
      faces,
    };
  });
  expect(fonts.ui).toBe(true);
  expect(fonts.mono).toBe(true);
  for (const family of ["Readex Pro", "IBM Plex Mono"]) {
    const loaded = fonts.faces.filter((face) => face.family === family && face.status === "loaded");
    expect(loaded.length).toBeGreaterThan(0);
  }
  // A face that was asked for must not have failed; unused faces stay "unloaded".
  expect(fonts.faces.filter((face) => face.status === "error")).toEqual([]);
});

test("applies the design tokens in light and in dark", async ({ page }) => {
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
