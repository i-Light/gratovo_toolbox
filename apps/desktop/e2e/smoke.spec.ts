import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

const mainEntry = join(__dirname, "..", "out", "main", "index.js");

test("opens the window with the design tokens and no Node in the page", async () => {
  const app = await electron.launch({ args: [mainEntry] });
  try {
    const page = await app.firstWindow();

    await expect(page.getByRole("heading", { name: "Gratovo" })).toBeVisible();

    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(background).toBe("#f2f5f9");

    const nodeRequire = await page.evaluate(
      () => typeof (globalThis as Record<string, unknown>)["require"],
    );
    expect(nodeRequire).toBe("undefined");
  } finally {
    await app.close();
  }
});
