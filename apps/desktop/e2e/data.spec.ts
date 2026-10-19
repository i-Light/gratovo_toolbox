import { access } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { top, rail, settings } = strings;

const bell = (page: Page) =>
  page.getByRole("button", { name: new RegExp(`^${top.notifications}(, \\d+ unread)?$`) });
const bellBadge = (page: Page) => bell(page).locator(".badge");
// "Saved" also shows on the Settings name row, so only the top bar's status counts here.
const saveState = (page: Page) => page.locator("header.top").getByRole("status");

/** Opens the bell's tray and marks everything read. */
async function markAllRead(page: Page): Promise<void> {
  await bell(page).click();
  await page.getByRole("button", { name: strings.trays.markAllRead }).click();
  await expect(bellBadge(page)).toHaveCount(0);
}

/** Waits for the write to go through: the bar shows "Saving…", then "Saved". */
async function waitForSaved(page: Page): Promise<void> {
  await expect(saveState(page)).toHaveText(top.saving);
  await expect(saveState(page)).toHaveText(top.saved);
}

/** Collects every console error and uncaught page error of a window. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

test.describe("the data layer", () => {
  test("opens example.db in the data folder at start", async ({ page, userData }) => {
    await expect(bellBadge(page)).toHaveText("3");
    await expect(access(join(userData, "example.db"))).resolves.toBeUndefined();
  });

  test("keeps Mark all read after a restart", async ({ page, relaunch }) => {
    const errors = watchErrors(page);
    await markAllRead(page);
    await waitForSaved(page);

    const again = await relaunch();
    const errorsAgain = watchErrors(again);
    await expect(bellBadge(again)).toHaveCount(0);
    await expect(bell(again)).toBeVisible();
    expect([...errors, ...errorsAgain]).toEqual([]);
  });

  test("keeps your name after a restart", async ({ page, relaunch }) => {
    const errors = watchErrors(page);
    await expect(page.locator(".rail .me")).toContainText(rail.addName);

    await page.keyboard.press("Control+Comma");
    const name = page.getByRole("textbox", { name: settings.rows.name.label });
    await name.fill("Maya Chen");
    await name.press("Enter");
    await waitForSaved(page);

    const again = await relaunch();
    const errorsAgain = watchErrors(again);
    await expect(again.locator(".rail .me")).toContainText("Maya Chen");
    await expect(again.locator(".rail .me")).not.toContainText(rail.addName);
    expect([...errors, ...errorsAgain]).toEqual([]);
  });

  test("writes the undo of Mark all read, so the unread come back after a restart", async ({
    page,
    relaunch,
  }) => {
    const errors = watchErrors(page);
    await markAllRead(page);
    await waitForSaved(page);

    await page.keyboard.press("Control+Z");
    await expect(bellBadge(page)).toHaveText("3");
    await waitForSaved(page);

    const again = await relaunch();
    const errorsAgain = watchErrors(again);
    await expect(bellBadge(again)).toHaveText("3");
    expect([...errors, ...errorsAgain]).toEqual([]);
  });
});
