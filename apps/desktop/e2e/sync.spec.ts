import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import type { FakeSupabase } from "./fake-supabase";
import { expect, syncNow, test } from "./fixtures";

const { top, settings } = strings;
const { tabs } = strings.screens.settings;
const text = strings.auth.signIn;

const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
// "Saved" also shows on the Settings name row, so only the top bar's status counts here.
const saveState = (page: Page) => page.locator("header.top").getByRole("status");
const paletteDialog = (page: Page) => page.getByRole("dialog", { name: strings.palette.label });
const paletteInput = (page: Page) =>
  page.getByRole("combobox", { name: strings.palette.inputLabel });

// What the team's server holds, about the niche: creators who cover AI tools, and brands that
// sponsor them.
const creators = [
  { channel_id: "UC-e2e-tokenwise", handle: "@tokenwise" },
  { channel_id: "UC-e2e-agentsdaily", handle: "@agentsdaily" },
  { channel_id: "UC-e2e-shipwithai", handle: "@shipwithai" },
];
const brands = [
  { id: "b-e2e-draftwise", name: "Draftwise AI" },
  { id: "b-e2e-patchpilot", name: "Patchpilot" },
];

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: text.submit, exact: true }).click();
  // Sign-in waits for the team to load first; a busy CI runner needs more than the default 5 s.
  await expect(rail(page)).toBeVisible({ timeout: 15_000 });
}

/** Opens the palette, types a search and returns the option with this name (or none). */
async function searchPalette(page: Page, query: string, name: RegExp) {
  await page.keyboard.press("Control+K");
  await paletteInput(page).fill(query);
  return paletteDialog(page).getByRole("option", { name });
}

async function closePalette(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(paletteDialog(page)).toBeHidden();
}

/** Looks for the option; closes the palette either way. */
async function paletteHas(page: Page, query: string, name: RegExp): Promise<boolean> {
  const option = await searchPalette(page, query, name);
  // The palette filters as it types; give the list a moment to settle on the search.
  await expect(paletteInput(page)).toHaveValue(query);
  const found = (await option.count()) > 0;
  await closePalette(page);
  return found;
}

