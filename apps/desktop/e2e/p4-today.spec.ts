import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, settings } = strings;
const proto = strings.prototype;
const menu = strings.today.screen.snoozeMenu;

test.describe("P4 Today", () => {
  test("queue, j moves, z snoozes, f opens focus and Escape brings the queue back", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);

    // Prototype mode on through Settings (the example history loads first, about 8 s).
    await page.keyboard.press("Control+Comma");
    await page
      .getByRole("navigation", { name: settings.navLabel })
      .getByRole("button", { name: new RegExp(`^${screens.settings.tabs.prototype}`) })
      .click();
    await page.getByRole("switch", { name: proto.switchLabel, exact: true }).click();
    await expect(page.locator('[data-ui="frame.top.proto"]')).toBeVisible({ timeout: 30_000 });

    // G then T opens Today.
    await page.keyboard.press("g");
    await page.keyboard.press("t");
    await expect(page.getByRole("heading", { level: 1, name: screens.today.name })).toBeVisible();

    const queue = page.locator('[data-ui="today.queue"]');
    await expect(queue).toBeVisible();
    expect(await page.locator('[data-ui^="today.queue.bucket."]').count()).toBeGreaterThanOrEqual(
      2,
    );

    const rows = page.locator('[data-ui="today.row"]');
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");

    // Z snoozes the current item to tomorrow morning.
    await page.keyboard.press("z");
    await page.getByRole("menuitem", { name: new RegExp(`^${menu.tomorrow}`) }).click();
    const snoozed = page.locator('[data-ui="today.snoozed"]');
    await expect(snoozed).toBeVisible();
    await expect(snoozed).toContainText(/[1-9]/);

    // F opens focus mode; Escape returns to the queue.
    await page.keyboard.press("f");
    await expect(page.locator('[data-ui="today.focus"]')).toBeVisible();
    await expect(queue).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(queue).toBeVisible();

    expect(errors).toEqual([]);
  });
});
