import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch } = strings;
const gen = findSearch.generate;

test.describe("Find › Keywords › Make keywords", () => {
  test("crosses a tool with an angle and the keyword count rises", async ({ page }) => {
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.find.name}`) })
      .click();
    const heading = page.getByRole("heading", { level: 3, name: /^Keywords/ });
    await expect(heading).toBeVisible();
    const before = Number(
      ((await heading.textContent()) ?? "").match(/(\d[\d,]*)/)?.[1]?.replace(/,/g, ""),
    );

    await page.getByRole("button", { name: gen.open }).click();
    const panel = page.getByRole("group", { name: gen.panelLabel });
    for (const [label, term] of [
      [gen.newTool, "Zed editor"],
      [gen.newAngle, "setup guide"],
    ] as const) {
      await panel.getByRole("textbox", { name: label }).fill(term);
      await panel.getByRole("textbox", { name: label }).press("Enter");
    }
    // Untick everything, then tick just the two new terms: exactly one new keyword.
    for (const none of await panel.getByRole("button", { name: gen.none }).all()) {
      await none.click();
    }
    await panel.getByRole("button", { name: gen.tickLabel("Zed editor") }).click();
    await panel.getByRole("button", { name: gen.tickLabel("setup guide") }).click();
    await panel.getByRole("button", { name: gen.add(1) }).click();
    await expect(panel.getByText(gen.added(1))).toBeVisible();
    await expect(heading).toContainText(String(before + 1));
  });
});
