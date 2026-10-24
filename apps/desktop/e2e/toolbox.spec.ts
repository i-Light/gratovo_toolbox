import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findActions, toolbox } = strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

test.describe("Toolbox", () => {
  test("a rejected channel waits in Archive; Bring back returns it and the log shows both", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);
    const rail = page.getByRole("navigation", { name: strings.rail.label });
    await rail.getByRole("button", { name: new RegExp(`^${screens.find.name}`) }).click();
    await page
      .getByRole("textbox", { name: findSearch.keywords.inputLabel })
      .fill(keywords.join("\n"));
    await page.getByRole("button", { name: findSearch.keywords.add }).click();
    await page.getByRole("button", { name: findSearch.live.start }).click();
    await expect(page.getByRole("heading", { level: 3, name: findSearch.live.done })).toBeVisible(
      run,
    );

    // Key 1 rejects with the first reason.
    await page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.triage}`) }).click();
    await expect(page.getByRole("article")).toBeVisible(run);
    const name = ((await page.getByRole("article").getAttribute("aria-label")) ?? "").trim();
    expect(name).not.toBe("");
    await page.keyboard.press("1");

    // The channel waits in Archive with its countdown.
    await rail.getByRole("button", { name: new RegExp(`^${screens.toolbox.name}`) }).click();
    const bringBack = page.getByRole("button", { name: toolbox.archive.bringBackLabel(name) });
    await expect(bringBack).toBeVisible();
    await expect(page.getByText(toolbox.archive.inDays(7))).toBeVisible();

    // Bring back: it leaves the list.
    await bringBack.click();
    await expect(bringBack).toBeHidden();

    // The log has both lines, newest first.
    await page.getByRole("button", { name: new RegExp(`^${screens.toolbox.tabs.log}`) }).click();
    await expect(page.locator(".tb-line")).toHaveText([
      findActions.broughtBack(name),
      findActions.rejected(name),
    ]);

    expect(errors).toEqual([]);
  });
});
