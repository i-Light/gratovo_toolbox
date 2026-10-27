import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, closeScreen, close } = strings;

// Example creators at the media-kit stage (packages/core example.ts): one passes the audience
// check, one fails it, one has numbers missing.
const passing = "AgentWorks";
const failing = "Silicon Sage";
const missing = "Context Window";

test.describe("Close › Roster", () => {
  test("a creator who passes the audience check is signed in one click and moves to the signed table", async ({
    page,
    errors,
  }) => {
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.close.name}`) })
      .click();

    const waiting = page.getByRole("region", {
      name: new RegExp(`^${closeScreen.roster.kitsTitle}`),
    });
    await expect(waiting).toBeVisible();
    for (const [name, words] of [
      [passing, closeScreen.roster.verdict.pass],
      [failing, closeScreen.roster.verdict.fail("")],
      [missing, closeScreen.roster.verdict.missing],
    ] as const) {
      const row = waiting.locator('[data-ui="close.roster.kit.row"]').filter({ hasText: name });
      await expect(row).toContainText(words);
    }

    // Open AgentWorks's check and sign from it.
    const row = waiting.locator('[data-ui="close.roster.kit.row"]').filter({ hasText: passing });
    await row.getByRole("button", { name: new RegExp(`^${closeScreen.roster.show}$`) }).click();
    const check = row.getByLabel(close.audience.checkLabel);
    await expect(check).toBeVisible();
    await check
      .getByRole("button", { name: new RegExp(`^${close.audience.sign("").trim()}`) })
      .click();

    const toast = page.getByRole("status").filter({ hasText: new RegExp(`${passing} is signed`) });
    await expect(toast).toBeVisible();

    // AgentWorks left the waiting card and is in the signed table.
    await expect(waiting.getByText(passing, { exact: true })).toHaveCount(0);
    await expect(waiting.getByText(failing, { exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: closeScreen.roster.tableLabel });
    await expect(
      table.getByRole("button", {
        name: new RegExp(`^${closeScreen.roster.openCreator(passing)}$`),
      }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
