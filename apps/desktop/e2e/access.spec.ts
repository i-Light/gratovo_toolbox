import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { settings } = strings;
const { tabs } = strings.screens.settings;
const text = strings.auth.signIn;

const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });
const sectionList = (page: Page) => page.getByRole("navigation", { name: settings.navLabel });

async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: text.submit, exact: true }).click();
  await expect(rail(page)).toBeVisible();
}

async function openSettingsSection(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await sectionList(page)
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

const sectionButton = (page: Page, name: string) =>
  sectionList(page).getByRole("button", { name: new RegExp(`^${name}`) });

test.describe("what a signed-in member sees", () => {
  test("the owner sees the owner sections and the Money switch", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    const owner = supabase.addUser({
      email: "maya@example.com",
      role: "full",
      roles: ["owner", "deal_lead"],
      seesMoney: true,
    });
    supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
    const { page } = await startSigned({ ready: "page" });
    await signInAs(page, owner.email, owner.password);

    await expect(page.locator("button.me")).toContainText(
      strings.rail.roleOnline(
        `${strings.team.agencyRoles.owner} · ${strings.team.agencyRoles.deal_lead}`,
      ),
    );
    await openSettingsSection(page, tabs.profile);
    await expect(page.getByText(strings.auth.signedInAs(owner.email))).toBeVisible();
    await expect(
      page.getByRole("button", { name: strings.auth.signOut, exact: true }),
    ).toBeVisible();

    await expect(sectionButton(page, tabs.team)).toBeVisible();
    await expect(sectionButton(page, tabs.connections)).toBeVisible();
    await openSettingsSection(page, tabs.notifications);
    await expect(
      page.getByRole("switch", { name: settings.notify.money.label, exact: true }),
    ).toBeVisible();
    expect(signedErrors).toEqual([]);
  });

  test("a member without money sees no Money switch and no owner sections", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({
      email: "maya@example.com",
      role: "full",
      roles: ["owner"],
      seesMoney: true,
    });
    const member = supabase.addUser({
      email: "sam@example.com",
      role: "basic",
      roles: ["scout"],
      seesMoney: false,
    });
    const { page } = await startSigned({ ready: "page" });
    await signInAs(page, member.email, member.password);

    await expect(page.locator("button.me")).toContainText(
      strings.rail.roleOnline(strings.team.agencyRoles.scout),
    );
    await openSettingsSection(page, tabs.notifications);
    await expect(
      page.getByRole("switch", { name: settings.notify.reply.label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: settings.notify.money.label, exact: true }),
    ).toHaveCount(0);
    await expect(sectionButton(page, tabs.team)).toHaveCount(0);
    await expect(sectionButton(page, tabs.connections)).toHaveCount(0);
    expect(signedErrors).toEqual([]);
  });

  test("setting your name sends it to the server", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    const member = supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
    const { page } = await startSigned({ ready: "page" });
    await signInAs(page, member.email, member.password);

    await openSettingsSection(page, tabs.profile);
    const name = page.getByRole("textbox", { name: settings.rows.name.label });
    await name.fill("Sam Rivera");
    await name.press("Enter");

    await expect(page.locator(".rail .me")).toContainText("Sam Rivera");
    await expect.poll(() => supabase.displayName(member.id)).toBe("Sam Rivera");
    const patches = supabase.requests.filter((request) => request.method === "PATCH");
    expect(patches.map((request) => request.path)).toEqual([
      `/rest/v1/profiles?id=eq.${member.id}`,
    ]);
    expect(JSON.parse(patches[0]?.body ?? "{}")).toEqual({ display_name: "Sam Rivera" });
    expect(signedErrors).toEqual([]);
  });
});
