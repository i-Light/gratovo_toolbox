import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findTriage, findActions, goHint } = strings;

const keywords = ["ai agents explained", "claude code tutorial"];
const run = { timeout: 60_000 };

test.describe("P3 Find and frame", () => {
  test("Review new fit fold-out, key 5 rejects as bot, G then R opens Reach", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);

    // A short example search fills Review new (the prototype history holds nothing to review).
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

    const card = page.getByRole("article");
    await expect(card).toBeVisible(run);
    const first = (await card.getAttribute("aria-label")) ?? "";
    expect(first).not.toBe("");

    // The fit fold-out lists its parts.
    const fold = page.locator('[data-ui="find.triage.fit-parts"]');
    await fold.getByText(findTriage.fitFold, { exact: true }).click();
    await expect(fold.getByRole("listitem").first()).toBeVisible();

    // 5 rejects with the bot reason.
    await page.keyboard.press("5");
    await expect(
      page.getByRole("status").filter({ hasText: findActions.reasons.bot }),
    ).toBeVisible();
    await expect(card).not.toHaveAttribute("aria-label", first);

    // G shows the hint bar; R jumps to Reach and the bar goes.
    const hint = page.locator('[data-ui="frame.go-hint"]');
    await page.keyboard.press("g");
    await expect(hint).toHaveText(new RegExp(`^${goHint.label}`));
    await page.keyboard.press("r");
    await expect(page.getByRole("heading", { level: 1, name: screens.reach.name })).toBeVisible();
    await expect(hint).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
