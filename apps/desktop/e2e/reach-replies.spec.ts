import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, reach } = strings;
const paste = reach.emails.paste;

// An example creator at `emailed`, with a sequence and no reply (packages/core example.ts).
const creator = "Ship AI";
const reply =
  "Thanks for reaching out! My rate is $900 per integration. My audience is mostly US and UK.";

const lane = (page: Page, key: keyof typeof reach.board.lanes) =>
  page.getByRole("region", { name: reach.board.lanes[key].name });

test.describe("Reach › Replies", () => {
  test("a pasted reply moves the creator to Replied, shows in Replies with a reading, and gets an answer draft", async ({
    page,
    errors,
  }) => {
    test.setTimeout(60_000);
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.reach.name}`) })
      .click();

    // Open the emailed creator and paste their reply on the Emails tab.
    await lane(page, "seq")
      .getByRole("button", { name: new RegExp(creator) })
      .click();
    await page.getByRole("button", { name: paste.open }).click();
    await page.getByRole("textbox", { name: paste.label }).fill(reply);
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("status").filter({ hasText: paste.added(creator) })).toBeVisible();
    await page.keyboard.press("Escape");

    // The card moves to Replied.
    await expect(
      lane(page, "replied").getByRole("button", { name: new RegExp(creator) }),
    ).toBeVisible();
    await expect(lane(page, "seq").getByRole("button", { name: new RegExp(creator) })).toHaveCount(
      0,
    );

    // Replies lists it; once the stand-in has read it, its answer is ready.
    await page.getByRole("tab", { name: screens.reach.tabs.inbox }).click();
    const item = page
      .getByRole("listbox", { name: reach.replies.list })
      .getByRole("option", { name: new RegExp(creator) });
    await expect(item).toBeVisible();
    await expect(item).toContainText(reach.replies.state.draft, { timeout: 15_000 });
    await item.click();
    await expect(
      page.getByRole("group", { name: reach.card.label(reach.kinds.reply) }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
