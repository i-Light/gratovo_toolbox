import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findRuns, findGallery, findTriage, findActions, findContacts } =
  strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const kwRows = (page: Page) =>
  page.getByRole("list", { name: findSearch.keywords.listLabel }).getByRole("listitem");
const runRow = (page: Page) =>
  page.getByRole("table", { name: findRuns.listLabel }).getByRole("row").nth(1);

/** The number a tab carries after its name ("Review new 9"); 0 when it shows none. */
async function tabCount(page: Page, name: string): Promise<number> {
  const text = (await tab(page, name).innerText()).replace(/\s+/g, " ");
  return Number(/(\d+)\s*$/.exec(text)?.[1] ?? "0");
}

/** How many channels the gallery says it holds ("12 channels"). */
async function channelCount(page: Page): Promise<number> {
  const line = page.getByText(/^\d+ channels?$/);
  await expect(line).toBeVisible(run);
  return Number.parseInt((await line.innerText()).split(" ")[0] ?? "", 10);
}

test.describe("Find flow", () => {
  test("search, keyword ideas, gallery, review and contacts on one search", async ({
    page,
    errors,
  }) => {
    test.setTimeout(240_000);

    await test.step("Search: paste two keywords, run, open the results", async () => {
      await page
        .getByRole("navigation", { name: strings.rail.label })
        .getByRole("button", { name: new RegExp(`^${screens.find.name}`) })
        .click();
      await page
        .getByRole("textbox", { name: findSearch.keywords.inputLabel })
        .fill(keywords.join("\n"));
      await page.getByRole("button", { name: findSearch.keywords.add }).click();
      await expect(kwRows(page)).toHaveCount(2);
      await page.getByRole("button", { name: findSearch.live.start }).click();
      await expect(page.getByRole("log", { name: findSearch.live.logLabel })).not.toContainText(
        findSearch.live.logEmpty,
        run,
      );
      await expect(page.getByRole("heading", { level: 3, name: findSearch.live.done })).toBeVisible(
        run,
      );
      await expect
        .poll(
          // The fourth cell is Kept.
          async () => Number((await runRow(page).getByRole("cell").nth(3).textContent()) ?? 0),
          run,
        )
        .toBeGreaterThan(0);
      await page
        .getByRole("button", { name: new RegExp(`^${findRuns.review}`) })
        .first()
        .click();
      await expect(
        page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.triage}`), selected: true }),
      ).toBeVisible(run);
      await expect(page.getByRole("article")).toBeVisible(run);
      await tab(page, screens.find.tabs.search).click();
    });

    await test.step("Keyword ideas: the stand-in suggests, the picked ones join the list", async () => {
      await expect(kwRows(page)).toHaveCount(keywords.length);
      const before = keywords.length;
      await page.getByRole("button", { name: findSearch.ideas.suggest }).click();
      const chips = page.getByRole("group", { name: findSearch.ideas.chipsLabel });
      await expect(chips).toBeVisible(run);
      // All suggestions start picked; the add button says how many.
      const suggested = await chips.getByRole("button").count();
      expect(suggested).toBeGreaterThan(2);
      await chips.getByRole("button").first().click();
      const picked = suggested - 1;
      await page.getByRole("button", { name: findSearch.ideas.addSelected(picked) }).click();
      await expect(kwRows(page)).toHaveCount(before + picked);
      await expect(
        page.getByRole("status").filter({ hasText: findSearch.keywords.added(picked, 0) }),
      ).toBeVisible();
    });

    // The example channels carry no gold mines (views are under 40% of subscribers), so the
    // narrowing signal is "Sponsored before".
    await test.step("Gallery: facets narrow, a range selects, a view is saved", async () => {
      await tab(page, screens.find.tabs.gallery).click();
      const cards = page.getByRole("listitem").filter({ has: page.locator("button.gopen") });
      await expect(cards.first()).toBeVisible(run);
      const all = await channelCount(page);
      expect(all).toBeGreaterThan(4);

      const chips = page.getByRole("group", { name: findGallery.chips.group });
      await page
        .getByRole("group", { name: findGallery.facets.signals })
        .getByRole("button", { name: new RegExp(`^${findGallery.signals.sponsored}`) })
        .click();
      await expect.poll(() => channelCount(page)).toBeLessThan(all);
      const sponsored = await channelCount(page);
      await expect(
        chips.getByRole("button", {
          name: findGallery.chips.remove(findGallery.signals.sponsored),
        }),
      ).toHaveAttribute("aria-pressed", "true");

      await page
        .getByRole("group", { name: findGallery.facets.country })
        .getByRole("button", { name: /^US/ })
        .click();
      await expect.poll(() => channelCount(page)).toBeLessThan(sponsored);
      const usCount = await channelCount(page);
      expect(usCount).toBeGreaterThan(0);

      // Save this view while the filter is on, then clear and bring it back with one click.
      await page.getByRole("button", { name: findGallery.views.save }).click();
      await page.getByRole("textbox", { name: findGallery.views.nameLabel }).fill("US sponsored");
      await page.keyboard.press("Enter");
      const view = page.getByRole("button", { name: "US sponsored", exact: true });
      await expect(view).toBeVisible();
      await page.getByRole("button", { name: findGallery.chips.clearAll }).click();
      await expect.poll(() => channelCount(page)).toBe(all);
      await view.click();
      await expect.poll(() => channelCount(page)).toBe(usCount);
      await page.getByRole("button", { name: findGallery.chips.clearAll }).click();
      await expect.poll(() => channelCount(page)).toBe(all);

      // Ctrl-click the first card, Shift-click the third: three selected, compare, Esc.
      const open = page.getByRole("button", { name: /^Open / });
      await open.nth(0).click({ modifiers: ["Control"] });
      await open.nth(2).click({ modifiers: ["Shift"] });
      const bar = page.getByRole("toolbar", { name: findGallery.bulk.label });
      await expect(bar.getByText(findGallery.bulk.selected(3))).toBeVisible();
      await bar.getByRole("button", { name: findGallery.bulk.compare }).click();
      const compare = page.getByRole("region", { name: findGallery.compare.title(3) });
      await expect(compare).toBeVisible();
      // One Escape clears the selection and with it the comparison.
      await page.keyboard.press("Escape");
      await expect(bar).toBeHidden();
      await expect(compare).toBeHidden();
    });

    await test.step("Review new: S shortlists, 3 rejects for the third reason", async () => {
      await tab(page, screens.find.tabs.triage).click();
      await expect(page.getByRole("article")).toBeVisible(run);
      const n0 = await tabCount(page, screens.find.tabs.triage);
      expect(n0).toBeGreaterThan(3);
      // Review new opens gold mines first, then by fit: with these keywords Ship Fast with AI is
      // first. It has a 95% About address, which is why the Contacts step needs it shortlisted.
      await expect(page.getByRole("article")).toHaveAttribute("aria-label", "Ship Fast with AI");
      await page.keyboard.press("s");
      await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
      await page.keyboard.press("3");
      await expect.poll(() => tabCount(page, screens.find.tabs.triage)).toBe(n0 - 2);
      await expect(page.getByText(findTriage.tally(1, 1))).toBeVisible();
      await expect(
        page.getByText(findActions.rejectSub(findActions.reasons.posting)),
      ).toBeVisible();
    });

    await test.step("Contacts: Confirm all 90%+ moves a sure channel on; undo brings it back", async () => {
      // Shortlist one more, so Contacts holds two: the sure one and another.
      await page.keyboard.press("s");
      await expect(page.getByText(findTriage.tally(2, 1))).toBeVisible();

      await tab(page, screens.find.tabs.contacts).click();
      const total = 2;
      await expect(page.getByText(findContacts.header(total))).toBeVisible(run);
      await expect(page.getByRole("article", { name: "Ship Fast with AI" })).toBeVisible();

      const confirm = page.getByRole("button", { name: /^Confirm all 90%\+/ });
      await expect(confirm).toBeVisible();
      const sure = Number(/\((\d+)\)$/.exec(await confirm.innerText())?.[1]);
      expect(sure).toBeGreaterThan(0);
      await confirm.click();
      await expect(page.getByRole("article")).toHaveCount(total - sure);
      await expect(page.getByText(findContacts.confirmedMany(sure))).toBeVisible();
      await expect(page.getByRole("article", { name: "Ship Fast with AI" })).toBeHidden();

      await page.keyboard.press("Control+z");
      await expect(page.getByText(findContacts.header(total))).toBeVisible();
      await expect(page.getByRole("article", { name: "Ship Fast with AI" })).toBeVisible();
    });

    expect(errors).toEqual([]);
  });
});
