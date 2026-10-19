import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { palette, shortcuts, peek, trays, top, actions, menu } = strings;

const paletteDialog = (page: Page) => page.getByRole("dialog", { name: palette.label });
const sheetDialog = (page: Page) => page.getByRole("dialog", { name: shortcuts.label });
const peekPanel = (page: Page) => page.getByRole("complementary", { name: peek.label });
const bell = (page: Page) => page.getByRole("button", { name: top.notifications, exact: true });
const bellBadge = (page: Page) => bell(page).locator(".badge");
const accountButton = (page: Page) => page.getByRole("button", { name: /^Your account/ });
// A toast's text also holds its sub line ("Undone" + "Marked notifications read"), so it is found
// by the words it contains, not by an exact text match.
const toastSaying = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

/** Opens the palette, finds Prompt Lab and opens it in the peek. */
async function openPromptLabInPeek(page: Page): Promise<void> {
  await page.keyboard.press("Control+K");
  await expect(paletteDialog(page)).toBeVisible();
  await page.keyboard.type("prompt");
  await page.keyboard.press("Enter");
  await expect(paletteDialog(page)).toBeHidden();
  await expect(peekPanel(page).getByRole("heading", { name: "Prompt Lab" })).toBeVisible();
}

/** Opens the bell's tray and marks everything read. */
async function markAllRead(page: Page): Promise<void> {
  await bell(page).click();
  await page.getByRole("button", { name: trays.markAllRead }).click();
  await expect(bellBadge(page)).toHaveCount(0);
}

test.describe("the overlays", () => {
  test("finds a record from the palette, opens it in the peek, and / opens the palette again", async ({
    page,
  }) => {
    await openPromptLabInPeek(page);
    await expect(peekPanel(page).getByText(strings.record.fullRecordLater)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(peekPanel(page)).toBeHidden();

    await page.keyboard.press("/");
    await expect(paletteDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();
  });

  test("Esc closes the palette over the peek and leaves the peek", async ({ page }) => {
    await openPromptLabInPeek(page);
    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();
    await expect(peekPanel(page)).toBeVisible();
  });

  test("undoes and redoes Mark all read with the keyboard", async ({ page }) => {
    await expect(bellBadge(page)).toHaveText("3");
    await markAllRead(page);

    await page.keyboard.press("Control+Z");
    await expect(bellBadge(page)).toHaveText("3");
    await expect(toastSaying(page, actions.undone)).toBeVisible();

    await page.keyboard.press("Control+Shift+Z");
    await expect(bellBadge(page)).toHaveCount(0);
    await expect(toastSaying(page, actions.redone)).toBeVisible();
  });

  test("opens the account menu on the first item and gives focus back on Esc", async ({ page }) => {
    await accountButton(page).click();
    const menuBox = page.getByRole("menu");
    await expect(menuBox.getByRole("menuitem", { name: menu.settings })).toBeVisible();
    await expect(menuBox.getByRole("menuitem").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menuBox).toBeHidden();
    await expect(accountButton(page)).toBeFocused();
  });

  test("keeps G then R and Ctrl+Z from reaching the page behind a palette or the sheet", async ({
    page,
  }) => {
    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page).toHaveURL(/#\/today$/);
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();

    await page.keyboard.press("?");
    await expect(sheetDialog(page)).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page).toHaveURL(/#\/today$/);
    await page.keyboard.press("Escape");
    await expect(sheetDialog(page)).toBeHidden();

    // Something to undo, so a leaking Ctrl+Z would show.
    await markAllRead(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    await page.keyboard.press("Control+Z");
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();
    await expect(bellBadge(page)).toHaveCount(0);
    await expect(toastSaying(page, actions.undone)).toBeHidden();
  });

  test("opens the palette with no animation", async ({ page }) => {
    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    const animationName = await page.evaluate(() => {
      const pal = document.querySelector(".pal");
      return pal === null ? null : getComputedStyle(pal).animationName;
    });
    expect(animationName).toBe("none");
  });

  test("makes the page behind the palette inert and keeps Tab inside the dialog", async ({
    page,
  }) => {
    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    await expect(page.getByRole("combobox", { name: palette.inputLabel })).toBeFocused();

    // Past the dialog's last control Chromium may leave focus on the page itself; what must never
    // happen is focus landing on a control behind the dialog.
    const focusBehindDialog = () =>
      page.evaluate(() => {
        const focused = document.activeElement;
        return focused !== null && focused !== document.body && focused.closest("dialog") === null;
      });
    for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await focusBehindDialog()).toBe(false);
    }
    await expect(paletteDialog(page)).toBeVisible();
  });

  test("shows a toast above the palette", async ({ page }) => {
    await markAllRead(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Z");
    const toast = toastSaying(page, actions.undone);
    await expect(toast).toBeVisible();

    await page.keyboard.press("Control+K");
    await expect(paletteDialog(page)).toBeVisible();
    await expect(toast).toBeVisible();
    // The toast is the top element at its own middle: the modal's layer does not cover it.
    await expect
      .poll(() =>
        toast.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit !== null && el.contains(hit);
        }),
      )
      .toBe(true);
  });

  test("opens the shortcut sheet with ? and closes it with Esc", async ({ page }) => {
    // "Shift+/" would send "/", which opens the palette, so the key is "?".
    await page.keyboard.press("?");
    const sheet = sheetDialog(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toBeFocused();
    await expect(sheet.getByRole("heading", { level: 4 })).toHaveCount(shortcuts.groups.length);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
