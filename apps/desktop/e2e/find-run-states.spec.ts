import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, launchApp, test } from "./fixtures";

const { screens, findSearch } = strings;
const live = findSearch.live;

// The example pipeline rests where the test scripts it (GRATOVO_EXAMPLE_WAITS, read only by the
// example source of an unpackaged build): the real process tells `wait` and `resume`, and the
// panel shows them. The rests are seconds long here, and the person-facing texts are the real ones.
const keywords = ["ai video editor review", "claude code tutorial", "ai agents explained"] as const;
const run = { timeout: 60_000 };
const waits = (script: Record<string, [string, number]>): Record<string, string> => ({
  GRATOVO_EXAMPLE_WAITS: JSON.stringify(script),
});

const openSearch = async (page: Page): Promise<void> => {
  await page
    .getByRole("navigation", { name: strings.rail.label })
    .getByRole("button", { name: new RegExp(`^${screens.find.name}`) })
    .click();
  await expect(page.getByRole("textbox", { name: findSearch.keywords.inputLabel })).toBeVisible();
};

const addThree = async (page: Page): Promise<void> => {
  await page
    .getByRole("textbox", { name: findSearch.keywords.inputLabel })
    .fill(keywords.join("\n"));
  await page.getByRole("button", { name: findSearch.keywords.add }).click();
  await expect(page.getByRole("list", { name: findSearch.keywords.listLabel })).toBeVisible();
};

const headline = (page: Page) => page.locator("#find-live-h");
const rows = (page: Page) =>
  page.getByRole("list", { name: findSearch.keywords.listLabel }).getByRole("listitem");
// "Paused, resuming at 14:05": the real text, with a time of day in it (the texts have no regex
// characters before the time).
const resting = (page: Page, say: (time: string) => string) =>
  expect(headline(page)).toHaveText(new RegExp("^" + say("") + "[0-9]{1,2}:[0-9]{2}"), run);

test.describe("Find › Search › run states", () => {
  test("rests for the routes, waits out the quota, and goes on by itself", async ({ userData }) => {
    test.setTimeout(180_000);
    const { app, page, errors } = await launchApp(userData, [], {
      env: waits({ [keywords[1]]: ["routes", 6], [keywords[2]]: ["quota", 6] }),
    });
    try {
      await openSearch(page);
      await addThree(page);
      await page.getByRole("button", { name: live.start }).click();
      await expect(headline(page)).toContainText("Searching “", run);

      // 1. The routes rest: the headline tells the time and the line below tells why.
      await resting(page, live.waiting.routes);
      await expect(page.getByText(live.waitingWhy.routes, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: live.pause })).toBeVisible();

      // 2. It goes on by itself, then the quota rests the same way.
      await expect(headline(page)).toContainText("Searching “", run);
      await expect(page.getByText(live.waitingWhy.routes, { exact: true })).toHaveCount(0);
      await resting(page, live.waiting.quota);
      await expect(page.getByText(live.waitingWhy.quota, { exact: true })).toBeVisible();

      // 3. And it finishes the list.
      await expect(headline(page)).toHaveText(live.done, run);
      await expect(page.getByText(live.progress(3, 3), { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("stops during a rest and carries on from the same keyword", async ({ userData }) => {
    test.setTimeout(180_000);
    const { app, page, errors } = await launchApp(userData, [], {
      env: waits({ [keywords[1]]: ["routes", 120] }),
    });
    try {
      await openSearch(page);
      await addThree(page);
      await page.getByRole("button", { name: live.start }).click();
      await resting(page, live.waiting.routes);
      // The first keyword is done and saved; the second is resting.
      await expect(
        rows(page)
          .nth(0)
          .getByText(/^\d+ found · \d+ kept$/),
      ).toBeVisible(run);
      const first = await rows(page)
        .nth(0)
        .getByText(/found · /)
        .textContent();

      // Stop works at once, even in a two-minute rest.
      await page.getByRole("button", { name: live.pause }).click();
      await expect(headline(page)).toHaveText(live.paused(2), run);
      await expect(page.getByText(live.waitingWhy.routes, { exact: true })).toHaveCount(0);

      // Carries on from keyword 2, not from the top: the first keyword is left as it was, and the
      // run finishes without resting again.
      await page.getByRole("button", { name: live.resume(2) }).click();
      await expect(headline(page)).toHaveText(live.done, run);
      await expect(
        rows(page)
          .nth(0)
          .getByText(/found · /),
      ).toHaveText(first ?? "");
      await expect(page.getByText(live.progress(3, 3), { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
