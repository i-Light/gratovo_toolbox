import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { rail: railText, palette } = strings;
const { screens } = strings;
const connections = strings.settings.connections;
const rows = strings.settings.rows;

const rail = (page: Page) => page.getByRole("navigation", { name: railText.label });
// A rail button's name is the screen's name, then its one-line subtitle.
const railName = (name: string, sub: string | null) =>
  new RegExp(`^${name}${sub === null ? "$" : ` ${sub}$`}`);

test.describe("the live gate, against a fake Supabase", () => {
  test("a fresh live user sees only what is wired, and lands on Connections", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await startSigned({ ready: "page" });

    await page.getByLabel(strings.auth.signIn.email).fill(owner.email);
    await page.getByLabel(strings.auth.signIn.password, { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: strings.auth.signIn.submit, exact: true }).click();
    await expect(rail(page)).toBeVisible({ timeout: 15_000 });

    // The rail offers what is wired to real data, and nothing else: Find, named for what is wired.
    await expect(
      rail(page).getByRole("button", {
        name: railName(screens.find.name, screens.find.subLive),
      }),
    ).toBeVisible();
    // Toolbox is wired too (plan D34): Archive, Never contact, Scheduled emails and the Activity log.
    await expect(
      rail(page).getByRole("button", {
        name: railName(screens.toolbox.name, screens.toolbox.sub),
      }),
    ).toBeVisible();
    // Reach is wired from plan step 6a (the board), 6b (Mailboxes) and 6c (Sequences), named for what is wired.
    await expect(
      rail(page).getByRole("button", {
        name: railName(screens.reach.name, screens.reach.subLive),
      }),
    ).toBeVisible();
    for (const key of ["today", "close", "deliver", "insights", "team"] as const) {
      await expect(
        rail(page).getByRole("button", { name: railName(screens[key].name, screens[key].sub) }),
      ).toHaveCount(0);
    }

    // First run: never imported, so the app ends on Settings > Connections.
    await expect.poll(() => page.url()).toMatch(/#\/settings\/connections$/);
    await expect(
      page.getByRole("heading", { level: 2, name: strings.screens.settings.tabs.connections }),
    ).toBeVisible();

    // The rows are there; the Python row shows a state (the connections:status round trip).
    const python = page.locator("#set-connPython");
    await expect(python.getByText(rows.connPython.label, { exact: true })).toBeVisible();
    await expect(
      python.getByText(new RegExp(`^(${connections.tags.ready}|${connections.tags.missing})$`)),
    ).toBeVisible();
    const old = page.locator("#set-connOld");
    await expect(old.getByText(connections.old.never, { exact: true })).toBeVisible();

    // The palette offers no way to a hidden screen.
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: palette.label });
    await page.getByRole("combobox", { name: palette.inputLabel }).fill("Today");
    await expect(page.getByRole("combobox", { name: palette.inputLabel })).toHaveValue("Today");
    await expect(dialog.getByRole("option", { name: /Go to Today/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    expect(signedErrors).toEqual([]);
  });
});
