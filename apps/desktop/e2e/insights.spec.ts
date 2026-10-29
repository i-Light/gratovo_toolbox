import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { screens, insights } = strings;

test.describe("Insights", () => {
  test("opens on Overview, switches to Search and Goal, with no page errors", async ({
    page,
    errors,
  }) => {
    await page
      .getByRole("navigation", { name: strings.rail.label })
      .getByRole("button", { name: new RegExp(`^${screens.insights.name}`) })
      .click();

    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();
    // Either numbers or the empty state: a fresh copy has little to report on.
    await expect(
      panel.locator(
        '[data-ui="insights.overview.empty"], [aria-label="' +
          insights.overview.vitals.label +
          '"]',
      ),
    ).toBeVisible();

    await page
      .getByRole("tablist", { name: insights.tabsLabel })
      .getByRole("tab", { name: screens.insights.tabs.search })
      .click();
    // The plain example copy has no catalog, so Search may show its empty state; with a catalog
    // it shows the four views.
    const views = page.getByRole("group", { name: insights.search.viewsLabel });
    const empty = page.getByText(insights.search.emptyTitle);
    await expect(views.or(empty)).toBeVisible();
    if (await views.isVisible()) {
      for (const v of ["live", "waiting", "archive", "everything"] as const) {
        await expect(views.locator(`[data-ui="search.view.${v}"]`)).toContainText(
          insights.search.views[v].name,
        );
      }
    }

    await page
      .getByRole("tablist", { name: insights.tabsLabel })
      .getByRole("tab", { name: screens.insights.tabs.goal })
      .click();
    await expect(page.getByLabel(new RegExp(insights.goal.inputLabel))).toBeVisible();

    expect(errors).toEqual([]);
  });
});
