import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch } = strings;

const keywords = ["ai video editor review", "claude code tutorial", "ai agents explained"];
const foundText = /^\d+ found · \d+ kept$/;
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

const openSearch = async (page: Page): Promise<void> => {
  await page
    .getByRole("navigation", { name: strings.rail.label })
    .getByRole("button", { name: new RegExp(`^${screens.find.name}`) })
    .click();
  // The list shows only once it has rows, so the paste box is what says the screen is ready.
  await expect(page.getByRole("textbox", { name: findSearch.keywords.inputLabel })).toBeVisible();
};

const rows = (page: Page) =>
  page.getByRole("list", { name: findSearch.keywords.listLabel }).getByRole("listitem");
const kept = (page: Page) =>
  page.getByRole("list", { name: findSearch.kept.listLabel }).getByRole("listitem");
const headline = (page: Page) =>
  page.getByRole("heading", { level: 3, name: /Searching|Paused|Finished/ });

test.describe("Find › Search", () => {
  test("adds keywords, runs, pauses, resumes and keeps it all after a restart", async ({
    page,
    relaunch,
    errors,
  }) => {
    test.setTimeout(180_000);
    await openSearch(page);

    // 1. Paste three keywords and a duplicate.
    await page
      .getByRole("textbox", { name: findSearch.keywords.inputLabel })
      .fill([...keywords, keywords[0]].join("\n"));
    await page.getByRole("button", { name: findSearch.keywords.add }).click();
    await expect(page.getByRole("status").filter({ hasText: /Added 3 keywords/ })).toHaveText(
      findSearch.keywords.added(3, 1),
    );
    await expect(rows(page)).toHaveCount(3);
    for (const [i, keyword] of keywords.entries()) {
      await expect(rows(page).nth(i)).toContainText(keyword);
      await expect(rows(page).nth(i)).toContainText(/queued|next up/);
    }

    // 2. Start.
    await page.getByRole("button", { name: findSearch.live.start }).click();
    await expect(headline(page)).toContainText("Searching “", run);
    await expect(page.getByRole("log", { name: findSearch.live.logLabel })).not.toContainText(
      findSearch.live.logEmpty,
      run,
    );
    await expect(rows(page).nth(0).getByText(foundText)).toBeVisible(run);
    await expect(kept(page).first()).toBeVisible(run);

    // 3. Pause while the second keyword runs.
    await expect(rows(page).nth(1)).toContainText(findSearch.keywords.searching, run);
    await page.getByRole("button", { name: findSearch.live.pause }).click();
    await expect(headline(page)).toContainText(/^Paused at keyword \d+/, run);
    const resume = page.getByRole("button", { name: /^Resume at keyword \d+$/ });
    await expect(resume).toBeVisible(run);
    const at = Number(/(\d+)$/.exec((await resume.textContent()) ?? "")?.[1]);
    expect([2, 3]).toContain(at);

    // 4. Resume to the end.
    await resume.click();
    await expect(headline(page)).toHaveText(findSearch.live.done, run);
    for (let i = 0; i < 3; i++) {
      await expect(rows(page).nth(i).getByText(foundText)).toBeVisible(run);
    }
    await expect(page.getByRole("button", { name: findSearch.live.pause })).toHaveCount(0);

    const before = await rows(page).allTextContents();
    const keptBefore = await kept(page).allTextContents();
    expect(keptBefore.length).toBeGreaterThan(0);

    // 5. Restart on the same data folder.
    const again = await relaunch();
    await openSearch(again);
    await expect(rows(again)).toHaveCount(3);
    await expect(again.getByText(findSearch.live.progress(3, 3), { exact: true })).toBeVisible();
    // The run itself starts fresh after a restart; the screen reads how far it got from the queue.
    await expect(headline(again)).toHaveText(findSearch.live.done);
    await expect.poll(() => rows(again).allTextContents()).toEqual(before);
    await expect.poll(() => kept(again).allTextContents()).toEqual(keptBefore);

    expect(errors).toEqual([]);
  });
});
