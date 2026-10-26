import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach, toolbox } = strings;
const seq = reach.sequences;
const mail = reach.mailboxes;

// Example creators (packages/core example.ts): Agent Weekly has a ready first email and no gate,
// Ship AI is emailed with a running sequence, Vector Vlog has replied (rate, audience and age).
const waitingCreator = "Agent Weekly";
const runningCreator = "Ship AI";
const repliedCreator = "Vector Vlog";
const mailbox = "outreach1@gratovo.example";

const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });
const railButton = (page: Page, name: string) =>
  rail(page).getByRole("button", { name: new RegExp(`^${name}`) });
const lane = (page: Page, key: keyof typeof reach.board.lanes) =>
  page.getByRole("region", { name: reach.board.lanes[key].name });
const draft = (page: Page) =>
  page.getByRole("group", { name: reach.card.label(reach.kinds.first) });
const undoOf = (page: Page, hasText: string) =>
  page
    .getByRole("status")
    .filter({ hasText })
    .getByRole("button", { name: new RegExp(`^${strings.actions.undo}`) });

test.describe("Reach › flows", () => {
  test("Reach is in the rail with its four tabs, and Toolbox › Scheduled opens", async ({
    page,
    errors,
  }) => {
    await railButton(page, screens.reach.name).click();
    for (const tab of Object.values(screens.reach.tabs)) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: screens.reach.tabs.board })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await railButton(page, screens.toolbox.name).click();
    await page
      .getByRole("button", { name: new RegExp(`^${screens.toolbox.tabs.scheduled}`) })
      .click();
    await expect(page.getByText(toolbox.scheduled.emptyTitle)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a rewrite replaces the text, and the toast's Undo brings the old text back", async ({
    page,
    errors,
  }) => {
    await railButton(page, screens.reach.name).click();
    await lane(page, "waiting")
      .getByRole("button", { name: new RegExp(waitingCreator) })
      .click();
    const body = draft(page).getByRole("textbox", { name: reach.card.body });
    await expect(body).toBeVisible();
    const before = await body.inputValue();

    await draft(page).getByRole("button", { name: reach.card.rewriteChips.warmer }).click();
    // Warmer always changes the text; Shorter leaves a two-paragraph email as it is.
    const toast = page.getByRole("status").filter({ hasText: reach.rewrittenSub });
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await expect(body).not.toHaveValue(before);

    await undoOf(page, reach.rewrittenSub).click();
    await expect(body).toHaveValue(before);

    expect(errors).toEqual([]);
  });

  test("a paused mailbox shows Paused, and Resume brings it back", async ({ page, errors }) => {
    await railButton(page, screens.reach.name).click();
    await page.getByRole("tab", { name: screens.reach.tabs.mailboxes }).click();
    const card = page.getByRole("group", { name: mailbox });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText(mail.status.paused);

    await card.getByRole("button", { name: mail.pause }).click();
    await expect(card).toContainText(mail.status.paused);
    await expect(card.getByRole("button", { name: mail.resume })).toBeVisible();

    await card.getByRole("button", { name: mail.resume }).click();
    await expect(card).not.toContainText(mail.status.paused);
    await expect(card.getByRole("button", { name: mail.pause })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a running sequence can be parked for 2 weeks and woken", async ({ page, errors }) => {
    await railButton(page, screens.reach.name).click();
    await page.getByRole("tab", { name: screens.reach.tabs.sequences }).click();
    const row = page
      .getByRole("table", { name: seq.table })
      .getByRole("row")
      .filter({ hasText: runningCreator });
    await expect(row).not.toContainText(seq.next.parkedNoDay);
    const menu = row.getByRole("button", { name: seq.moreFor(runningCreator) });

    await menu.click();
    await page.getByRole("menuitem", { name: new RegExp(`^${seq.parkChoices.weeks2}`) }).click();
    await expect(page.getByRole("status").filter({ hasText: seq.toasts.parkedSub })).toBeVisible();
    await expect(row).toContainText(seq.next.parkedNoDay);

    await menu.click();
    await page.getByRole("menuitem", { name: new RegExp(`^${seq.wake}`) }).click();
    await expect(page.getByRole("status").filter({ hasText: seq.toasts.wokeSub })).toBeVisible();
    await expect(row).not.toContainText(seq.next.parkedNoDay);

    expect(errors).toEqual([]);
  });

  test("a reply's reading shows its facts, Save to record saves one, and That's not it corrects it", async ({
    page,
    errors,
  }) => {
    await railButton(page, screens.reach.name).click();
    await page.getByRole("tab", { name: screens.reach.tabs.inbox }).click();
    await page
      .getByRole("listbox", { name: reach.replies.list })
      .getByRole("option", { name: new RegExp(repliedCreator) })
      .click();

    const reading = page.getByRole("group", { name: reach.reading.group });
    await expect(reading).toBeVisible();
    await expect(reading).toContainText(reach.reading.rate("$1,200"));
    await expect(reading).toContainText("US");
    await expect(reading).toContainText("GB");
    await expect(reading).toContainText(reach.reading.age("25-34"));
    await expect(reading).not.toContainText(reach.reading.corrected);

    // Save the rate, the first fact: its button says Saved, and the other two still offer Save.
    await reading.getByRole("button", { name: reach.reading.save }).first().click();
    await expect(reading.getByRole("button", { name: reach.reading.saved })).toBeDisabled();
    await expect(reading.getByRole("button", { name: reach.reading.save })).toHaveCount(2);

    // That's not it: pick another situation.
    await reading.getByRole("button", { name: reach.reading.notIt }).click();
    // A situation other than the current reading, so the pick changes it.
    const others = page
      .getByRole("menu", { name: reach.reading.menu })
      .getByRole("menuitemradio", { checked: false });
    await expect(others.first()).toBeVisible();
    await others.last().click();
    await expect(reading).toContainText(reach.reading.corrected);

    expect(errors).toEqual([]);
  });

  test("Check now on example data says there is no mailbox to check", async ({ page, errors }) => {
    await railButton(page, screens.reach.name).click();
    await page.getByRole("tab", { name: screens.reach.tabs.inbox }).click();
    await page.getByRole("button", { name: reach.replies.checkNow }).click();
    await expect(
      page.getByRole("status").filter({ hasText: reach.replies.toasts.problems.example }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
