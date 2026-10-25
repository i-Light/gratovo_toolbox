import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach } = strings;

// An example creator at `contact` with a ready first email and no gate (packages/core example.ts).
const creator = "Agent Weekly";

const lane = (page: Page, key: keyof typeof reach.board.lanes) =>
  page.getByRole("region", { name: reach.board.lanes[key].name });
const draft = (page: Page) =>
  page.getByRole("group", { name: reach.card.label(reach.kinds.first) });

test.describe("Reach › Board", () => {
  test("a waiting first email opens on its Emails tab; Send holds 10 s, Undo takes it back, and a second Send goes", async ({
    page,
    errors,
  }) => {
    test.setTimeout(90_000);
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.reach.name}`) })
      .click();
    await expect(page.getByRole("region", { name: reach.board.lanes.todraft.name })).toBeVisible();

    const waiting = lane(page, "waiting");
    const card = waiting.getByRole("button", { name: new RegExp(creator) });
    await expect(card).toBeVisible();
    await card.click();

    // The peek opens the creator on Emails, with the draft card and its Send button.
    await expect(draft(page)).toBeVisible();
    const send = draft(page).getByRole("button", { name: new RegExp(`^${reach.card.send}`) });
    await expect(send).toBeEnabled();

    // Send, then Undo from the toast inside the hold: the draft is back and nothing went.
    await send.click();
    const sent = page.getByRole("status").filter({ hasText: reach.sentTo(creator) });
    await expect(sent).toBeVisible();
    await sent.getByRole("button", { name: new RegExp(`^${strings.actions.undo}`) }).click();
    await expect(send).toBeEnabled();

    // Send again and let the hold run out: the card leaves Waiting for In sequence.
    await send.click();
    await expect(waiting.getByRole("button", { name: new RegExp(creator) })).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      lane(page, "seq").getByRole("button", { name: new RegExp(creator) }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
