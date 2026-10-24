import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findContacts, findTriage } = strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

test.describe("Find › Contacts", () => {
  test("two shortlisted channels reach Contacts; Confirm all 90%+ moves the sure one on", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);
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

    // Shortlist the first two channels in Review new.
    await page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.triage}`) }).click();
    await expect(page.getByRole("article")).toBeVisible(run);
    await page.keyboard.press("s");
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    await page.keyboard.press("s");

    // Both wait in Contacts, each with its addresses.
    await page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.contacts}`) }).click();
    await expect(page.getByText(findContacts.header(2))).toBeVisible(run);
    await expect(page.getByRole("article")).toHaveCount(2);

    // Ship Fast with AI has a business address in its About text (95% sure); Pair Programmer AI
    // has none. Open the first in the peek: it stays open while the channel leaves the list.
    await page
      .getByRole("article", { name: "Ship Fast with AI" })
      .getByRole("button", { name: findContacts.open })
      .click();
    const peek = page.getByRole("complementary", { name: strings.peek.label });
    await expect(peek).toBeVisible();

    // Confirm all 90%+ takes the channel whose best address is sure enough; it leaves.
    const all = page.getByRole("button", { name: /^Confirm all 90%\+/ });
    await expect(all).toBeVisible();
    await all.click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article", { name: "Pair Programmer AI" })).toBeVisible();
    await expect(page.getByText(findContacts.header(1))).toBeVisible();

    // The record says the contact is confirmed.
    await expect(peek.getByText(/^Contact confirmed:/)).toBeVisible();

    expect(errors).toEqual([]);
  });
});
