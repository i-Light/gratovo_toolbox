import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { settings, top, rail, menu } = strings;
const { tabs } = strings.screens.settings;

const bell = (page: Page) =>
  page.getByRole("button", { name: new RegExp(`^${top.notifications}`) });
const bellBadge = (page: Page) => bell(page).locator(".badge");
const accountButton = (page: Page) =>
  page.getByRole("button", { name: new RegExp(rail.roleOnline("Owner")) });
const sectionHeading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });
const sectionList = (page: Page) => page.getByRole("navigation", { name: settings.navLabel });

/** Opens Settings with Ctrl+, and waits for its heading. */
async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await expect(
    page.getByRole("heading", { level: 1, name: strings.screens.settings.name }),
  ).toBeVisible();
}

test.describe("the Settings screen", () => {
  test("opens Profile from the account menu, and the name you type shows in the sidebar", async ({
    page,
  }) => {
    await accountButton(page).click();
    await page.getByRole("menuitem", { name: menu.settings }).click();
    await expect(sectionHeading(page, tabs.profile)).toBeVisible();
    await expect(page).toHaveURL(/#\/settings\/profile$/);

    const name = page.getByRole("textbox", { name: settings.rows.name.label });
    await name.fill("Maya Chen");
    await name.press("Enter");

    await expect(page.locator(".rail .me")).toContainText("Maya Chen");
    await expect(page.locator(".rail .me")).not.toContainText(rail.addName);
  });

  test("finds Density with Ctrl+F and focuses its first control", async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press("Control+F");
    const search = page.getByRole("textbox", { name: settings.find });
    await expect(search).toBeFocused();
    await search.fill("compact");

    await page.getByRole("button", { name: new RegExp(`^${settings.rows.density.label}`) }).click();

    await expect(sectionHeading(page, tabs.appearance)).toBeVisible();
    await expect(search).toHaveValue("");
    await expect(
      page
        .getByRole("group", { name: settings.rows.density.label, exact: true })
        .getByRole("button")
        .first(),
    ).toBeFocused();
  });

  test("turns Replies off and back on with Ctrl+Z, and the bell's count follows", async ({
    page,
  }) => {
    await expect(bellBadge(page)).toHaveText("3");
    await openSettings(page);
    await sectionList(page)
      .getByRole("button", { name: new RegExp(`^${tabs.notifications}`) })
      .click();

    const replies = page.getByRole("switch", {
      name: settings.notify.reply.label,
      exact: true,
    });
    await replies.click();
    await expect(bellBadge(page)).toHaveText("2");

    await page.keyboard.press("Control+Z");
    await expect(bellBadge(page)).toHaveText("3");
    await expect(replies).toBeChecked();
  });
});
