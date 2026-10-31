import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, settings, closeScreen, creatorRecord, dealRecord, brandRecord, peek } = strings;
const text = strings.prototype;

test.describe("Records", () => {
  test("a signed creator's Deals tab opens a deal, and the deal's brand link opens the brand", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);

    // The plain example copy has no catalog rows for creators, so use prototype mode: it loads the
    // example history, and its creators are full records.
    await page.keyboard.press("Control+Comma");
    await page
      .getByRole("navigation", { name: settings.navLabel })
      .getByRole("button", { name: new RegExp(`^${screens.settings.tabs.prototype}`) })
      .click();
    await page.getByRole("switch", { name: text.switchLabel, exact: true }).click();
    await expect(page.locator('[data-ui="frame.top.proto"]')).toBeVisible({ timeout: 30_000 });

    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.close.name}`) })
      .click();
    const table = page.getByRole("table", { name: closeScreen.roster.tableLabel });
    const side = page.getByRole("complementary", { name: peek.label });

    // Prompt Lab is a signed example creator with deals in the seed.
    await table.getByRole("button", { name: /^Open Prompt Lab/ }).click();
    await expect(side.getByRole("tablist", { name: creatorRecord.tabsLabel })).toBeVisible();
    await expect(
      side.getByText(strings.record.stages.signed, { exact: true }).first(),
    ).toBeVisible();
    await side.getByRole("tab", { name: new RegExp(`^${creatorRecord.tabs.deals}`) }).click();
    await expect(side.getByRole("button", { name: /Open the deal/ }).first()).toBeVisible();

    // The deal: its heading is "Brand × Creator", and it has the three deal tabs.
    await side
      .getByRole("button", { name: /Open the deal/ })
      .first()
      .click();
    await expect(side.getByRole("tablist", { name: dealRecord.tabsLabel })).toBeVisible();
    await expect(side.getByRole("heading", { level: 2 })).toContainText(" × ");

    // The deal's brand link opens the brand record.
    await side.locator('[data-ui="record.brand-link"]').click();
    await expect(side.getByRole("tablist", { name: brandRecord.tabsLabel })).toBeVisible();
    await expect(side.getByRole("heading", { level: 2 })).not.toContainText(" × ");

    expect(errors).toEqual([]);
  });
});
