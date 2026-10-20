import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { palette, shortcuts, peek, top, rail, menu, settings } = strings;
const { tabs } = strings.screens.settings;

const desktop = { width: 1440, height: 900 } as const;

const sectionKeys = Object.keys(tabs) as (keyof typeof tabs)[];

/** Checks the page as it is now; the violations are listed together at the end of the test. */
type Report = (scene: string) => Promise<void>;

/**
 * Waits until every finite CSS animation and transition has ended, so axe reads the final colours
 * (a fade in progress would blend text with what is behind it).
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

function makeReport(page: Page, found: string[]): Report {
  return async (scene) => {
    await settle(page);
    // Legacy mode runs axe inside this page. The default mode opens a second page to finish the
    // run, which an Electron app can't do.
    const result = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    for (const violation of result.violations) {
      const targets = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" ; ");
      found.push(
        `${scene}: ${violation.id} (${violation.impact ?? "n/a"}), ${String(violation.nodes.length)} element(s): ${targets}`,
      );
    }
  };
}

async function closeWithEscape(page: Page, closed: Locator): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(closed).toBeHidden();
}

/** Opens each settings section from the list and checks it. */
async function checkSections(page: Page, report: Report): Promise<void> {
  await page.keyboard.press("Control+Comma");
  const list = page.getByRole("navigation", { name: settings.navLabel });
  await expect(list).toBeVisible();
  for (const key of sectionKeys) {
    const button = list.getByRole("button", { name: new RegExp(`^${tabs[key]}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await report(`settings: ${tabs[key]}`);
  }
}

async function runScenes(page: Page): Promise<void> {
  await page.setViewportSize(desktop);
  await page.waitForFunction((width) => window.innerWidth === width, desktop.width);
  const found: string[] = [];
  const report = makeReport(page, found);
  const paletteDialog = page.getByRole("dialog", { name: palette.label });
  const sheetDialog = page.getByRole("dialog", { name: shortcuts.label });

  await expect(
    page.getByRole("heading", { level: 1, name: strings.screens.today.name }),
  ).toBeVisible();
  await report("frame (Today)");

  await page.keyboard.press("Control+K");
  await expect(paletteDialog).toBeVisible();
  await report("palette");
  await closeWithEscape(page, paletteDialog);

  // "Shift+/" would send "/", which opens the palette, so the key is "?".
  await page.keyboard.press("?");
  await expect(sheetDialog).toBeVisible();
  await report("shortcut sheet");
  await closeWithEscape(page, sheetDialog);

  const menuBox = page.getByRole("menu");
  await page.getByRole("button", { name: new RegExp(rail.roleOnline("Owner")) }).click();
  await expect(menuBox.getByRole("menuitem", { name: menu.settings })).toBeVisible();
  await report("account menu");
  await closeWithEscape(page, menuBox);

  const trayHeading = page.getByRole("heading", { name: strings.trays.notificationsHeading });
  await page
    .getByRole("button", { name: new RegExp(`^${top.notifications}(, \\d+ unread)?$`) })
    .click();
  await expect(trayHeading).toBeVisible();
  await report("notifications tray");
  await closeWithEscape(page, trayHeading);

  const jobsHeading = page.getByRole("heading", { name: strings.trays.jobsHeading });
  await page.getByRole("button", { name: top.jobs, exact: true }).click();
  await expect(jobsHeading).toBeVisible();
  await report("jobs tray");
  await closeWithEscape(page, jobsHeading);

  // Nothing has changed yet, so Ctrl+Z shows the "Nothing to undo" toast.
  await page.keyboard.press("Control+Z");
  await expect(
    page.getByRole("status").filter({ hasText: strings.actions.nothingToUndo }),
  ).toBeVisible();
  await report("toast");

  await page.keyboard.press("Control+K");
  await expect(paletteDialog).toBeVisible();
  await page.keyboard.type("prompt");
  await page.keyboard.press("Enter");
  await expect(paletteDialog).toBeHidden();
  const peekPanel = page.getByRole("complementary", { name: peek.label });
  await expect(peekPanel.getByRole("heading", { name: "Prompt Lab" })).toBeVisible();
  await report("peek");
  await closeWithEscape(page, peekPanel);

  await checkSections(page, report);

  const search = page.getByRole("textbox", { name: settings.find });
  await search.fill("compact");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${settings.rows.density.label}`) }),
  ).toBeVisible();
  await report("settings search: compact");
  await search.fill("zzzz");
  await expect(page.getByText(settings.noMatch("zzzz"))).toBeVisible();
  await report("settings search: no match");

  expect(found, `WCAG violations:\n${found.join("\n")}`).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test("dark, 1440x900", async ({ page }) => {
    test.setTimeout(120_000);
    await runScenes(page);
  });
});

test.describe("accessibility of the sign-in screens (axe, WCAG 2.2 AA)", () => {
  test("sign-in (empty and with an error) and the waiting screen, dark, 1440x900", async ({
    supabase,
    startSigned,
  }) => {
    test.setTimeout(120_000);
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const newcomer = supabase.addUser({ email: "sam@example.com", role: "unauthorized" });
    const { page } = await startSigned({ ready: "page" });
    await page.setViewportSize(desktop);
    await page.waitForFunction((width) => window.innerWidth === width, desktop.width);
    const found: string[] = [];
    const report = makeReport(page, found);
    const { signIn, waiting } = strings.auth;

    await expect(page.getByRole("heading", { level: 1, name: signIn.title })).toBeVisible();
    await report("sign-in: empty");

    await page.getByLabel(signIn.email).fill(newcomer.email);
    await page.getByLabel(signIn.password, { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: signIn.submit, exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(signIn.problems.invalid);
    await report("sign-in: with an error");

    await page.getByLabel(signIn.password, { exact: true }).fill(newcomer.password);
    await page.getByRole("button", { name: signIn.submit, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: waiting.title })).toBeVisible();
    await report("waiting");

    await page.getByRole("button", { name: waiting.check, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(waiting.stillWaiting);
    await report("waiting: still waiting");

    expect(found, `WCAG violations:\n${found.join("\n")}`).toEqual([]);
  });
});