async function openSettingsSection(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+Comma");
  await page
    .getByRole("navigation", { name: settings.navLabel })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

async function setName(page: Page, name: string): Promise<void> {
  await openSettingsSection(page, tabs.profile);
  const field = page.getByRole("textbox", { name: settings.rows.name.label });
  await field.fill(name);
  await field.press("Enter");
  await expect(page.locator(".rail .me")).toContainText(name);
}

async function signOut(page: Page): Promise<void> {
  await page.locator("button.me").click();
  await page.getByRole("menuitem", { name: strings.auth.signOut }).click();
  await expect(heading(page, text.title)).toBeVisible();
}

/** Signs in once, so the first pass has run and the tables are in. */
async function signedInWithData(
  supabase: FakeSupabase,
  startSigned: (o?: { ready: "page" }) => Promise<{ page: Page }>,
) {
  supabase.addRows("channel_state", creators);
  supabase.addRows("brands", brands);
  const member = supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
  const { page } = await startSigned({ ready: "page" });
  await signIn(page, member.email, member.password);
  return { page, member };
}

/** `sync:now` until the palette finds this, the way the app's own passes would bring it. */
async function expectInPalette(
  page: Page,
  query: string,
  name: RegExp,
  present: boolean,
): Promise<void> {
  await expect
    .poll(async () => {
      await syncNow(page);
      return paletteHas(page, query, name);
    })
    .toBe(present);
}

test.describe("the sync, against a fake Supabase", () => {
  test("after sign-in the palette finds a creator and a brand from the server", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await signedInWithData(supabase, startSigned);

    await expectInPalette(page, "tokenwise", /@tokenwise/, true);
    await expectInPalette(page, "draftwise", /Draftwise AI/, true);
    // Something the server doesn't have is not made up.
    expect(await paletteHas(page, "zzzz-no-such", /zzzz/)).toBe(false);

    // The first pull read each table from the start, in pages of 500, ordered by the cursor.
    const firstPull = supabase.sent("GET", "/rest/v1/channel_state");
    const query = new URLSearchParams(firstPull[0]?.path.split("?")[1] ?? "");
    expect(query.get("order")).toBe("updated_at.asc,channel_id.asc");
    expect(query.get("limit")).toBe("500");
    expect(query.get("or")).toBeNull();
    for (const table of ["brands", "deals", "activity_log", "sync_tombstones"]) {
      expect(supabase.count("GET", `/rest/v1/${table}`)).toBeGreaterThan(0);
    }
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("the next page starts after the last row seen, with the server's own time text", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await signedInWithData(supabase, startSigned);
    await expectInPalette(page, "shipwithai", /@shipwithai/, true);

    const newest = supabase.rows("channel_state").at(-1);
    supabase.addRows("channel_state", [{ channel_id: "UC-e2e-evalcast", handle: "@evalcast" }]);
    await expectInPalette(page, "evalcast", /@evalcast/, true);

    // Microseconds and the +00:00 offset travel as the server wrote them, quoted, not as a Date.
    const at = String(newest?.["updated_at"]);
    expect(at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/);
    const expected = `(updated_at.gt."${at}",and(updated_at.eq."${at}",channel_id.gt."${String(newest?.["channel_id"])}"))`;
    // The page that brought the new row started right after the newest row the copy held.
    const afterNewest = supabase
      .sent("GET", "/rest/v1/channel_state")
      .find(
        (request) => new URLSearchParams(request.path.split("?")[1] ?? "").get("or") === expected,
      );
    expect(afterNewest).toBeDefined();
    // The offset's plus sign is percent-encoded; a bare one would reach the server as a space.
    expect(afterNewest?.path).toContain("%2B00%3A00");
    expect(signedErrors).toEqual([]);
  });

  test("a server change shows after sync:now and Undo still undoes your own change", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await signedInWithData(supabase, startSigned);
    await expectInPalette(page, "tokenwise", /@tokenwise/, true);

    // Your own undoable change: a switch in Settings.
    await openSettingsSection(page, tabs.notifications);
    const reply = page.getByRole("switch", { name: settings.notify.reply.label, exact: true });
    const before = await reply.getAttribute("aria-checked");
    await reply.click();
    const after = before === "true" ? "false" : "true";
    await expect(reply).toHaveAttribute("aria-checked", after);
    await expect(saveState(page)).toHaveText(top.saved);

    // A teammate adds a brand and edits a creator; the next pass brings them.
    supabase.addRows("brands", [{ id: "b-e2e-promptly", name: "Promptly Studio" }]);
    supabase.updateRow("channel_state", "UC-e2e-agentsdaily", { handle: "@agentsweekly" });
    await expectInPalette(page, "promptly", /Promptly Studio/, true);
    await expectInPalette(page, "agentsweekly", /@agentsweekly/, true);
    expect(await paletteHas(page, "agentsdaily", /@agentsdaily/)).toBe(false);
    await expect(reply).toHaveAttribute("aria-checked", after);

    // Undo is still there and still takes back the switch, not the teammate's work.
    await page.keyboard.press("Control+Z");
    await expect(reply).toHaveAttribute("aria-checked", before ?? "false");
    expect(await paletteHas(page, "promptly", /Promptly Studio/)).toBe(true);
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("a row the server deleted goes from the copy", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await signedInWithData(supabase, startSigned);
    await expectInPalette(page, "patchpilot", /Patchpilot/, true);
    await expectInPalette(page, "shipwithai", /@shipwithai/, true);

    supabase.deleteRow("brands", "b-e2e-patchpilot");
    supabase.deleteRow("channel_state", "UC-e2e-shipwithai");
    await expectInPalette(page, "patchpilot", /Patchpilot/, false);
    await expectInPalette(page, "shipwithai", /@shipwithai/, false);
    // The others stay.
    expect(await paletteHas(page, "draftwise", /Draftwise AI/)).toBe(true);
    expect(await paletteHas(page, "tokenwise", /@tokenwise/)).toBe(true);
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("offline, a rename is kept and says it waits, then reaches the server once back", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page, member } = await signedInWithData(supabase, startSigned);
    await expectInPalette(page, "tokenwise", /@tokenwise/, true);
    await expect(saveState(page)).toHaveText(top.saved);

    await supabase.stop();
    await setName(page, "Sam Rivera");

    // The change is on this computer: never "Not saved". Once a pass fails, the chip says the
    // change is waiting, and the tip says what is true.
    await expect(saveState(page)).not.toHaveText(top.notSaved);
    await expect(saveState(page)).toHaveText(new RegExp(`^(${top.saved}|${top.notSynced})$`));
    await syncNow(page);
    await expect(saveState(page)).toHaveText(top.notSynced);
    await expect(saveState(page)).toHaveAttribute("data-tip", top.notSyncedOfflineTip(1));
    expect(supabase.displayName(member.id)).toBe("sam");

    await supabase.start();
    await syncNow(page);
    await expect.poll(() => supabase.displayName(member.id)).toBe("Sam Rivera");
    await expect(saveState(page)).toHaveText(top.saved);
    // Sent once, as a PATCH of that person's own profile; nothing deleted.
    const patches = supabase.sent("PATCH", "/rest/v1/profiles");
    expect(patches).toEqual([
      { path: `/rest/v1/profiles?id=eq.${member.id}`, body: { display_name: "Sam Rivera" } },
    ]);
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("an undo sends a new log line and never a DELETE", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page, member } = await signedInWithData(supabase, startSigned);
    await syncNow(page);

    // Writes go through the bridge: no screen adds activity lines yet (steps 4 to 9 do).
    const write = (writes: object[]) =>
      page.evaluate((sent) => window.gratovo.invoke("data:write", { writes: sent }), writes);
    const lineText = "Moved @tokenwise to Emailed";
    expect(
      await write([{ kind: "log.add", id: "line-e2e-1", at: Date.now(), text: lineText }]),
    ).toMatchObject({
      ok: true,
    });
    await syncNow(page);
    await expect.poll(() => supabase.rows("activity_log").length).toBe(1);
    expect(supabase.rows("activity_log")[0]).toMatchObject({
      id: "line-e2e-1",
      actor_id: member.id,
      entity_label: lineText,
    });

    // The undo is a new line pointing at the first; the first is never removed or changed.
    expect(await write([{ kind: "log.remove", id: "line-e2e-1" }])).toMatchObject({ ok: true });
    await syncNow(page);
    await expect.poll(() => supabase.rows("activity_log").length).toBe(2);
    expect(supabase.rows("activity_log")[1]).toMatchObject({
      action: "undo",
      entity_type: "activity_log",
      entity_id: "line-e2e-1",
      actor_id: member.id,
    });

    // And the redo is another new line.
    expect(
      await write([{ kind: "log.add", id: "line-e2e-1", at: Date.now(), text: lineText }]),
    ).toMatchObject({ ok: true });
    await syncNow(page);
    await expect.poll(() => supabase.rows("activity_log").length).toBe(3);
    expect(supabase.rows("activity_log")[2]).toMatchObject({
      action: "redo",
      entity_id: "line-e2e-1",
    });
    expect(supabase.rows("activity_log")[0]).toMatchObject({ id: "line-e2e-1", action: "note" });

    // Lines go up as inserts that ignore duplicates, never as anything that removes.
    const posts = supabase.requests.filter(
      (request) => request.method === "POST" && request.path.startsWith("/rest/v1/activity_log"),
    );
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.path).toBe("/rest/v1/activity_log?on_conflict=id");
      expect(post.headers["prefer"]).toContain("resolution=ignore-duplicates");
    }
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("signing out with unsent changes keeps them, says so, and signing back in sends them", async ({
    supabase,
    startSigned,
    userData,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page, member } = await signedInWithData(supabase, startSigned);
    await expectInPalette(page, "tokenwise", /@tokenwise/, true);

    await supabase.stop();
    await setName(page, "Sam Rivera");
    await signOut(page);

    // The sign-in screen says what is waiting; the copy and its changes are still on disk, the
    // session is not.
    await expect(page.getByText(text.waitingChanges(1))).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    expect(existsSync(join(userData, "gratovo.db"))).toBe(true);
    expect(supabase.displayName(member.id)).toBe("sam");

    // Signing back in as the same person sends them first.
    await supabase.start();
    await signIn(page, member.email, member.password);
    await expect.poll(() => supabase.displayName(member.id)).toBe("Sam Rivera");
    await expect(page.locator(".rail .me")).toContainText("Sam Rivera");
    await expect(page.getByText(text.waitingChanges(1))).toHaveCount(0);
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("another person signing in does not send the last person's unsent changes", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page, member } = await signedInWithData(supabase, startSigned);
    const other = supabase.addUser({ email: "lina@example.com", role: "basic", roles: ["scout"] });
    await expectInPalette(page, "tokenwise", /@tokenwise/, true);

    await supabase.stop();
    await setName(page, "Sam Rivera");
    await signOut(page);
    await expect(page.getByText(text.waitingChanges(1))).toBeVisible();

    await supabase.start();
    await signIn(page, other.email, other.password);
    await syncNow(page);
    await expect(page.locator(".rail .me")).not.toContainText("Sam Rivera");
    expect(supabase.displayName(member.id)).toBe("sam");
    expect(supabase.sent("PATCH", "/rest/v1/profiles")).toEqual([]);
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("with no Realtime server the app works and shows no error", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await signedInWithData(supabase, startSigned);
    // Whether or not the live client tried, it was refused; the catch-up still brings data.
    await expectInPalette(page, "tokenwise", /@tokenwise/, true);
    await expect(rail(page)).toBeVisible();
    expect(supabase.requests.some((request) => request.method === "UPGRADE")).toBe(true);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Your own presence doesn't need the live server: the rail shows you online.
    await expect(page.locator("button.me")).toContainText(
      strings.rail.roleOnline(strings.team.agencyRoles.scout),
    );

    // With the server gone too, a change waits quietly instead of failing.
    await supabase.stop();
    await setName(page, "Sam Rivera");
    await syncNow(page);
    await expect(saveState(page)).toHaveText(top.notSynced);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await supabase.start();
    expect(signedErrors).toEqual([]);
  });
});
