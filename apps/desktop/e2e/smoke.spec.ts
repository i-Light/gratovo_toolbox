import { expect, test } from "./fixtures";

test("opens one window with the app's name", async ({ app, page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Gratovo Toolbox" })).toBeVisible();
  await expect(page).toHaveTitle("Gratovo Toolbox");
  expect(app.windows()).toHaveLength(1);
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
