import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, rail, top } = strings;

test.describe("the app frame", () => {
  test("opens on Today with #/today in the URL", async ({ page }) => {
    await expect(page).toHaveURL(/#\/today$/);
    const today = page
      .getByRole("navigation", { name: rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.today.name}`) });
    await expect(today).toHaveAttribute("aria-current", "page");
  });

  test("follows the rail, Back and Forward", async ({ page }) => {
    const back = page.getByRole("button", { name: top.back });
    const forward = page.getByRole("button", { name: top.forward });
    const find = page
      .getByRole("navigation", { name: rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.find.name}`) });
    const findHeading = page.getByRole("heading", { level: 1, name: screens.find.name });
    const todayHeading = page.getByRole("heading", { level: 1, name: screens.today.name });

    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();

    await find.click();
    await expect(findHeading).toBeVisible();
    await expect(page).toHaveURL(/#\/find\/search$/);
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();

    await page.keyboard.press("Alt+ArrowLeft");
    await expect(todayHeading).toBeVisible();
    await expect(page).toHaveURL(/#\/today$/);
    await expect(back).toBeDisabled();
    await expect(forward).toBeEnabled();

    await page.keyboard.press("Alt+ArrowRight");
    await expect(findHeading).toBeVisible();
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();
  });

  test("opens Reach with G then R and Settings with Ctrl+,", async ({ page }) => {
    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page.getByRole("heading", { level: 1, name: screens.reach.name })).toBeVisible();

    await page.keyboard.press("Control+Comma");
    await expect(
      page.getByRole("heading", { level: 1, name: screens.settings.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: top.crumbs }).getByText(screens.settings.tabs.profile),
    ).toBeVisible();
  });

  test("collapses the rail with [, keeps it after a reload, and expands it again", async ({
    page,
  }) => {
    const app = page.locator(".app");
    const railBox = page.getByRole("navigation", { name: rail.label });

    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page).toHaveURL(/#\/reach\/board$/);

    await page.keyboard.press("[");
    await expect(app).toHaveClass(/rail-min/);
    await expect.poll(async () => (await railBox.boundingBox())?.width).toBe(64);

    await page.reload();
    await expect(railBox).toBeVisible();
    await expect(app).toHaveClass(/rail-min/);
    await expect(page).toHaveURL(/#\/reach\/board$/);
    await expect(page.getByRole("heading", { level: 1, name: screens.reach.name })).toBeVisible();

    await page.keyboard.press("[");
    await expect(app).not.toHaveClass(/rail-min/);
  });

  test("switches animation off right after a key press", async ({ page }) => {
    // The marker lasts 400 ms, which a slow machine can spend between the key and a later read,
    // so the page records the frame's transition at the moment the marker appears.
    await page.evaluate(() => {
      const root = document.documentElement;
      const seen: { input?: string; duration?: string } = {};
      Object.assign(globalThis, { quietSeen: seen });
      new MutationObserver(() => {
        if (seen.input === undefined && root.dataset["input"] !== undefined) {
          seen.input = root.dataset["input"];
          seen.duration = getComputedStyle(
            document.querySelector(".app") as Element,
          ).transitionDuration;
        }
      }).observe(root, { attributes: true, attributeFilter: ["data-input"] });
    });
    await page.keyboard.press("[");
    await expect
      .poll(() => page.evaluate(() => (globalThis as { quietSeen?: object }).quietSeen))
      .toEqual({ input: "kbd", duration: "0s" });
  });

  test("shows a drawer at 400 px that the Menu button opens and Esc closes", async ({
    app,
    page,
  }) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(400, 800);
    });
    await page.waitForFunction(() => matchMedia("(max-width: 760px)").matches);

    const frame = page.locator(".app");
    await page.getByRole("button", { name: top.menu }).click();
    await expect(frame).toHaveClass(/rail-open/);

    await page.keyboard.press("Escape");
    await expect(frame).not.toHaveClass(/rail-open/);

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  });
});
