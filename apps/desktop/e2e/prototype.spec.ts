import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach, settings } = strings;
const text = strings.prototype;

const chip = (page: Page) => page.locator('[data-ui="frame.top.proto"]');
const bar = (page: Page) => page.locator(".cmt-bar");
const pins = (page: Page) => page.locator(".cmt-pin");
const toast = (page: Page, message: string) =>
  page.getByRole("status").filter({ hasText: message });

/** Everything prototype mode puts on the page is gone: no chip, no button, no bar, no pin. */
async function expectNoTrace(page: Page): Promise<void> {
  await expect(chip(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: text.commentOn, exact: true })).toHaveCount(0);
  await page.locator("body").press("c");
  await expect(bar(page)).toHaveCount(0);
  await expect(pins(page)).toHaveCount(0);
}

test.describe("Prototype mode", () => {
  test("is off at start, comes on in Settings, keeps comments across a scenario, and leaves no trace when off", async ({
    page,
    errors,
  }) => {
    test.setTimeout(90_000);

    // 1. Off at start.
    await expectNoTrace(page);

    // 2. Settings > Prototype mode: the switch reloads the window with the chip on.
    await page.keyboard.press("Control+Comma");
    await expect(
      page.getByRole("heading", { level: 1, name: screens.settings.name }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: settings.navLabel })
      .getByRole("button", { name: new RegExp(`^${screens.settings.tabs.prototype}`) })
      .click();
    await page.getByRole("switch", { name: text.switchLabel, exact: true }).click();
    // Turning on loads the six-month example history first (plan P8a, about 8 s), then reloads.
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    await expect(toast(page, text.toastOn)).toBeVisible();

    // 3. Comment on the first card of the Reach board.
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.reach.name}`) })
      .click();
    const waiting = page.getByRole("region", { name: reach.board.lanes.waiting.name });
    const card = waiting.getByRole("button").first();
    await expect(card).toBeVisible();
    await page.locator("body").press("c");
    await expect(bar(page)).toBeVisible();
    await card.click();
    const composer = page.getByRole("dialog", { name: text.cmt.newComment });
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox", { name: text.cmt.commentLabel }).fill("Make this clearer");
    await page.keyboard.press("Control+Enter");
    await expect(pins(page)).toHaveText("1");
    await expect(toast(page, text.cmt.saved(1))).toBeVisible();

    // 4. The list shows it.
    await chip(page).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${text.allComments}`) }).click();
    const list = page.getByRole("complementary", { name: text.cmt.listLabel });
    await expect(list).toBeVisible();
    await expect(list).toContainText("Make this clearer");

    // 5. A scenario pick reloads on a fresh copy; the comment stays.
    await chip(page).click();
    await page.getByRole("menuitemradio", { name: text.scenarios.first.name, exact: true }).click();
    await expect(chip(page)).toContainText(text.scenarios.first.short);
    if (!(await list.isVisible())) {
      await chip(page).click();
      await page.getByRole("menuitem", { name: new RegExp(`^${text.allComments}`) }).click();
    }
    await expect(page.getByRole("complementary", { name: text.cmt.listLabel })).toContainText(
      "Make this clearer",
    );

    // 6. Off again: no trace.
    await chip(page).click();
    await page.getByRole("menuitem", { name: text.turnOff }).click();
    await expect(chip(page)).toHaveCount(0);
    await expectNoTrace(page);

    expect(errors).toEqual([]);
  });
});
