import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findTriage } = strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

const card = (page: Page) => page.getByRole("article");

test.describe("Find › Review new", () => {
  test("a search fills Review new; S shortlists, Ctrl+Z brings the channel back", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.find.name}`) })
      .click();
    await page
      .getByRole("textbox", { name: findSearch.keywords.inputLabel })
      .fill(keywords.join("\n"));
    await page.getByRole("button", { name: findSearch.keywords.add }).click();
    await page.getByRole("button", { name: findSearch.live.start }).click();
    await expect(page.getByRole("heading", { level: 3, name: findSearch.live.done })).toBeVisible(
      run,
    );

    await page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.triage}`) }).click();
    await expect(card(page)).toBeVisible(run);
    const first = (await card(page).getAttribute("aria-label")) ?? "";
    expect(first).not.toBe("");

    // S shortlists: the next channel shows at once and the tally counts it.
    await page.keyboard.press("s");
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    await expect(card(page)).not.toHaveAttribute("aria-label", first);

    // Undo brings the first channel back.
    await page.keyboard.press("Control+z");
    await expect(card(page)).toHaveAttribute("aria-label", first);

    expect(errors).toEqual([]);
  });
});
