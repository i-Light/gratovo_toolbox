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

const paletteDialog = (page: Page) => page.getByRole("dialog", { name: strings.palette.label });
const paletteInput = (page: Page) =>
  page.getByRole("combobox", { name: strings.palette.inputLabel });
const paletteSettings = (page: Page) =>
  paletteDialog(page).getByRole("group", { name: strings.palette.groups.settings });

/** Names only the example data has: its teammates, creators and brands. */
const exampleNames = [
  "Sara",
  "Omar",
  "Lina",
  "Prompt Lab",
  "Neural Notes",
  "Code with Kai",
  "Codewell",
  "Lumen AI",
];

interface FrameAnswer {
  readonly ok: boolean;
  readonly value?: { readonly team: readonly { readonly id: string; readonly name: string }[] };
}

/**
 * The frame the page gets, through the page's own bridge. Teammates show on screen only while they
 * are online, and presence arrives with the sync (3d-2b), so the team is read here.
 */
async function loadFrame(page: Page): Promise<FrameAnswer> {
  return page.evaluate(() =>
    (
      globalThis as unknown as {
        gratovo: { invoke: (channel: string, input: object) => Promise<FrameAnswer> };
      }
    ).gratovo.invoke("frame:load", {}),
  );
}

/** Opens the account menu, checks whether it offers Connections, and closes it. */
async function expectConnectionsInMenu(page: Page, offered: boolean): Promise<void> {
  await page.locator("button.me").click();
  await expect(page.getByRole("menuitem", { name: strings.auth.signOut })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: strings.menu.connections })).toHaveCount(
    offered ? 1 : 0,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: strings.auth.signOut })).toHaveCount(0);
}

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
    const other = supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
    const { page } = await startSigned({ ready: "page" });
    await signInAs(page, owner.email, owner.password);

    // The team is the server's: the other member is in it, and nothing from the example data is,
    // neither in the frame nor on screen nor in the palette.
    const frame = await loadFrame(page);
    expect(frame.ok).toBe(true);
    const team = frame.value?.team.map((member) => [member.id, member.name]) ?? [];
    expect(team).toHaveLength(2);
    expect(team).toEqual(
      expect.arrayContaining([
        [owner.id, "maya"],
        [other.id, "sam"],
      ]),
    );
    const frameText = JSON.stringify(frame);
    const shown = await page.locator("body").innerText();
    for (const name of exampleNames) {
      expect(frameText).not.toContain(name);
      expect(shown).not.toContain(name);
    }
    await page.keyboard.press("Control+K");
    await paletteInput(page).fill("prompt");
    await expect(paletteDialog(page).getByRole("option", { name: /Prompt Lab/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();

    await expectConnectionsInMenu(page, true);

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

    // Team and money has no rows yet, so live mode hides it until its step (ground rule 9).
    await expect(sectionButton(page, tabs.team)).toHaveCount(0);
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

    // No Connections in the account menu, and the palette offers no owner-only settings: a search
    // that finds a setting shows the Settings group, one for an owner section doesn't.
    await expectConnectionsInMenu(page, false);
    await page.keyboard.press("Control+K");
    for (const ownerOnly of [tabs.facts, tabs.team, tabs.connections]) {
      await paletteInput(page).fill(settings.rows.density.label);
      await expect(paletteSettings(page)).toBeVisible();
      await paletteInput(page).fill(ownerOnly);
      await expect(paletteSettings(page)).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await expect(paletteDialog(page)).toBeHidden();
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
