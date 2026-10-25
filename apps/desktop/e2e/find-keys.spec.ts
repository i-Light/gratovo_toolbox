import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, findSearch, findTriage, findActions, actions, toolbox, record, settings } =
  strings;

// Two AI keywords the example source knows (services/pipeline .../example/channels.json).
const keywords = ["ai agents explained", "claude code tutorial"];
// The example run takes a few seconds; CI is slower.
const run = { timeout: 60_000 };

const card = (page: Page) => page.getByRole("article");
// Any tally, built from the string so a change of wording can't make an absence check pass forever.
const anyTally = new RegExp(findTriage.tally(0, 0).replaceAll("0", "\\d+"));
const toastOf = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const triageTab = (page: Page) =>
  page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.triage}`) });
const railButton = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: strings.rail.label })
    .getByRole("button", { name: new RegExp(`^${name}`) });

/** The channel on the card now. */
async function shown(page: Page): Promise<string> {
  return ((await card(page).getAttribute("aria-label")) ?? "").trim();
}

/** Opens Review new with a click on its tab, which hands the keys to the page. */
async function openReview(page: Page): Promise<void> {
  await railButton(page, screens.find.name).click();
  await triageTab(page).click();
  await expect(card(page)).toBeVisible(run);
  await expect(page.getByRole("tabpanel")).toBeFocused();
}

/** Runs the example search and opens Review new; returns how many channels wait. */
async function startReview(page: Page): Promise<number> {
  await railButton(page, screens.find.name).click();
  await page
    .getByRole("textbox", { name: findSearch.keywords.inputLabel })
    .fill(keywords.join("\n"));
  await page.getByRole("button", { name: findSearch.keywords.add }).click();
  await page.getByRole("button", { name: findSearch.live.start }).click();
  await expect(page.getByRole("heading", { level: 3, name: findSearch.live.done })).toBeVisible(
    run,
  );
  await openReview(page);
  const text = (await page.getByText(/^1 of \d+$/).textContent()) ?? "";
  const total = Number(/of (\d+)$/.exec(text)?.[1]);
  expect(total).toBeGreaterThanOrEqual(4);
  return total;
}

/** Turns the single-letter shortcuts switch in Settings › Keyboard and returns to Review new. */
async function setLetters(page: Page, on: boolean): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await page
    .getByRole("navigation", { name: settings.navLabel })
    .getByRole("button", { name: new RegExp(`^${screens.settings.tabs.keyboard}`) })
    .click();
  const letters = page.getByRole("switch", { name: settings.rows.letters.label, exact: true });
  if (on) {
    await expect(letters).not.toBeChecked();
    await letters.click();
    await expect(letters).toBeChecked();
  } else {
    await expect(letters).toBeChecked();
    await letters.click();
    await expect(letters).not.toBeChecked();
  }
  await openReview(page);
}

test.describe("Find › Review new keys", () => {
  test("the keyboard matrix: step, reasons, shortlist and open", async ({ page, errors }) => {
    test.setTimeout(120_000);
    const total = await startReview(page);

    // → and J step forward; ← and K step back; ← on the first stays.
    const first = await shown(page);
    await expect(page.getByText(findTriage.position(1, total))).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(findTriage.position(2, total))).toBeVisible();
    const second = await shown(page);
    expect(second).not.toBe(first);
    await page.keyboard.press("j");
    await expect(page.getByText(findTriage.position(3, total))).toBeVisible();
    expect(await shown(page)).not.toBe(second);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(findTriage.position(2, total))).toBeVisible();
    await expect(card(page)).toHaveAttribute("aria-label", second);
    await page.keyboard.press("k");
    await expect(page.getByText(findTriage.position(1, total))).toBeVisible();
    await expect(card(page)).toHaveAttribute("aria-label", first);
    await page.keyboard.press("ArrowLeft");
    // ← on the first stays; the → after it proves the ← was handled.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(findTriage.position(2, total))).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(findTriage.position(1, total))).toBeVisible();
    await expect(card(page)).toHaveAttribute("aria-label", first);

    // R opens the reason row, R again closes it, R then Escape closes it.
    const reasons = page.getByRole("group", { name: findTriage.rejectWhy });
    await page.keyboard.press("r");
    await expect(reasons).toBeVisible();
    for (const reason of Object.values(findActions.reasons)) {
      await expect(reasons.getByRole("button", { name: reason })).toBeVisible();
    }
    await page.keyboard.press("r");
    await expect(reasons).toBeHidden();
    await page.keyboard.press("r");
    await expect(reasons).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reasons).toBeHidden();

    // R then 2 rejects with the second reason; the toast names it and where to bring it back.
    await page.keyboard.press("r");
    await expect(reasons).toBeVisible();
    await page.keyboard.press("2");
    const toast = toastOf(page, findActions.rejected(first));
    await expect(toast).toContainText(findActions.rejectSub(findActions.reasons.views));
    await expect(reasons).toBeHidden();
    await expect(card(page)).not.toHaveAttribute("aria-label", first);

    // 1, 3 and 4 each reject at once with their reason.
    const keyed = [
      ["1", findActions.reasons.ai],
      ["3", findActions.reasons.posting],
      ["4", findActions.reasons.audience],
    ] as const;
    for (const [key, reason] of keyed) {
      const name = await shown(page);
      await page.keyboard.press(key);
      await expect(toastOf(page, findActions.rejected(name))).toContainText(
        findActions.rejectSub(reason),
      );
      await expect(card(page)).not.toHaveAttribute("aria-label", name);
    }
    await expect(page.getByText(findTriage.tally(0, 4))).toBeVisible();

    // S shortlists.
    const kept = await shown(page);
    await page.keyboard.press("s");
    await expect(toastOf(page, findActions.shortlisted(kept))).toBeVisible();
    await expect(page.getByText(findTriage.tally(1, 4))).toBeVisible();

    // O opens the creator record; Back returns to Review new on the same channel.
    const open = await shown(page);
    await page.keyboard.press("o");
    await expect(page).toHaveURL(/#\/record\/creator\//);
    await expect(card(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: open }).first()).toBeVisible();
    // The top bar has a Back button too; the record page's own is the last.
    await page.getByRole("button", { name: record.back, exact: true }).last().click();
    await expect(card(page)).toHaveAttribute("aria-label", open);

    expect(errors).toEqual([]);
  });

  test("keys do not fire with the letters switch off, or while typing in a field", async ({
    page,
    errors,
  }) => {
    test.setTimeout(120_000);
    const total = await startReview(page);
    const first = await shown(page);

    // Letters off: S, R and 1 do nothing; the arrows still step.
    await setLetters(page, false);
    await expect(card(page)).toHaveAttribute("aria-label", first);
    await page.keyboard.press("s");
    await page.keyboard.press("r");
    await page.keyboard.press("1");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(findTriage.position(2, total))).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(findTriage.position(1, total))).toBeVisible();
    // The three presses came before the arrows, which the page has handled by now.
    await expect(card(page)).toHaveAttribute("aria-label", first);
    await expect(page.getByRole("group", { name: findTriage.rejectWhy })).toBeHidden();
    await expect(page.getByText(anyTally)).toBeHidden();
    await expect(toastOf(page, findActions.shortlisted(first))).toBeHidden();

    // Back on, S works.
    await setLetters(page, true);
    await page.keyboard.press("s");
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    const next = await shown(page);
    expect(next).not.toBe(first);

    // Typing in the never-contact reason field goes into the field and decides nothing; Ctrl+Z
    // there is left to the field, so the shortlist stays.
    await page.getByRole("button", { name: findTriage.more, exact: true }).click();
    await page.getByRole("button", { name: findTriage.never, exact: true }).click();
    const field = page.getByRole("textbox", { name: findTriage.neverReason });
    await expect(field).toBeFocused();
    await page.keyboard.type("s1");
    await expect(field).toHaveValue("s1");
    await page.keyboard.press("Control+z");
    // The field's own undo took it, so the shortlist stays.
    await expect(field).not.toHaveValue("s1");
    await expect(card(page)).toHaveAttribute("aria-label", next);
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    await expect(toastOf(page, actions.undone)).toBeHidden();

    expect(errors).toEqual([]);
  });

  test("undo and redo: order, older toast, leaving the tab, Archive", async ({ page, errors }) => {
    test.setTimeout(120_000);
    const total = await startReview(page);
    const a = await shown(page);
    await page.keyboard.press("s");
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    const b = await shown(page);
    await page.keyboard.press("1");
    await expect(page.getByText(findTriage.tally(1, 1))).toBeVisible();

    // The older toast's Undo does not undo: it says newer changes came first.
    await toastOf(page, findActions.shortlisted(a))
      .getByRole("button", { name: new RegExp(`^${actions.undo}`) })
      .click();
    await expect(toastOf(page, actions.newerChanges)).toBeVisible();
    await expect(page.getByText(findTriage.tally(1, 1))).toBeVisible();

    // Ctrl+Z brings B back, then A; Ctrl+Shift+Z redoes A, Ctrl+Y redoes B.
    await page.keyboard.press("Control+z");
    await expect(card(page)).toHaveAttribute("aria-label", b);
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(card(page)).toHaveAttribute("aria-label", a);
    await expect(page.getByText(anyTally)).toBeHidden();
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByText(findTriage.tally(1, 0))).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(page.getByText(findTriage.tally(1, 1))).toBeVisible();

    // Undo after leaving the tab: reject C, go to Gallery, Ctrl+Z, come back.
    const c = await shown(page);
    const tabCount = (n: number): RegExp =>
      new RegExp(`^${screens.find.tabs.triage}\\s*${String(n)}$`);
    await expect(triageTab(page)).toHaveText(tabCount(total - 2));
    await page.keyboard.press("1");
    await expect(triageTab(page)).toHaveText(tabCount(total - 3));
    await page.getByRole("tab", { name: new RegExp(`^${screens.find.tabs.gallery}`) }).click();
    await page.keyboard.press("Control+z");
    await expect(triageTab(page)).toHaveText(tabCount(total - 2));
    await triageTab(page).click();
    await expect(card(page)).toHaveAttribute("aria-label", c);

    // C, undone, is not in Archive; B, rejected, is.
    await railButton(page, screens.toolbox.name).click();
    await expect(
      page.getByRole("button", { name: toolbox.archive.bringBackLabel(b) }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: toolbox.archive.bringBackLabel(c) }),
    ).toBeHidden();

    expect(errors).toEqual([]);
  });
});
