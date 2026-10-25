import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach } = strings;
const seq = reach.sequences;

// An example creator at `contact` with a ready first email and no gate (packages/core example.ts).
const creator = "Agent Weekly";

const lane = (page: Page, key: keyof typeof reach.board.lanes) =>
  page.getByRole("region", { name: reach.board.lanes[key].name });
const draft = (page: Page) =>
  page.getByRole("group", { name: reach.card.label(reach.kinds.first) });
const row = (page: Page) =>
  page.getByRole("table", { name: seq.table }).getByRole("row").filter({ hasText: creator });

test.describe("Reach › Sequences", () => {
  test("a sent first email starts a sequence; Stop stops it and the toast's Undo resumes it", async ({
    page,
    errors,
  }) => {
    test.setTimeout(90_000);
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.reach.name}`) })
      .click();

    // Send the first email and let the 10 s hold run out.
    await lane(page, "waiting")
      .getByRole("button", { name: new RegExp(creator) })
      .click();
    const later = reach.later.menu.slice(reach.card.send.length);
    await draft(page)
      .getByRole("button", { name: new RegExp(`^${reach.card.send}(?!${later})`) })
      .click();
    await expect(lane(page, "seq").getByRole("button", { name: new RegExp(creator) })).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Escape");

    // Its row in Sequences: follow-up 1 in 3 days.
    await page.getByRole("tab", { name: screens.reach.tabs.sequences }).click();
    const firstStep = seq.next.step(1, seq.next.inDays(3));
    await expect(row(page)).toContainText(firstStep);

    // Stop it from the row's menu.
    await row(page)
      .getByRole("button", { name: seq.moreFor(creator) })
      .click();
    await page.getByRole("menuitem", { name: new RegExp(`^${seq.stop}`) }).click();
    await expect(row(page)).toContainText(seq.next.you);

    // The toast's Undo resumes it.
    await page
      .getByRole("status")
      .filter({ hasText: seq.toasts.stopped(creator) })
      .getByRole("button", { name: new RegExp(`^${strings.actions.undo}`) })
      .click();
    await expect(row(page)).toContainText(firstStep);

    expect(errors).toEqual([]);
  });
});
