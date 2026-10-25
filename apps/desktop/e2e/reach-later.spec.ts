import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach, toolbox } = strings;

// An example creator at `contact` with a ready first email and no gate (packages/core example.ts).
const creator = "Agent Weekly";

const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });
const railButton = (page: Page, name: string) =>
  rail(page).getByRole("button", { name: new RegExp(`^${name}`) });
const waiting = (page: Page) => page.getByRole("region", { name: reach.board.lanes.waiting.name });
const draft = (page: Page) =>
  page.getByRole("group", { name: reach.card.label(reach.kinds.first) });

test.describe("Reach › Send later", () => {
  test("a draft scheduled for tomorrow waits in Toolbox › Scheduled, and Cancel brings it back", async ({
    page,
    errors,
  }) => {
    await railButton(page, screens.reach.name).click();
    const card = waiting(page).getByRole("button", { name: new RegExp(creator) });
    await card.click();
    await expect(draft(page)).toBeVisible();

    // The arrow beside Send: Tomorrow, 09:00.
    await draft(page).getByRole("button", { name: reach.later.menu }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${reach.later.tomorrow}`) }).click();
    await expect(page.getByRole("status").filter({ hasText: reach.later.toastSub })).toBeVisible();
    await page.keyboard.press("Escape");

    // It leaves Waiting for In sequence, and waits in Toolbox › Scheduled.
    await expect(waiting(page).getByRole("button", { name: new RegExp(creator) })).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: reach.board.lanes.seq.name })
        .getByRole("button", { name: new RegExp(creator) }),
    ).toBeVisible();
    await railButton(page, screens.toolbox.name).click();
    await page
      .getByRole("button", { name: new RegExp(`^${screens.toolbox.tabs.scheduled}`) })
      .click();
    const cancel = page.getByRole("button", { name: toolbox.scheduled.cancelLabel(creator) });
    await expect(cancel).toBeVisible();

    // Cancel: the list empties and the draft is back in Waiting.
    await cancel.click();
    await expect(page.getByText(toolbox.scheduled.emptyTitle)).toBeVisible();
    await railButton(page, screens.reach.name).click();
    await expect(waiting(page).getByRole("button", { name: new RegExp(creator) })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
