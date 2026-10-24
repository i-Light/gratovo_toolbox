import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findGallery } = strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

/** How many channels the gallery says it holds ("12 channels"). */
async function channelCount(page: Page): Promise<number> {
  const line = page.getByText(/^\d+ channels?$/);
  await expect(line).toBeVisible(run);
  return Number.parseInt((await line.innerText()).split(" ")[0] ?? "", 10);
}

test.describe("Find › Gallery", () => {
  test("a search fills the gallery; a facet narrows it; compare and the peek open", async ({
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

    await page.getByRole("tab", { name: screens.find.tabs.gallery }).click();
    const cards = page.getByRole("listitem").filter({ has: page.locator("button.gopen") });
    await expect(cards.first()).toBeVisible(run);
    const all = await channelCount(page);
    expect(all).toBeGreaterThan(2);
    await expect(cards).toHaveCount(all);

    // A facet narrows the list: the count drops and the filter shows as a chip.
    await page
      .getByRole("group", { name: findGallery.facets.signals })
      .getByRole("button", { name: new RegExp(`^${findGallery.signals.sponsored}`) })
      .click();
    await expect.poll(() => channelCount(page)).toBeLessThan(all);
    await page.getByRole("button", { name: findGallery.chips.clearAll }).click();
    await expect.poll(() => channelCount(page)).toBe(all);

    // Ctrl-click two cards, then Compare.
    const open = page.getByRole("button", { name: /^Open / });
    await open.nth(0).click({ modifiers: ["Control"] });
    await open.nth(1).click({ modifiers: ["Control"] });
    const bar = page.getByRole("toolbar", { name: findGallery.bulk.label });
    await expect(bar.getByText(findGallery.bulk.selected(2))).toBeVisible();
    await bar.getByRole("button", { name: findGallery.bulk.compare }).click();
    await expect(page.getByRole("region", { name: findGallery.compare.title(2) })).toBeVisible();
    await bar.getByRole("button", { name: findGallery.bulk.clear }).click();

    // A plain click opens the creator peek on its Overview; Esc closes it.
    await open.nth(0).click();
    const peek = page.getByRole("complementary", { name: strings.peek.label });
    await expect(peek).toBeVisible();
    await expect(
      peek.getByRole("tab", { name: strings.creatorRecord.tabs.overview, selected: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(peek).toBeHidden();

    expect(errors).toEqual([]);
  });
});
